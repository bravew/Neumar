/**
 * Open Agent SDK Adapter
 *
 * Implementation of the IAgent interface using @codeany/open-agent-sdk.
 * Context (user preferences, memories, profile) is pre-resolved by the
 * service layer and passed in via AgentOptions.systemContext — this adapter
 * never reads from the DB directly (same pattern as Codex adapter).
 *
 * Key difference from Claude/Codex: No CLI binary required. query() runs
 * the agentic loop in-process. No subprocess management, no PATH resolution.
 */

import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join, resolve as resolvePath, sep } from 'path';

import { query } from '@codeany/open-agent-sdk';

import {
  BaseAgent,
  getWorkspaceInstruction,
  isConversationalPrompt,
  type SandboxOptions,
} from '@/core/agent/base';
import { isClaudeSonnet5 } from '@/core/agent/claude-models';
import { DenialTracker } from '@/core/agent/denial-tracker';
import { defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin } from '@/core/agent/plugin';
import { checkBashCommand } from '@/core/agent/safety/dangerous-patterns';
import { ToolPermissionRegistry } from '@/core/agent/tool-permission-registry';
import type {
  AdapterEnvironmentReport,
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ConversationMessage,
  ExecuteOptions,
  PlanOptions,
  TaskPlan,
} from '@/core/agent/types';

import { DEFAULT_AGENT_MODEL, DEFAULT_WORK_DIR } from '@/config/constants';

import { getRemainingBudgetUsd } from '@/shared/services/budget';
import { logUsage } from '@/shared/services/usage-logger';
import { createLogger } from '@/shared/utils/logger';
import { expandPath } from '@/shared/utils/paths';

import { SdkMessageProcessor } from './message-adapter';
import {
  detectProvider,
  type SdkAgentOptions,
  type SdkCanUseToolResult,
  type SdkToolDefinition,
} from './types';

const logger = createLogger('OpenAgentSDK');
const DEFAULT_MAX_TURNS = 50;
type ThinkingEffort = NonNullable<AgentOptions['thinkingConfig']>['effort'];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get or create a working directory for the session.
 * Uses DEFAULT_WORK_DIR to avoid polluting user project directories.
 */
async function getSessionWorkDir(
  _workDir: string | undefined,
  prompt: string,
  taskId?: string,
): Promise<string> {
  const base = expandPath(DEFAULT_WORK_DIR);
  const sessionsDir = join(base, 'sessions');
  const folderName = taskId
    ? `session-${taskId}`
    : `session-${
        prompt
          .slice(0, 40)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || crypto.randomUUID()
      }`;
  const resolved = resolvePath(join(sessionsDir, folderName));
  const resolvedBase = resolvePath(base);
  if (!resolved.startsWith(resolvedBase + sep)) {
    throw new Error('Invalid session path');
  }
  if (!existsSync(resolved)) {
    await mkdir(resolved, { recursive: true });
  }
  return resolved;
}

/**
 * Resolve API key: explicit config > env vars.
 * The SDK expects CODEANY_API_KEY but we use ANTHROPIC_API_KEY / OPENAI_API_KEY.
 */
function resolveApiKey(
  config: AgentConfig,
  model?: string,
): string | undefined {
  if (config.apiKey) return config.apiKey;
  const provider = detectProvider(model);
  if (provider === 'openai') return process.env.OPENAI_API_KEY;
  return process.env.ANTHROPIC_API_KEY;
}

/**
 * Auto-detect SDK apiType from model name.
 */
function resolveApiType(
  model?: string,
  baseUrl?: string,
): 'anthropic-messages' | 'openai-completions' {
  if (baseUrl && model && !model.startsWith('claude-')) {
    return 'openai-completions';
  }
  if (
    model &&
    (model.startsWith('gpt-') ||
      model.startsWith('o1-') ||
      model.startsWith('o3-') ||
      model.startsWith('o4-') ||
      model.startsWith('deepseek-') ||
      model.startsWith('qwen-') ||
      model.startsWith('qwq-') ||
      model.startsWith('mistral-') ||
      model.startsWith('codestral-'))
  ) {
    return 'openai-completions';
  }
  return 'anthropic-messages';
}

/**
 * Map our thinkingConfig to SDK's ThinkingConfig format.
 */
function mapThinkingConfig(
  model: string,
  thinkingConfig?: AgentOptions['thinkingConfig'],
):
  | { type: 'adaptive' | 'enabled' | 'disabled'; budgetTokens?: number }
  | undefined {
  if (!thinkingConfig) return undefined;
  if (isClaudeSonnet5(model)) {
    return thinkingConfig.type === 'disabled'
      ? { type: 'disabled' }
      : { type: 'adaptive' };
  }
  return {
    type: thinkingConfig.type ?? 'disabled',
    budgetTokens: thinkingConfig.budgetTokens,
  };
}

function mapSdkEffort(
  effort: ThinkingEffort | undefined,
): SdkAgentOptions['effort'] | undefined {
  return effort === 'xhigh' ? 'max' : effort;
}

/**
 * Format conversation history + current prompt.
 * Caps history to last 20 messages to avoid exceeding context limits.
 */
function formatConversationPrompt(
  conversation: ConversationMessage[] | undefined,
  prompt: string,
): string {
  if (!conversation || conversation.length === 0) return prompt;
  const recent = conversation.slice(-20);
  const history = recent
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
  return `## Previous Conversation Context\n${history}\n\n## Current Request\n${prompt}`;
}

/**
 * Build the canUseTool callback for the SDK.
 * Integrates DenialTracker + ToolPermissionRegistry + dangerous pattern detection.
 */
function buildCanUseToolCallback(
  denialTracker: DenialTracker,
  permissionRegistry: ToolPermissionRegistry,
): (tool: SdkToolDefinition, input: unknown) => Promise<SdkCanUseToolResult> {
  return async (tool, input) => {
    const toolName = tool.name;

    // 1. Check denial tracker — too many denials for this tool
    if (denialTracker.shouldFallback(toolName)) {
      return { behavior: 'deny', message: 'Too many denials for this tool' };
    }

    // 2. Check dangerous bash commands
    if (toolName === 'Bash') {
      const command = (input as Record<string, unknown>)?.command;
      if (typeof command === 'string') {
        const danger = checkBashCommand(command);
        if (danger.isDangerous && danger.severity === 'block') {
          const summary =
            typeof input === 'object' && input
              ? JSON.stringify(input).slice(0, 100)
              : String(input).slice(0, 100);
          denialTracker.record(toolName, summary);
          return {
            behavior: 'deny',
            message: `Blocked: ${danger.patterns.join(', ')}`,
          };
        }
      }
    }

    // 3. Check permission registry
    const decision = permissionRegistry.evaluate(toolName, input);
    if (decision === 'deny') {
      const summary =
        typeof input === 'object' && input
          ? JSON.stringify(input).slice(0, 100)
          : String(input).slice(0, 100);
      denialTracker.record(toolName, summary);
      return { behavior: 'deny', message: 'Denied by permission registry' };
    }

    // For Phase 1: auto-approve 'ask' decisions (no UI integration yet)
    return { behavior: 'allow' };
  };
}

// ============================================================================
// OpenAgentSdkAgent
// ============================================================================

export class OpenAgentSdkAgent extends BaseAgent {
  readonly provider: AgentProvider = 'open-agent-sdk';

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('idle');

    try {
      const sessionCwd = await getSessionWorkDir(
        options?.cwd ?? this.config.workDir,
        prompt,
        options?.taskId,
      );

      yield { type: 'session', sessionId: session.id, cwd: sessionCwd };

      const sandboxOpts: SandboxOptions | undefined = options?.sandbox?.enabled
        ? {
            enabled: true,
            image: options.sandbox.image,
            apiEndpoint: options.sandbox.apiEndpoint,
          }
        : undefined;

      const basePrompt =
        getWorkspaceInstruction(
          sessionCwd,
          sandboxOpts,
          options?.userWorkspaceDir,
          options?.allowWorkspaceWrite,
        ) + this.buildPromptWithContext(prompt, options);

      const fullPrompt = formatConversationPrompt(
        options?.conversation,
        basePrompt,
      );

      // Budget enforcement
      const minRemainingUsd = getRemainingBudgetUsd();
      if (minRemainingUsd <= 0 && minRemainingUsd !== Infinity) {
        yield {
          type: 'error',
          message: 'Session budget limit reached',
          subtype: 'budget_exceeded',
        };
        yield { type: 'done' };
        return;
      }

      // Safety pipeline
      const denialTracker = new DenialTracker();
      const permissionRegistry = new ToolPermissionRegistry();

      const model = this.config.model ?? DEFAULT_AGENT_MODEL;
      const apiKey = resolveApiKey(this.config, model);
      const apiType = resolveApiType(model, this.config.baseUrl);
      const sdkEffort = mapSdkEffort(options?.thinkingConfig?.effort);

      if (!apiKey) {
        logger.error(
          `[${session.id}] No API key available. Set ANTHROPIC_API_KEY or configure an API key in Settings > Providers.`,
        );
        yield {
          type: 'error',
          message:
            'Open Agent SDK requires an API key. Configure one in Settings > Providers, or set ANTHROPIC_API_KEY environment variable.',
        };
        yield { type: 'done' };
        return;
      }

      const sdkOpts: SdkAgentOptions = {
        model,
        apiType,
        apiKey,
        ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
        cwd: sessionCwd,
        maxTurns: options?.maxTurns ?? DEFAULT_MAX_TURNS,
        // Override SDK's default system prompt — we inject our own context
        systemPrompt: '',
        appendSystemPrompt: options?.systemContext ?? '',
        canUseTool: buildCanUseToolCallback(denialTracker, permissionRegistry),
        permissionMode: 'default',
        includePartialMessages: false,
        thinking: mapThinkingConfig(model, options?.thinkingConfig),
        ...(sdkEffort ? { effort: sdkEffort } : {}),
        // Disable SDK session persistence — we use SQLite
        persistSession: false,
        // Disable SDK's settings discovery — we pass context explicitly
        settingSources: [],
        // Budget
        ...(minRemainingUsd !== Infinity && minRemainingUsd > 0
          ? { maxBudgetUsd: minRemainingUsd }
          : {}),
        // Abort
        ...(options?.abortController
          ? { abortController: options.abortController }
          : {}),
      };

      const processor = new SdkMessageProcessor();
      const startMs = Date.now();
      let turnCount = 0;

      logger.info(
        `[${session.id}] Starting query with model=${model} apiType=${apiType} hasApiKey=${!!apiKey}`,
      );

      for await (const msg of query({ prompt: fullPrompt, options: sdkOpts })) {
        if (options?.abortController?.signal.aborted) break;

        // Usage logging on result messages
        if (msg.type === 'result') {
          turnCount++;
          logUsage({
            sessionId: session.id,
            taskId: options?.taskId,
            callType: 'agent',
            provider: detectProvider(model),
            model,
            totalCostUsd: msg.total_cost_usd,
            inputTokens: msg.usage?.input_tokens,
            outputTokens: msg.usage?.output_tokens,
            cacheReadTokens: msg.usage?.cache_read_input_tokens,
            latencyMs: Date.now() - startMs,
            metadata: { phase: 'run', turns: msg.num_turns },
          });
        }

        yield* processor.process(msg);
      }

      logger.info(
        `[${session.id}] Query completed. Turns: ${turnCount}, Duration: ${Date.now() - startMs}ms`,
      );
    } catch (err) {
      logger.error(`[${session.id}] Error: ${err}`);

      const errMsg = err instanceof Error ? err.message : String(err);

      // Error classification
      if (errMsg.includes('context_length') || errMsg.includes('max_tokens')) {
        yield {
          type: 'error',
          subtype: 'context_length_exceeded',
          message: errMsg,
        };
      } else if (
        errMsg.includes('Invalid API key') ||
        errMsg.includes('authentication') ||
        errMsg.includes('401')
      ) {
        yield { type: 'error', message: '__API_KEY_ERROR__' };
      } else {
        yield { type: 'error', message: errMsg };
      }
    } finally {
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }

  async *plan(
    prompt: string,
    options?: PlanOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('planning');

    // Conversational prompts skip plan → approve → execute.
    if (isConversationalPrompt(prompt)) {
      logger.info(
        `[${session.id}] Conversational prompt — skipping plan approval`,
      );
      yield { type: 'direct_answer' };

      try {
        yield* this.run(prompt, options);
      } finally {
        this.sessions.delete(session.id);
      }
      return;
    }

    yield { type: 'session', sessionId: session.id };

    const model = this.config.model ?? DEFAULT_AGENT_MODEL;

    // Like Codex, the SDK handles planning internally.
    // Emit a simple plan and let execute do the actual work.
    const plan: TaskPlan = {
      id: crypto.randomUUID(),
      goal: prompt,
      executionMode: 'standard',
      steps: [
        {
          id: '1',
          description: `Execute task with Open Agent SDK (${model})`,
          status: 'pending' as const,
        },
      ],
      notes:
        'Open Agent SDK will autonomously plan and execute the task in-process.',
      createdAt: new Date(),
    };

    try {
      this.storePlan(plan);
      yield { type: 'plan', plan };
    } finally {
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }

  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      const session = this.createSession('executing');
      yield { type: 'session', sessionId: session.id };
      yield {
        type: 'error',
        message: `Plan not found: ${options.planId}`,
      };
      this.sessions.delete(session.id);
      yield { type: 'done' };
      return;
    }

    // Delegate to run() — it manages its own session and emits done.
    yield* this.run(options.originalPrompt, options);
  }
}

// ============================================================================
// Environment Test
// ============================================================================

async function testEnvironment(
  config: AgentConfig,
): Promise<AdapterEnvironmentReport> {
  const errors: string[] = [];

  // No binary needed — always "found"
  const binaryFound = true;

  const model = config.model ?? DEFAULT_AGENT_MODEL;
  const apiKey = resolveApiKey(config, model);
  const authValid = !!apiKey;
  if (!authValid) {
    errors.push(
      'No API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.',
    );
  }

  return {
    healthy: authValid,
    binaryFound,
    authValid,
    helloProbeOk: false,
    errors,
  };
}

// ============================================================================
// Plugin Metadata & Definition
// ============================================================================

const OPEN_AGENT_SDK_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      description: 'API key (Anthropic or OpenAI-compatible)',
    },
    baseUrl: {
      type: 'string',
      description: 'Custom API base URL for OpenAI-compatible endpoints',
    },
    model: {
      type: 'string',
      default: DEFAULT_AGENT_MODEL,
      description: 'Model to use',
    },
    workDir: {
      type: 'string',
      default: DEFAULT_WORK_DIR,
      description: 'Working directory for file operations',
    },
  },
};

export const OPEN_AGENT_SDK_METADATA = {
  type: 'open-agent-sdk' as const,
  name: 'Open Agent SDK',
  version: '1.0.0',
  description:
    'In-process multi-LLM agent runtime. Supports Anthropic and OpenAI-compatible APIs. No CLI binary required.',
  configSchema: OPEN_AGENT_SDK_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: false,
  supportedModels: [
    DEFAULT_AGENT_MODEL,
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-haiku-4-5-20251001',
    'gpt-4o',
    'deepseek-chat',
    'deepseek-reasoner',
  ],
  defaultModel: DEFAULT_AGENT_MODEL,
  tags: ['multi-llm', 'in-process', 'anthropic', 'openai'],
  transport: 'sdk' as const,
  supportsMcp: 'native' as const,
  supportsSkills: 'none' as const,
  supportsPlanMode: 'orchestrated' as const,
  requiresBinary: false,
  requiresApiKey: true,
  supportsEnvironmentTest: true,
};

export const openAgentSdkPlugin: AgentPlugin = defineAgentPlugin({
  metadata: OPEN_AGENT_SDK_METADATA,
  factory: (config: AgentConfig) => new OpenAgentSdkAgent(config),
  testEnvironment,
  listModels: async () =>
    (OPEN_AGENT_SDK_METADATA.supportedModels ?? []).map((id) => ({
      id,
      label: id,
    })),
});

export { openAgentSdkPlugin as default };
