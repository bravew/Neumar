/**
 * OpenAI-Compatible Agent
 *
 * Agent implementation using the OpenAI SDK with configurable base URL.
 * Supports any OpenAI-compatible API (BytePlus ModelArk, DeepSeek, etc.)
 * with an agentic tool loop using function calling.
 */

import OpenAI from 'openai';
import { AzureOpenAI } from 'openai/azure';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import { buildAskUserQuestionToolUse } from '@/core/agent/ask-user-question';
import {
  BaseAgent,
  formatPlanForExecution,
  getUserPreferencesInstruction,
  getWorkspaceInstruction,
  parsePlanningResponse,
  PLANNING_INSTRUCTION,
  type SandboxOptions,
} from '@/core/agent/base';
import {
  clampDefaultOutputTokens,
  estimateOutputBudgetInputTokens,
} from '@/core/agent/output-budget';
import { defineAgentPlugin, OPENAI_COMPAT_METADATA } from '@/core/agent/plugin';
import type { AgentPlugin } from '@/core/agent/plugin';
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ExecuteOptions,
  PlanOptions,
} from '@/core/agent/types';

import { DEFAULT_WORK_DIR } from '@/config/constants';

import {
  deleteProviderConversationState,
  getProviderConversationState,
  upsertProviderConversationState,
  type ProviderConversationIdentity,
} from '@/shared/db/provider-conversation-state';
import { defendToolOutput } from '@/shared/security/tool-output-defense';
import { isSearchEnabled } from '@/shared/services/search';
import { createLogger } from '@/shared/utils/logger';
import {
  getProviderHeaders,
  isAzureEndpoint,
} from '@/shared/utils/provider-headers';

import {
  createProviderTurnState,
  getChatProviderDialect,
  normalizeOpenAIUsage,
  type ChatProviderDialect,
} from './dialects';
import {
  generateImageDirect,
  generateVideoDirect,
  isImageModel,
  isMediaModel,
} from './media';
import { executeTool, getToolDefinitions } from './tools';

const logger = createLogger('OpenAICompat');

const MAX_ITERATIONS = 200;
const KIMI_STATE_RESET_TOKENS = 300_000;

function mergeUsage(
  aggregate: AgentMessage['usage'],
  turn: AgentMessage['usage'],
): AgentMessage['usage'] {
  if (!aggregate) return turn;
  if (!turn) return aggregate;
  return {
    input_tokens: (aggregate.input_tokens ?? 0) + (turn.input_tokens ?? 0),
    output_tokens: (aggregate.output_tokens ?? 0) + (turn.output_tokens ?? 0),
    reasoning_output_tokens:
      (aggregate.reasoning_output_tokens ?? 0) +
      (turn.reasoning_output_tokens ?? 0),
    cache_read_input_tokens:
      (aggregate.cache_read_input_tokens ?? 0) +
      (turn.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens:
      (aggregate.cache_creation_input_tokens ?? 0) +
      (turn.cache_creation_input_tokens ?? 0),
  };
}

/**
 * Supplementary planning instruction that informs the LLM about media generation tools.
 * The base PLANNING_INSTRUCTION doesn't mention these because they're openai-compat specific.
 */
const MEDIA_TOOLS_PLANNING_SUPPLEMENT = `

## MEDIA GENERATION TOOLS (IMPORTANT)

You have access to built-in tools for generating images and videos. These are REAL tools available during execution.

- **generate_image**: Generate an image from a text prompt using Seedream models. Parameters: prompt (required), model (optional), size (optional).
- **generate_video**: Generate a video from a text prompt using Seedance models. Parameters: prompt (required), model (optional), image_url (optional for image-to-video).

**When the user asks to generate/create an image or video**, classify it as a COMPLEX TASK and create a plan with a step like "Generate image using generate_image tool" or "Generate video using generate_video tool". Do NOT say you cannot generate images/videos — you CAN, using these tools.

Example — User: "generate an image of a sunset over the ocean"
Response:
\`\`\`json
{"type": "plan", "goal": "Generate an image of a sunset over the ocean", "steps": [{"id": "1", "description": "Use generate_image tool to create the image"}], "notes": "Will use Seedream model for high-quality image generation"}
\`\`\`
`;

/**
 * System-level instruction about media generation tools for the agentic loop.
 */
const MEDIA_TOOLS_SYSTEM_INSTRUCTION = `
## Media Generation Tools
You have access to these tools for creating images and videos:
- **generate_image**: Creates images from text prompts using Seedream models. Use this when asked to generate, create, or draw images.
- **generate_video**: Creates videos from text prompts using Seedance models. Use this when asked to generate or create videos.

When the user asks you to generate an image or video, use these tools directly. Do NOT write scripts or code to generate media — use the built-in tools.
`;

/**
 * System-level instruction about web search tools (appended when search service is enabled).
 */
function getSearchToolsInstruction(): string {
  if (!isSearchEnabled()) return '';
  return `
## Web Search Tools
You have access to these tools for searching the web:
- **web_search**: Search the web for current information, documentation, facts, etc. Use when you need up-to-date data.
- **web_search_news**: Search for recent news articles on a topic.

When the user asks about current events, recent news, or you need to verify time-sensitive facts, use these tools. Prefer web search over guessing for time-sensitive information.
`;
}

/**
 * OpenAI-compatible agent implementation
 */
export class OpenAICompatAgent extends BaseAgent {
  readonly provider: AgentProvider = 'openai-compat';
  private readonly dialect: ChatProviderDialect;

  constructor(config: AgentConfig) {
    super(config);
    this.dialect = getChatProviderDialect(config.dialect);
  }

  private getReasoningEffort(
    options?: AgentOptions,
  ): 'low' | 'high' | 'max' | undefined {
    if (this.dialect.id !== 'kimi-k3') return undefined;
    const effort = options?.thinkingConfig?.effort;
    if (effort === 'low') return 'low';
    if (effort === 'max' || effort === 'xhigh') return 'max';
    if (effort === 'medium' || effort === 'high') return 'high';
    return 'max';
  }

  private createClient(): OpenAI {
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'No API key configured for OpenAI-compatible provider. ' +
          'Set an API key in provider settings or the OPENAI_API_KEY environment variable.',
      );
    }
    const baseUrl = this.config.baseUrl || '';

    // Azure endpoints use AzureOpenAI which handles api-key auth natively
    // (avoids sending a bogus Authorization: Bearer header)
    if (baseUrl && isAzureEndpoint(baseUrl)) {
      return new AzureOpenAI({
        apiKey,
        baseURL: baseUrl,
        apiVersion: '2024-10-21',
        defaultHeaders: getProviderHeaders(baseUrl, apiKey),
      });
    }

    const defaultHeaders = baseUrl ? getProviderHeaders(baseUrl, apiKey) : {};

    return new OpenAI({
      apiKey,
      baseURL: baseUrl || undefined,
      defaultHeaders,
    });
  }

  private getModel(): string {
    return this.config.model || 'seed-1-8-251228';
  }

  private getWorkDir(options?: AgentOptions): string {
    return options?.cwd || this.config.workDir || DEFAULT_WORK_DIR;
  }

  private getProviderStateIdentity(
    options: AgentOptions | undefined,
    workDir: string,
  ): ProviderConversationIdentity | null {
    if (this.dialect.id !== 'kimi-k3' || !options?.taskId) return null;
    return {
      taskId: options.taskId,
      providerId: this.config.providerId ?? 'moonshot-global',
      modelId: this.getModel(),
      workspaceRoot: workDir,
    };
  }

  private persistProviderState(
    messages: readonly ChatCompletionMessageParam[],
    options: AgentOptions | undefined,
    workDir: string,
  ): void {
    const identity = this.getProviderStateIdentity(options, workDir);
    if (!identity) return;
    try {
      upsertProviderConversationState(identity, messages);
    } catch (error) {
      logger.warn('kimi_provider_state_persist_failed', {
        taskId: identity.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private loadProviderState(identity: ProviderConversationIdentity | null) {
    if (!identity) return null;
    try {
      return getProviderConversationState(identity);
    } catch (error) {
      logger.warn('kimi_provider_state_load_failed', {
        taskId: identity.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private resetProviderState(taskId: string): void {
    try {
      deleteProviderConversationState(taskId);
    } catch (error) {
      logger.warn('kimi_provider_state_reset_failed', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private getDefaultOutputMaxTokens(
    messages: ChatCompletionMessageParam[],
  ): number | undefined {
    return clampDefaultOutputTokens(
      { id: this.getModel() },
      {
        inputTokens: estimateOutputBudgetInputTokens(
          messages.map((message) => String(message.content ?? '')).join('\n'),
        ),
      },
    );
  }

  // ============================================================================
  // Planning Phase
  // ============================================================================

  async *plan(
    prompt: string,
    options?: PlanOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('planning');
    yield { type: 'session', sessionId: session.id };

    // Media models skip planning — generate directly
    if (isMediaModel(this.getModel())) {
      yield {
        type: 'direct_answer',
        content:
          'Media generation model selected — will generate directly without planning.',
      };
      this.sessions.delete(session.id);
      yield { type: 'done' };
      return;
    }

    logger.debug(`[${session.id}] Planning phase started`);

    const client = this.createClient();
    let fullResponse = '';

    try {
      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'user',
          content:
            PLANNING_INSTRUCTION + MEDIA_TOOLS_PLANNING_SUPPLEMENT + prompt,
        },
      ];

      const planningMaxTokens = this.getDefaultOutputMaxTokens(messages);
      const stream = await client.chat.completions.create(
        {
          model: this.getModel(),
          messages,
          stream: true,
          ...this.dialect.requestOptions({
            reasoningEffort: this.getReasoningEffort(options),
          }),
          ...(planningMaxTokens ? { max_tokens: planningMaxTokens } : {}),
        },
        { signal: session.abortController.signal },
      );

      for await (const chunk of stream) {
        if (session.abortController.signal.aborted) break;

        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          fullResponse += delta.content;
        }
      }

      logger.debug(
        `[${session.id}] Planning response length: ${fullResponse.length}`,
      );

      // Parse the planning response — only yield the structured result,
      // not the raw JSON text which would flash on screen before being replaced.
      const parsed = parsePlanningResponse(fullResponse);
      if (parsed) {
        if (parsed.type === 'direct_answer') {
          yield { type: 'direct_answer', content: parsed.answer };
        } else if (parsed.type === 'plan') {
          this.storePlan(parsed.plan);
          yield { type: 'plan', plan: parsed.plan };
        } else if (parsed.type === 'ask_user_question') {
          // Planning phase routes AskUserQuestion through the shared
          // synthetic tool_use bridge (see @/core/agent/ask-user-question).
          yield buildAskUserQuestionToolUse(parsed.payload);
        }
      } else {
        // Could not parse as plan or direct_answer — show the raw response as text
        yield { type: 'text', content: fullResponse };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[${session.id}] Planning error:`, error);

      const isContextOverflow =
        errorMsg.includes('context_length_exceeded') ||
        (errorMsg.includes('token') && errorMsg.includes('maximum')) ||
        errorMsg.includes('too many tokens');

      if (isContextOverflow) {
        yield {
          type: 'error',
          subtype: 'context_length_exceeded',
          message: JSON.stringify({
            model: this.getModel(),
            error: errorMsg,
            suggestions: [
              'Start a new session',
              'Switch to a larger model',
              'Compact conversation history',
            ],
          }),
        };
      } else {
        yield { type: 'error', message: errorMsg };
      }
    } finally {
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }

  // ============================================================================
  // Execution Phase
  // ============================================================================

  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');
    yield { type: 'session', sessionId: session.id };

    // Media models don't support plan/execute mode
    if (isMediaModel(this.getModel())) {
      yield {
        type: 'error',
        message:
          'Media generation models do not support plan/execute mode. Use direct run instead.',
      };
      this.sessions.delete(session.id);
      yield { type: 'done' };
      return;
    }

    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      logger.error(`[${session.id}] Plan not found: ${options.planId}`);
      yield { type: 'error', message: `Plan not found: ${options.planId}` };
      yield { type: 'done' };
      return;
    }

    const workDir = this.getWorkDir(options);
    const sandbox: SandboxOptions | undefined = options.sandbox
      ? { enabled: options.sandbox.enabled, image: options.sandbox.image }
      : undefined;

    logger.info(`[${session.id}] Executing plan: ${plan.id} (${plan.goal})`);

    const client = this.createClient();

    const systemPrompt =
      formatPlanForExecution(
        plan,
        workDir,
        sandbox,
        options.userWorkspaceDir,
        options.allowWorkspaceWrite,
      ) +
      MEDIA_TOOLS_SYSTEM_INSTRUCTION +
      getSearchToolsInstruction() +
      options.originalPrompt;

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: options.originalPrompt },
    ];

    try {
      yield* this.agenticLoop(client, messages, workDir, session, options);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[${session.id}] Execution error:`, error);

      const isContextOverflow =
        errorMsg.includes('context_length_exceeded') ||
        (errorMsg.includes('token') && errorMsg.includes('maximum')) ||
        errorMsg.includes('too many tokens');

      if (isContextOverflow) {
        yield {
          type: 'error',
          subtype: 'context_length_exceeded',
          message: JSON.stringify({
            model: this.getModel(),
            error: errorMsg,
            suggestions: [
              'Start a new session',
              'Switch to a larger model',
              'Compact conversation history',
            ],
          }),
        };
      } else {
        yield { type: 'error', message: errorMsg };
      }
    } finally {
      this.deletePlan(options.planId);
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }

  // ============================================================================
  // Direct Run
  // ============================================================================

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');
    yield { type: 'session', sessionId: session.id };

    const model = this.getModel();
    const workDir = this.getWorkDir(options);

    // Direct media generation when a media model is selected
    if (isMediaModel(model)) {
      logger.info(`[${session.id}] Direct media generation with ${model}`);
      try {
        if (isImageModel(model)) {
          yield* generateImageDirect(
            prompt,
            workDir,
            this.config.apiKey || '',
            this.config.baseUrl || '',
            model,
          );
        } else {
          yield* generateVideoDirect(
            prompt,
            workDir,
            this.config.apiKey || '',
            this.config.baseUrl || '',
            model,
            session.abortController.signal,
          );
        }
      } catch (error) {
        yield {
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
      } finally {
        this.sessions.delete(session.id);
        yield { type: 'done' };
      }
      return;
    }

    logger.debug(`[${session.id}] Direct run started`);

    const client = this.createClient();

    const systemPrompt =
      getWorkspaceInstruction(
        workDir,
        undefined,
        options?.userWorkspaceDir,
        options?.allowWorkspaceWrite,
      ) +
      getUserPreferencesInstruction() +
      MEDIA_TOOLS_SYSTEM_INSTRUCTION +
      getSearchToolsInstruction();

    const stateIdentity = this.getProviderStateIdentity(options, workDir);
    const storedState = this.loadProviderState(stateIdentity);
    const stateTooLarge =
      storedState && storedState.estimatedTokens >= KIMI_STATE_RESET_TOKENS;
    if (stateTooLarge && stateIdentity) {
      this.resetProviderState(stateIdentity.taskId);
      yield {
        type: 'system',
        subtype: 'context_reset',
        content:
          'Kimi K3 provider state reached the continuation limit and was reset.',
        isProgress: true,
      };
    }

    const messages: ChatCompletionMessageParam[] =
      storedState && !stateTooLarge
        ? [...storedState.messages]
        : [{ role: 'system', content: systemPrompt }];

    if (!storedState || stateTooLarge) {
      for (const msg of options?.conversation ?? []) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push(this.dialect.buildUserMessage(prompt, options?.images));
    this.persistProviderState(messages, options, workDir);

    try {
      yield* this.agenticLoop(client, messages, workDir, session, options);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[${session.id}] Run error:`, error);

      const isContextOverflow =
        errorMsg.includes('context_length_exceeded') ||
        (errorMsg.includes('token') && errorMsg.includes('maximum')) ||
        errorMsg.includes('too many tokens');

      if (isContextOverflow) {
        yield {
          type: 'error',
          subtype: 'context_length_exceeded',
          message: JSON.stringify({
            model: this.getModel(),
            error: errorMsg,
            suggestions: [
              'Start a new session',
              'Switch to a larger model',
              'Compact conversation history',
            ],
          }),
        };
      } else {
        yield {
          type: 'error',
          message: errorMsg,
        };
      }
    } finally {
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }

  // ============================================================================
  // Agentic Tool Loop
  // ============================================================================

  private async *agenticLoop(
    client: OpenAI,
    messages: ChatCompletionMessageParam[],
    workDir: string,
    session: { id: string; abortController: AbortController },
    _options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    let aggregateUsage: AgentMessage['usage'];
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (session.abortController.signal.aborted) break;

      logger.debug(
        `[${session.id}] Iteration ${iteration + 1}/${MAX_ITERATIONS}`,
      );

      // Call the model with streaming
      const loopMaxTokens = this.getDefaultOutputMaxTokens(messages);
      const stream = await client.chat.completions.create(
        {
          model: this.getModel(),
          messages,
          tools: getToolDefinitions(),
          stream: true,
          ...this.dialect.requestOptions({
            reasoningEffort: this.getReasoningEffort(_options),
            outputFormat: _options?.outputFormat,
          }),
          ...(loopMaxTokens ? { max_tokens: loopMaxTokens } : {}),
        },
        { signal: session.abortController.signal },
      );

      // Accumulate response
      const turnState = createProviderTurnState();
      let turnUsage: AgentMessage['usage'];
      for await (const chunk of stream) {
        if (session.abortController.signal.aborted) break;

        const choice = chunk.choices[0];
        turnUsage = normalizeOpenAIUsage(chunk.usage) ?? turnUsage;
        if (!choice) continue;

        for (const message of this.dialect.consumeDelta(
          choice.delta,
          turnState,
        )) {
          yield message;
        }
      }

      aggregateUsage = mergeUsage(aggregateUsage, turnUsage);

      const assistantMessage = this.dialect.buildAssistantEnvelope(turnState);

      // If no tool calls, the model is done. Preserve the K3 reasoning
      // envelope once so a later continuation can replay it unchanged.
      if (turnState.toolCalls.size === 0) {
        if (turnState.content || turnState.reasoningContent) {
          messages.push(assistantMessage);
          this.persistProviderState(messages, _options, workDir);
        }
        if (aggregateUsage) {
          yield {
            type: 'result',
            model: this.getModel(),
            usage: aggregateUsage,
          };
        }
        return;
      }

      const toolCallsArray = [...turnState.toolCalls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call]) => call);
      messages.push(assistantMessage);
      this.persistProviderState(messages, _options, workDir);

      // TODO(ask-user-question): OpenAI-compat uses real function calling,
      // so the cleanest AskUserQuestion integration is to register it as a
      // native tool in TOOL_DEFINITIONS (schema is in
      // `@/core/agent/ask-user-question`) and have `executeTool` return a
      // placeholder result while breaking the agentic loop — the next turn
      // resumes with the user's answer in conversation history. The
      // fenced-text bridge used by Codex/HTTP-agent/OpenCode works here too
      // but loses parity with native OpenAI tool semantics.
      // Execute each tool call
      for (const tc of toolCallsArray) {
        if (session.abortController.signal.aborted) break;

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        // Yield tool_use
        yield {
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: args,
        };

        // Execute the tool
        const result = await executeTool(
          tc.function.name,
          args,
          workDir,
          session.abortController.signal,
          { apiKey: this.config.apiKey, baseUrl: this.config.baseUrl },
        );

        // Phase 7: defend tool output BEFORE it goes back to the display or
        // re-enters provider messages. Defense at AG-UI is too late — by
        // then the next model turn has already consumed the raw output.
        const defended = defendToolOutput({
          source: {
            adapter: 'openai-compat',
            toolName: tc.function.name,
            toolUseId: tc.id,
          },
          content: result.output,
          riskHint:
            tc.function.name === 'fetch' ||
            tc.function.name === 'http_request' ||
            tc.function.name === 'web_search'
              ? 'high'
              : 'normal',
        });

        if (
          defended.verdict === 'BLOCK' ||
          defended.verdict === 'HITL_REQUIRED'
        ) {
          yield {
            type: 'system',
            subtype: 'security',
            content: defended.displayContent,
            isProgress: true,
          };
        }

        const displayOutput =
          defended.displayContent.length > 10000
            ? defended.displayContent.slice(0, 10000) + '\n... (truncated)'
            : defended.displayContent;

        yield {
          type: 'tool_result',
          toolUseId: tc.id,
          output: displayOutput,
          isError: result.isError || defended.verdict === 'BLOCK',
          security: {
            verdict: defended.verdict,
            source: 'openai-compat',
            payloadHash: defended.audit.payloadHash,
            redactedSnippet: defended.redactedSnippet,
            scores: defended.scores as Record<string, number>,
          },
        };

        // Add defended tool result to messages so the model only ever sees
        // the envelope or a placeholder, never the raw injection vector.
        const modelOutput =
          defended.modelContent.length > 30000
            ? defended.modelContent.slice(0, 30000) + '\n... (truncated)'
            : defended.modelContent;
        const toolResultMessage: ChatCompletionMessageParam = {
          role: 'tool',
          tool_call_id: tc.id,
          content: modelOutput,
        };
        messages.push(toolResultMessage);
        this.persistProviderState(messages, _options, workDir);
      }
    }
    if (aggregateUsage && !session.abortController.signal.aborted) {
      yield { type: 'result', model: this.getModel(), usage: aggregateUsage };
    }
  }
}

// ============================================================================
// Factory and Plugin
// ============================================================================

export function createOpenAICompatAgent(
  config: AgentConfig,
): OpenAICompatAgent {
  return new OpenAICompatAgent(config);
}

export const openaiCompatPlugin: AgentPlugin = defineAgentPlugin({
  metadata: OPENAI_COMPAT_METADATA,
  factory: (config) => createOpenAICompatAgent(config),
});
