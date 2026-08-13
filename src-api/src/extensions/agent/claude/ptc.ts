/**
 * Programmatic Tool Calling (PTC) Execution Module
 *
 * Core execution loop that uses the Anthropic Messages API with code_execution
 * tool to allow Claude to write Python code that calls tools programmatically.
 * This eliminates per-tool model round-trips for batch operations.
 *
 * Streaming-first: uses messages.stream() for incremental text delivery,
 * consistent with the codebase's async-generator streaming convention.
 *
 * API format (from official Anthropic docs):
 * - Tools include { type: 'code_execution_20260120', name: 'code_execution' }
 * - MCP tools get allowed_callers: ['code_execution_20260120']
 * - Tool result messages must contain ONLY tool_result blocks (no text)
 * - Container expires after ~4.5 min inactivity
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  ContentBlockParam,
  MessageCreateParamsBase,
  MessageParam,
  Tool,
} from '@anthropic-ai/sdk/resources/messages/messages';

import {
  clampDefaultOutputTokens,
  estimateOutputBudgetInputTokens,
} from '@/core/agent/output-budget';
import type { AgentMessage } from '@/core/agent/types';

import { defendToolOutput } from '@/shared/security/tool-output-defense';
import { logUsage } from '@/shared/services/usage-logger';
import { createLogger } from '@/shared/utils/logger';

import { extractToolResultText } from './ptc-adapter';
import type { PTCOptions, PTCToolDefinition, ToolHandler } from './ptc-types';

const logger = createLogger('ClaudeAgent:PTC');

const DEFAULT_MAX_TOKENS = 64000;
const DEFAULT_MAX_TURNS = 30;
/** SDK request retries for transient 429/500/529 overloads (SDK default is 2). */
const PTC_MAX_API_RETRIES = 5;
/** Max consecutive continuation turns when response is truncated by max_tokens */
const MAX_CONTINUATIONS = 3;

/**
 * PTC-specific extension of the Messages API create params.
 * Adds the `container` field for code execution container reuse
 * and `cache_control` for automatic prompt caching (SDK v0.78.0+).
 * The SDK types don't yet include PTC-specific fields, so we extend here.
 */
interface PTCCreateParams extends MessageCreateParamsBase {
  container?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: any[];
}

/** Minimum interval since last use before a heartbeat is needed (2 min) */
const HEARTBEAT_SKIP_IF_RECENT_MS = 2 * 60 * 1000;

/** Batch guidance prepended to system prompt when PTC is active */
const BATCH_GUIDANCE = `You have access to programmatic tool calling. For batch operations:
1. Use code execution to iterate over items and call tools programmatically
2. Process and filter results in code — don't load raw data into context
3. Return only the summary with actionable items
4. Handle errors per-item (don't let one failure stop the batch)`;

/**
 * Build the tools array for the Messages API with PTC enabled.
 *
 * Includes the code_execution tool and all MCP tools with allowed_callers
 * set so the code execution container can invoke them.
 *
 * When useToolSearch is true, adds tool_search and sets defer_loading on MCP
 * tools so only relevant tools are loaded into context.
 */
function buildPTCApiTools(
  toolDefs: PTCToolDefinition[],
  useToolSearch: boolean,
): PTCCreateParams['tools'] {
  const codeExecTool = {
    type: 'code_execution_20260120' as const,
    name: 'code_execution' as const,
  };

  const mcpTools = toolDefs.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Tool.InputSchema,
    allowed_callers: ['code_execution_20260120'],
    ...(useToolSearch ? { defer_loading: true } : {}),
    ...(t.input_examples?.length ? { input_examples: t.input_examples } : {}),
  }));

  if (useToolSearch) {
    const toolSearchTool = {
      type: 'tool_search_tool_bm25_20251119' as const,
      name: 'tool_search' as const,
    };
    return [codeExecTool, toolSearchTool, ...mcpTools];
  }

  return [codeExecTool, ...mcpTools];
}

/** Mutable container for streamTurn results (avoids yield* return-type issues) */
interface StreamTurnResult {
  response: Anthropic.Message;
  containerId?: string;
  /** ISO 8601 timestamp when the container expires (~4.5 min inactivity) */
  containerExpiresAt?: string;
}

/**
 * Stream a single API turn, yielding text deltas in real-time.
 * Stores the final accumulated message, container ID, and expires_at in `out`.
 */
async function* streamTurn(
  client: Anthropic,
  params: PTCCreateParams,
  signal: AbortSignal | undefined,
  out: StreamTurnResult,
  taskId?: string,
): AsyncGenerator<AgentMessage> {
  const turnStart = Date.now();
  const stream = client.messages.stream(
    // The SDK's stream() overloads don't cover PTCCreateParams with `container`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params as any,
    signal ? { signal } : undefined,
  );

  try {
    for await (const event of stream) {
      // Stream text deltas to the frontend in real-time
      if (event.type === 'content_block_delta') {
        // PTC delta types (text_delta) not yet in SDK typings
        const delta = event.delta as { type?: string; text?: string };
        if (delta.type === 'text_delta' && delta.text) {
          yield { type: 'text', content: delta.text };
        }
      }

      // Capture container info from stream events (PTC-specific fields not yet in SDK)
      if (event.type === 'message_start') {
        const container = (event.message as unknown as Record<string, unknown>)
          .container as { id?: string; expires_at?: string } | undefined;
        if (container?.id) {
          out.containerId = container.id;
          if (container.expires_at)
            out.containerExpiresAt = container.expires_at;
        }
      }
      if (event.type === 'message_delta') {
        const container = (event.delta as unknown as Record<string, unknown>)
          .container as { id?: string; expires_at?: string } | undefined;
        if (container?.id) {
          out.containerId = container.id;
          if (container.expires_at)
            out.containerExpiresAt = container.expires_at;
        }
      }
    }

    out.response = await stream.finalMessage();

    // Log PTC turn usage
    const usage = out.response?.usage;
    if (usage) {
      const usageExt = usage as typeof usage & {
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
        output_tokens_details?: { thinking_tokens?: number } | null;
      };
      logUsage({
        taskId,
        callType: 'ptc',
        provider: 'anthropic',
        model: out.response.model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        reasoningOutputTokens: usageExt.output_tokens_details?.thinking_tokens,
        outputTokensDetails: usageExt.output_tokens_details,
        cacheReadTokens: usageExt.cache_read_input_tokens,
        cacheCreationTokens: usageExt.cache_creation_input_tokens,
        latencyMs: out.response.usage ? Date.now() - turnStart : undefined,
      });
    }
  } catch (error) {
    // Ensure the underlying HTTP connection is cleaned up on error or consumer abort
    stream.abort();
    throw error;
  }
}

/**
 * Execute a PTC session — the core agentic loop.
 *
 * Uses streaming for incremental text delivery. Tool calls are dispatched
 * after each turn's stream completes (full input needed for dispatch).
 */
export async function* executePTC(
  prompt: string,
  toolDefs: PTCToolDefinition[],
  toolHandlers: Map<string, ToolHandler>,
  options: PTCOptions,
): AsyncGenerator<AgentMessage> {
  const client =
    options.client ??
    new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      // Absorb transient 429/500/529 "Overloaded" responses: the SDK retries
      // these with exponential backoff (honouring retry-after) before any
      // streaming starts, so bumping past the default of 2 rides out short
      // upstream overloads instead of surfacing a hard error to the user.
      maxRetries: PTC_MAX_API_RETRIES,
    });

  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;

  // Try with tool_search first for better context management;
  // fall back to eager loading if API rejects tool_search
  let useToolSearch = toolDefs.length > 10;
  let apiTools = buildPTCApiTools(toolDefs, useToolSearch);

  // Build system prompt with batch guidance.
  // Use content-block format so cache_control can be set on the last block
  // (the Anthropic API applies prompt caching per-block, not top-level).
  const systemParts: string[] = [BATCH_GUIDANCE];
  if (options.systemPrompt) {
    systemParts.push(options.systemPrompt);
  }
  const system = [
    {
      type: 'text' as const,
      text: systemParts.join('\n\n'),
      cache_control: { type: 'ephemeral' as const },
    },
  ];

  const maxTokens =
    clampDefaultOutputTokens(
      { id: options.model },
      {
        explicitMaxTokens: options.maxTokens,
        defaultMaxTokens: DEFAULT_MAX_TOKENS,
        inputTokens: estimateOutputBudgetInputTokens(
          `${prompt}\n\n${systemParts.join('\n\n')}`,
        ),
      },
    ) ?? DEFAULT_MAX_TOKENS;

  const messages: MessageParam[] = [{ role: 'user', content: prompt }];
  let containerId = options.containerId;
  let turn = 0;
  let continuations = 0;

  logger.info(
    `PTC session starting: ${toolDefs.length} tools, model=${options.model}, maxTurns=${maxTurns}, toolSearch=${useToolSearch}`,
  );

  while (turn < maxTurns) {
    turn++;

    if (options.abortSignal?.aborted) {
      logger.info('PTC session aborted by signal');
      break;
    }

    logger.info(`PTC turn ${turn}/${maxTurns}`);

    const createParams: PTCCreateParams = {
      model: options.model,
      max_tokens: maxTokens,
      system,
      messages,
      tools: apiTools,
      ...(containerId ? { container: containerId } : {}),
    };

    // Stream the turn — text deltas flow through via yield*
    const turnResult = {} as StreamTurnResult;

    try {
      yield* streamTurn(
        client,
        createParams,
        options.abortSignal,
        turnResult,
        options.taskId,
      );
    } catch (error) {
      // Handle user abort gracefully
      if (options.abortSignal?.aborted) {
        logger.info('PTC session aborted by signal');
        break;
      }

      const msg = error instanceof Error ? error.message : String(error);

      // Fallback: if tool_search was rejected, retry without it
      if (useToolSearch && turn === 1 && msg.includes('tool_search')) {
        logger.warn(
          'PTC: tool_search not supported, retrying with eager loading',
        );
        useToolSearch = false;
        apiTools = buildPTCApiTools(toolDefs, false);
        // Rebuild params with updated tools for the retry
        const retryParams: PTCCreateParams = {
          ...createParams,
          tools: apiTools,
        };
        try {
          yield* streamTurn(
            client,
            retryParams,
            options.abortSignal,
            turnResult,
            options.taskId,
          );
        } catch (retryError) {
          if (options.abortSignal?.aborted) break;
          const retryMsg =
            retryError instanceof Error
              ? retryError.message
              : String(retryError);
          logger.error(`PTC API error on retry: ${retryMsg}`);
          yield { type: 'error', message: `PTC API error: ${retryMsg}` };
          return;
        }
      } else {
        logger.error(`PTC API error on turn ${turn}: ${msg}`);
        yield { type: 'error', message: `PTC API error: ${msg}` };
        return;
      }
    }

    const response = turnResult.response;

    // Update container ID for lifecycle management
    if (turnResult.containerId && turnResult.containerId !== containerId) {
      containerId = turnResult.containerId;
      logger.debug(
        `PTC container: ${containerId}${turnResult.containerExpiresAt ? ` expires=${turnResult.containerExpiresAt}` : ''}`,
      );
      options.onContainerId?.(containerId, turnResult.containerExpiresAt);
    }

    // Process non-text content blocks from the final message
    // (text was already streamed in real-time via streamTurn)
    const assistantContent = response.content as unknown as ContentBlockParam[];
    const toolResults: ContentBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === 'server_tool_use') {
        yield {
          type: 'tool_use',
          name: block.name,
          input: block.input as Record<string, unknown>,
          id: block.id,
        };
      } else if (block.type === 'code_execution_tool_result') {
        // Extract stdout/stderr/return_code from the code execution result
        // Docs: content = { type, stdout, stderr, return_code, content }
        // PTC-specific block shape not yet in SDK typings
        const execResult = (block as unknown as Record<string, unknown>)
          .content as
          | {
              stdout?: string;
              stderr?: string;
              return_code?: number;
              content?: unknown[];
            }
          | undefined;

        const stdout = execResult?.stdout ?? '';
        const stderr = execResult?.stderr ?? '';

        if (stderr) {
          logger.warn(`PTC code execution stderr: ${stderr.slice(0, 500)}`);
        }
        if (
          execResult?.return_code !== undefined &&
          execResult.return_code !== 0
        ) {
          logger.warn(
            `PTC code execution return_code: ${execResult.return_code}`,
          );
        }

        // Yield stdout as the visible output (not raw JSON of the entire block)
        yield {
          type: 'tool_result',
          toolUseId: block.tool_use_id,
          output: stdout || (stderr ? `Error: ${stderr}` : ''),
        };
      } else if (block.type === 'tool_use') {
        // MCP tool calls dispatched by the code execution container
        const toolBlock = block as ContentBlock & {
          type: 'tool_use';
          id: string;
          name: string;
          input: unknown;
        };

        yield {
          type: 'tool_use',
          name: toolBlock.name,
          input: toolBlock.input as Record<string, unknown>,
          id: toolBlock.id,
        };

        // Dispatch to local handler
        const handler = toolHandlers.get(toolBlock.name);
        if (handler) {
          try {
            const permission = await options.canUseTool?.(
              toolBlock.name,
              toolBlock.input,
              options.abortSignal,
              toolBlock.id,
            );
            if (permission?.behavior === 'deny') {
              const message = permission.message ?? 'Permission denied';
              yield {
                type: 'tool_result',
                toolUseId: toolBlock.id,
                output: `Error: ${message}`,
                isError: true,
              };
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolBlock.id,
                content: `Error: ${message}`,
                is_error: true,
              });
              continue;
            }

            const result = await handler(toolBlock.input);
            const text = extractToolResultText(result);

            // Phase 7: defend before reinsertion. Claude requires that
            // tool-result messages contain ONLY tool_result blocks, so we
            // pass defended modelContent verbatim — no extra text.
            const defended = defendToolOutput({
              source: {
                adapter: 'claude-ptc',
                toolName: toolBlock.name,
                toolUseId: toolBlock.id,
              },
              content: text,
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

            yield {
              type: 'tool_result',
              toolUseId: toolBlock.id,
              output: defended.displayContent,
              security: {
                verdict: defended.verdict,
                source: 'claude-ptc',
                payloadHash: defended.audit.payloadHash,
                redactedSnippet: defended.redactedSnippet,
                scores: defended.scores as Record<string, number>,
              },
            };

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: defended.modelContent,
              is_error: defended.verdict === 'BLOCK' ? true : undefined,
            });
          } catch (error) {
            const errMsg =
              error instanceof Error ? error.message : String(error);
            logger.error(`PTC tool "${toolBlock.name}" error: ${errMsg}`);

            yield {
              type: 'tool_result',
              toolUseId: toolBlock.id,
              output: `Error: ${errMsg}`,
            };

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: `Error: ${errMsg}`,
              is_error: true,
            });
          }
        } else {
          logger.warn(`PTC: no handler for tool "${toolBlock.name}"`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: `Error: unknown tool "${toolBlock.name}"`,
            is_error: true,
          });
        }
      }
    }

    // Check stop reason — use structured stop_details (SDK ≥0.82.0) when
    // available, falling back to the flat stop_reason string for compat.
    // Cast to Record to read the type field as a plain string — the SDK
    // typings lag behind the API and don't include all stop_details.type values.
    const stopDetails = (response as unknown as Record<string, unknown>)
      .stop_details as
      | {
          type?: string;
          reason?: string;
          category?: string | null;
          explanation?: string | null;
        }
      | undefined;

    if (response.stop_reason === 'end_turn') {
      logger.info(`PTC session ended: end_turn after ${turn} turns`);
      continuations = 0;
      break;
    }

    if (response.stop_reason === 'refusal') {
      const categoryText = stopDetails?.category
        ? ` category=${stopDetails.category}`
        : '';
      const explanationText = stopDetails?.explanation
        ? `: ${stopDetails.explanation}`
        : '';
      const message = `Model refusal${categoryText}${explanationText}`;
      logger.warn(`PTC session stopped: ${message}`);
      yield {
        type: 'error',
        message,
        subtype: 'model_refusal',
      };
      break;
    }

    if (response.stop_reason === 'max_tokens') {
      // Distinguish context window overflow from regular output truncation.
      // When the model's context window is exhausted, retrying with
      // "Continue" will fail — bail out immediately with a clear message.
      if (stopDetails?.type === 'model_context_window_exceeded') {
        logger.warn(
          `PTC session stopped: context window exceeded after ${turn} turns`,
        );
        yield {
          type: 'text',
          content:
            '\n\n[Context window exceeded — conversation too long for this model]',
        };
        break;
      }

      continuations++;
      if (continuations > MAX_CONTINUATIONS) {
        logger.warn(
          `PTC session truncated: hit max_tokens ${continuations} times, stopping`,
        );
        yield {
          type: 'text',
          content:
            '\n\n[Response truncated — output token limit reached after multiple continuations]',
        };
        break;
      }
      // Continue from where Claude left off (per Anthropic best practice)
      logger.info(
        `PTC max_tokens hit (continuation ${continuations}/${MAX_CONTINUATIONS}), requesting continuation`,
      );
      messages.push({ role: 'assistant', content: assistantContent });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Continue from where you left off.',
          },
        ],
      });
      continue;
    }

    // If tool_use, append assistant content + tool results and loop
    if (response.stop_reason === 'tool_use' && toolResults.length > 0) {
      continuations = 0;
      messages.push({ role: 'assistant', content: assistantContent });
      // Tool result messages must contain ONLY tool_result blocks
      messages.push({ role: 'user', content: toolResults });
    } else if (response.stop_reason === 'pause_turn') {
      // Long-running turn paused — feed response back to continue
      messages.push({ role: 'assistant', content: assistantContent });
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'Continue.' }],
      });
    } else {
      // No tool calls needed, we're done
      logger.info(
        `PTC session completed: stop_reason=${response.stop_reason}, turns=${turn}`,
      );
      break;
    }
  }

  if (turn >= maxTurns) {
    logger.warn(`PTC session hit max turns limit (${maxTurns})`);
    yield {
      type: 'text',
      content: '\n\n[Batch execution reached maximum turn limit]',
    };
  }
}

// ============================================================================
// Container Lifecycle Management
// ============================================================================

/**
 * Default heartbeat interval: container expires after ~4.5 min inactivity.
 * We heartbeat 1 min before the default expiry to provide margin.
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;
/** Max container age before forced cleanup */
const MAX_CONTAINER_AGE_MS = 30 * 60 * 1000;

interface ContainerEntry {
  containerId: string;
  createdAt: number;
  lastUsed: number;
  /** ISO 8601 expiry from API — used to compute adaptive heartbeat timing */
  expiresAt?: string;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

/**
 * Manages PTC container lifecycle: reuse across executions within a session,
 * heartbeat pings to prevent expiration, and cleanup on session stop.
 */
export class ContainerManager {
  private containers = new Map<string, ContainerEntry>();

  /** Get an existing container for a session, or undefined */
  get(sessionId: string): string | undefined {
    const entry = this.containers.get(sessionId);
    if (!entry) return undefined;

    // Check if container is too old
    if (Date.now() - entry.createdAt > MAX_CONTAINER_AGE_MS) {
      logger.info(
        `Container for session ${sessionId} expired (age), cleaning up`,
      );
      this.remove(sessionId);
      return undefined;
    }

    entry.lastUsed = Date.now();
    return entry.containerId;
  }

  /** Store a container ID for a session and start heartbeat */
  set(
    sessionId: string,
    containerId: string,
    client: Anthropic,
    model: string,
    expiresAt?: string,
  ): void {
    // Clean up any existing container for this session
    this.remove(sessionId);

    // Compute adaptive heartbeat interval: 1 min before expiry if available,
    // otherwise fall back to default (3 min for ~4.5 min expiry window)
    let heartbeatMs = DEFAULT_HEARTBEAT_INTERVAL_MS;
    if (expiresAt) {
      const expiryMs = new Date(expiresAt).getTime() - Date.now();
      if (expiryMs > 60_000) {
        // Heartbeat 1 minute before expiry
        heartbeatMs = Math.max(60_000, expiryMs - 60_000);
      }
    }

    const entry: ContainerEntry = {
      containerId,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      expiresAt,
      heartbeatTimer: null,
    };

    // Start heartbeat to keep container alive
    entry.heartbeatTimer = setInterval(() => {
      this.heartbeat(sessionId, client, model).catch((err) => {
        logger.warn(
          `Container heartbeat failed for session ${sessionId}: ${err}`,
        );
        this.remove(sessionId);
      });
    }, heartbeatMs);

    this.containers.set(sessionId, entry);
    logger.debug(
      `Container ${containerId} stored for session ${sessionId} (heartbeat: ${Math.round(heartbeatMs / 1000)}s)`,
    );
  }

  /** Remove and cleanup a container for a session */
  remove(sessionId: string): void {
    const entry = this.containers.get(sessionId);
    if (entry) {
      if (entry.heartbeatTimer) {
        clearInterval(entry.heartbeatTimer);
      }
      this.containers.delete(sessionId);
      logger.debug(
        `Container ${entry.containerId} removed for session ${sessionId}`,
      );
    }
  }

  /** Cleanup all containers */
  cleanup(): void {
    for (const [sessionId] of this.containers) {
      this.remove(sessionId);
    }
  }

  /** Send a minimal heartbeat to keep the container alive */
  private async heartbeat(
    sessionId: string,
    client: Anthropic,
    model: string,
  ): Promise<void> {
    const entry = this.containers.get(sessionId);
    if (!entry) return;

    // Skip heartbeat if the container was recently used (avoids unnecessary API calls)
    if (Date.now() - entry.lastUsed < HEARTBEAT_SKIP_IF_RECENT_MS) {
      logger.debug(
        `Skipping heartbeat for container ${entry.containerId} (recently used)`,
      );
      return;
    }

    logger.debug(
      `Sending heartbeat for container ${entry.containerId} (session ${sessionId})`,
    );

    // PTCCreateParams includes `container` which the base SDK types don't cover
    const heartbeatParams: PTCCreateParams = {
      model,
      max_tokens: 32,
      messages: [{ role: 'user', content: 'ping' }],
      tools: [
        {
          type: 'code_execution_20260120',
          name: 'code_execution',
        },
      ],
      container: entry.containerId,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.messages.create(heartbeatParams as any);

    entry.lastUsed = Date.now();
  }
}
