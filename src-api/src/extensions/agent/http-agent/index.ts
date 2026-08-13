/**
 * HTTP Agent Adapter
 *
 * Generic adapter for any HTTP-based agent endpoint.
 * Supports JSON and SSE streaming responses with SSRF validation.
 */

import crypto from 'crypto';

import {
  ASK_USER_QUESTION_INSTRUCTION,
  AskUserQuestionStreamFilter,
  buildAskUserQuestionToolUse,
  tryExtractAskUserQuestion,
} from '@/core/agent/ask-user-question';
import {
  BaseAgent,
  formatPlanForExecution,
  isConversationalPrompt,
  PLANNING_INSTRUCTION,
} from '@/core/agent/base';
import { defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin, AgentProviderMetadata } from '@/core/agent/plugin';
import type {
  AdapterEnvironmentReport,
  AgentConfig,
  AgentMessage,
  AgentOptions,
  ExecuteOptions,
  PlanOptions,
} from '@/core/agent/types';

import { DEFAULT_WORK_DIR } from '@/config/constants';

import { safeFetch, safeFetchStream } from '@/shared/network-policy/fetch';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';
import { validateBaseUrl } from '@/shared/utils/url-validator';

const HTTP_AGENT_METADATA: AgentProviderMetadata = {
  type: 'http-agent',
  name: 'HTTP Agent',
  version: '1.0.0',
  description:
    'Generic HTTP agent adapter for any REST/SSE endpoint. Supports JSON and streaming responses.',
  configSchema: {
    type: 'object',
    properties: {
      baseUrl: {
        type: 'string',
        description: 'Agent endpoint URL',
      },
      apiKey: {
        type: 'string',
        description: 'Authentication key/token',
      },
      model: {
        type: 'string',
        description: 'Model to use (sent in request body)',
      },
      workDir: {
        type: 'string',
        default: DEFAULT_WORK_DIR,
      },
    },
    required: ['baseUrl'],
  },
  builtin: true,
  supportsPlan: false,
  supportsStreaming: true,
  supportsSandbox: false,
  tags: ['http', 'generic', 'rest'],
  transport: 'http',
  supportsMcp: 'none',
  supportsSkills: 'none',
  supportsPlanMode: 'none',
  requiresApiKey: true,
  supportsEnvironmentTest: true,
};

/**
 * Parse SSE (Server-Sent Events) text into AgentMessage events.
 */
function* parseSseChunk(text: string): Generator<AgentMessage> {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        yield { type: 'done' };
        return;
      }
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const content =
          // OpenAI-style delta
          (
            parsed.choices as Array<{
              delta?: { content?: string };
            }>
          )?.[0]?.delta?.content ||
          // Generic content field
          (typeof parsed.content === 'string' ? parsed.content : undefined);

        if (content) {
          yield { type: 'text', content };
        }
      } catch {
        // Non-JSON data line, emit as text
        if (data) {
          yield { type: 'text', content: data };
        }
      }
    }
  }
}

/**
 * HTTP Agent implementation.
 */
export class HttpAgent extends BaseAgent {
  readonly provider = 'http-agent' as const;
  private currentAbort: AbortController | null = null;

  constructor(config: AgentConfig) {
    super(config);
  }

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const sessionId = options?.sessionId || crypto.randomUUID();
    yield { type: 'session', sessionId };

    const endpointUrl = this.config.baseUrl;
    if (!endpointUrl) {
      yield {
        type: 'error',
        content: 'HTTP agent requires a baseUrl configuration',
      };
      return;
    }

    // Sync hostname-only pre-check for a clean error message.
    // safeFetchStream below adds DNS pinning per-hop.
    const syncCheck = validateBaseUrl(endpointUrl);
    if (!syncCheck.valid) {
      yield {
        type: 'error',
        content: `URL validation failed: ${syncCheck.reason}`,
      };
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    // Prepend the shared AskUserQuestion instruction so http-agent backends
    // can route clarifying-question turns through the same QuestionInput UI
    // as Claude's native AskUserQuestion tool — see
    // `@/core/agent/ask-user-question` for the protocol.
    const promptWithProtocol = `${ASK_USER_QUESTION_INSTRUCTION}\n\n${prompt}`;
    const body = JSON.stringify({
      prompt: promptWithProtocol,
      model: this.config.model,
      conversation: options?.conversation,
      stream: true,
    });

    this.currentAbort = options?.abortController || new AbortController();

    try {
      // safeFetchStream validates per-hop and pins DNS to the resolved IP,
      // closing the DNS rebinding window between validation and connect.
      const response = await safeFetchStream(
        endpointUrl,
        trustedLocalPolicy(),
        {
          method: 'POST',
          headers,
          body,
          signal: this.currentAbort.signal,
        },
      );

      if (response.status < 200 || response.status >= 300) {
        const status = response.status;
        const chunks: Buffer[] = [];
        for await (const chunk of response.stream) {
          chunks.push(chunk as Buffer);
        }
        const errorText = Buffer.concat(chunks).toString('utf-8');
        yield {
          type: 'error',
          content: `HTTP ${status}: ${errorText.slice(0, 500) || 'Unknown error'}`,
          message: `HTTP ${status}`,
        };
        return;
      }

      const contentType = response.headers['content-type'] || '';

      if (contentType.includes('text/event-stream')) {
        const decoder = new TextDecoder();
        const askFilter = new AskUserQuestionStreamFilter();
        for await (const chunk of response.stream) {
          const text = decoder.decode(chunk as Buffer, { stream: true });
          for (const msg of parseSseChunk(text)) {
            // Route assistant text through the AskUserQuestion filter so a
            // fenced `neuma:ask_user_question` block is rewritten into a
            // synthetic tool_use event. Non-text events (done/error/…)
            // pass through unchanged.
            if (msg.type === 'text' && typeof msg.content === 'string') {
              yield* askFilter.pushChunk(msg.content);
            } else {
              yield* askFilter.flush();
              yield msg;
            }
          }
        }
        yield* askFilter.flush();
      } else {
        // Non-streaming JSON response
        const chunks: Buffer[] = [];
        for await (const chunk of response.stream) {
          chunks.push(chunk as Buffer);
        }
        const data = JSON.parse(
          Buffer.concat(chunks).toString('utf-8'),
        ) as Record<string, unknown>;
        const content =
          typeof data.content === 'string'
            ? data.content
            : typeof data.result === 'string'
              ? data.result
              : JSON.stringify(data);
        // Same bridge as the streaming path: a complete response can
        // itself be a `neuma:ask_user_question` block.
        const askUser = tryExtractAskUserQuestion(content);
        if (askUser) {
          yield buildAskUserQuestionToolUse(askUser);
        } else {
          yield { type: 'result', content };
        }
      }

      yield { type: 'done' };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: 'done' };
        return;
      }
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.currentAbort = null;
    }
  }

  async *plan(
    prompt: string,
    options?: PlanOptions,
  ): AsyncGenerator<AgentMessage> {
    if (isConversationalPrompt(prompt)) {
      yield { type: 'direct_answer' };
      yield* this.run(prompt, options);
      return;
    }
    yield* this.run(`${PLANNING_INSTRUCTION}\n\n${prompt}`, options);
  }

  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      yield {
        type: 'error',
        content: `Plan not found: ${options.planId}`,
      };
      return;
    }
    yield* this.run(formatPlanForExecution(plan), options);
  }

  async stop(sessionId: string): Promise<void> {
    if (this.currentAbort) {
      this.currentAbort.abort();
    }
    await super.stop(sessionId);
  }
}

export function createHttpAgent(config: AgentConfig): HttpAgent {
  return new HttpAgent(config);
}

async function testHttpEnvironment(
  config: AgentConfig,
): Promise<AdapterEnvironmentReport> {
  const errors: string[] = [];
  let healthy = false;
  const authValid = !!config.apiKey;

  if (!config.baseUrl) {
    errors.push('No endpoint URL configured');
    return {
      healthy: false,
      binaryFound: true, // N/A for HTTP
      authValid,
      helloProbeOk: false,
      errors,
    };
  }

  // Sync hostname-only pre-check gives a clean error message without the
  // 'Reachability check failed:' wrapping. safeFetch below adds DNS pinning.
  const syncCheck = validateBaseUrl(config.baseUrl);
  if (!syncCheck.valid) {
    errors.push(`URL validation failed: ${syncCheck.reason}`);
    return {
      healthy: false,
      binaryFound: true,
      authValid,
      helloProbeOk: false,
      errors,
    };
  }

  try {
    // safeFetch validates per-hop and pins DNS to the resolved IP, closing
    // the rebinding window between validation and connect.
    const response = await safeFetch(config.baseUrl, trustedLocalPolicy(), {
      method: 'HEAD',
      timeoutMs: 5000,
      maxRedirects: 0,
    });
    healthy =
      (response.status >= 200 && response.status < 300) ||
      response.status < 500;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(`Reachability check failed: ${msg}`);
  }

  return {
    healthy,
    binaryFound: true, // N/A for HTTP
    authValid,
    helloProbeOk: healthy,
    errors,
  };
}

/**
 * HTTP Agent plugin definition
 */
export const httpAgentPlugin: AgentPlugin = defineAgentPlugin({
  metadata: HTTP_AGENT_METADATA,
  factory: (config) => createHttpAgent(config),
  testEnvironment: testHttpEnvironment,
});
