import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { ArtifactEnvelopeTextFilter } from '@/core/agent/artifact-envelope-filter';
import { ThinkingConfigShape } from '@/core/agent/context-resolver';
import { prepareTaskRun } from '@/core/agent/prepare-task-run';
import {
  agentQuestionService,
  serializeAgentQuestion,
} from '@/core/agent/questions';
import {
  RunContextEnvelopeInputSchema,
  RunContextError,
} from '@/core/agent/run-context';
import { AGENT_TYPE_IDS, normalizeAgentType } from '@/core/agent/runtime-ids';
import { shouldRolloverNativeSession } from '@/core/agent/runtime-state';
import {
  canAcceptTask,
  getGlobalStats,
  getQueueState,
  onTaskComplete,
  QUEUE_EVENTS,
  tryExecuteOrQueue,
} from '@/core/queue-manager';

import { DEFAULT_AGENT_PROVIDER } from '@/config/constants';

import {
  getAgentResumeIdentity,
  resumeIdentityMismatch,
  upsertAgentResumeIdentity,
} from '@/shared/db/agent-resume-identity';
import {
  AgentRunConflictError,
  createMessage,
  createSession as createDbSession,
  createTask as createDbTask,
  finishAgentRun,
  getSession as getDbSession,
  getSetting,
  getTask as getDbTask,
  markZombieTasks,
  messageExists,
  touchTask,
  updateTask,
  updateTaskFromMessage,
  updateTaskHeartbeat,
} from '@/shared/db/operations';
import { activeQueryStore } from '@/shared/services/active-query-store';
import {
  createSession,
  deleteSession,
  getPlan,
  getSession,
  runAgent,
  runAgentResume,
  runExecutionPhase,
  runPlanningPhase,
} from '@/shared/services/agent';
import {
  registerExternalMcpRunLauncher,
  registerExternalMcpRunSession,
} from '@/shared/services/external-mcp/run-commands';
import { taskEventBus } from '@/shared/services/task-event-bus';
import { generateTitle } from '@/shared/services/title-generator';
import { resolveBillingType } from '@/shared/services/usage-logger';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';
import {
  checkPermission,
  validateWorkDir,
} from '@/shared/utils/path-validator';
import type {
  AllowedFolder,
  OperationType,
} from '@/shared/utils/path-validator';
import {
  extractStructuredDirectAnswer,
  parseStructuredEnvelope,
} from '@/shared/utils/structured-envelope';
import { classifyTask } from '@/shared/utils/task-classifier';
import { validateBaseUrlForFetch } from '@/shared/utils/url-validator';

const logger = createLogger('AgentAPI');

function safeUrlHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '<invalid>';
  }
}

/**
 * Validate, resolve, and authorize a user-supplied workDir.
 *
 * Combines path validation (blocked paths, symlinks) with optional
 * folder-permission authorization into a single call to avoid duplication.
 *
 * @returns `{ ok: true, resolved }` on success, or `{ ok: false, error, status }` on failure.
 */
function validateAndAuthorizeWorkDir(
  workDir: string | undefined,
  allowedFolders?: AllowedFolder[],
  operation: OperationType = 'write',
):
  | { ok: true; resolved: string | undefined }
  | { ok: false; error: string; status: 400 | 403 } {
  if (!workDir) {
    return { ok: true, resolved: undefined };
  }

  // Step 1: Validate the path (blocked system dirs, symlink resolution)
  const validation = validateWorkDir(workDir);
  if (!validation.valid) {
    return {
      ok: false,
      error: `Invalid work directory: ${validation.error}`,
      status: 400,
    };
  }

  // Step 2: Enforce folder permissions when provided
  if (allowedFolders && allowedFolders.length > 0) {
    const permCheck = checkPermission(
      validation.resolved,
      operation,
      allowedFolders,
    );
    if (!permCheck.allowed) {
      logger.warn('Folder permission denied:', {
        workDir: validation.resolved,
        reason: permCheck.reason,
      });
      return {
        ok: false,
        error: `Folder permission denied: ${permCheck.reason}`,
        status: 403,
      };
    }
  }

  return { ok: true, resolved: validation.resolved };
}

const ThinkingConfigSchema = ThinkingConfigShape.extend({
  type: ThinkingConfigShape.shape.type.default('adaptive'),
}).optional();

// Shared schema fragments
const ModelConfigSchema = z
  .object({
    providerId: z.string().min(1).max(180).optional(),
    dialect: z.enum(['standard', 'kimi-k3']).optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    // Canonical runtime ids from `@/core/agent/runtime-ids` — stale aliases
    // from older clients (e.g. `cursor-local`) normalize before validation
    // so the enum stays the single source of accepted ids.
    agentType: z
      .string()
      .transform(normalizeAgentType)
      .pipe(z.enum(AGENT_TYPE_IDS))
      .optional(),
  })
  .optional();

const SandboxConfigSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.string().optional(),
    image: z.string().optional(),
    apiEndpoint: z.string().optional(),
    providerConfig: z.record(z.string(), z.unknown()).optional(),
  })
  .optional();

const SkillsConfigSchema = z
  .object({
    enabled: z.boolean(),
    userDirEnabled: z.boolean(),
    appDirEnabled: z.boolean(),
    skillsPath: z.string().optional(),
  })
  .optional();

const McpConfigSchema = z
  .object({
    enabled: z.boolean(),
    userDirEnabled: z.boolean(),
    appDirEnabled: z.boolean(),
    mcpConfigPath: z.string().optional(),
  })
  .optional();

const AllowedFoldersSchema = z
  .array(
    z.object({
      path: z.string(),
      permissions: z.object({
        read: z.boolean(),
        write: z.boolean(),
        delete: z.boolean(),
      }),
    }),
  )
  .optional();

const RuntimeContextSchema = z
  .object({
    timezone: z.string().optional(),
    locale: z.string().optional(),
    platform: z
      .object({
        os: z.string().optional(),
        version: z.string().optional(),
        arch: z.string().optional(),
      })
      .optional(),
    geolocation: z
      .object({
        latitude: z.number(),
        longitude: z.number(),
        accuracy: z.number().optional(),
      })
      .optional(),
  })
  .optional();

// Request schemas
const PlanRequestSchema = z.object({
  prompt: z.string().min(1),
  sessionId: z.string().optional(),
  taskId: z.string().optional(),
  pluginId: z.string().min(1).max(180).optional(),
  pluginInputs: z.record(z.string(), z.unknown()).optional(),
  language: z.string().optional(),
  runtimeContext: RuntimeContextSchema,
  modelConfig: ModelConfigSchema,
  workDir: z.string().optional(),
  allowedFolders: AllowedFoldersSchema,
  mentionedMcpServers: z.array(z.string()).optional(),
  agentProfileId: z.string().optional(),
  thinkingConfig: ThinkingConfigSchema,
});

const ExecuteRequestSchema = z.object({
  planId: z.string().min(1),
  sessionId: z.string().optional(),
  prompt: z.string().optional(),
  conversation: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .optional(),
  workDir: z.string().optional(),
  userWorkspaceDir: z.string().optional(),
  allowWorkspaceWrite: z.boolean().optional(),
  taskId: z.string().optional(),
  pluginId: z.string().min(1).max(180).optional(),
  pluginInputs: z.record(z.string(), z.unknown()).optional(),
  modelConfig: ModelConfigSchema,
  sandboxConfig: SandboxConfigSchema,
  skillsConfig: SkillsConfigSchema,
  mcpConfig: McpConfigSchema,
  language: z.string().optional(),
  runtimeContext: RuntimeContextSchema,
  allowedFolders: AllowedFoldersSchema,
  ptcEnabled: z.boolean().optional(),
  mentionedMcpServers: z.array(z.string()).optional(),
  pinnedSkills: z
    .array(z.string().regex(/^[\w][\w.-]*$/))
    .max(3)
    .optional(),
  supplementalSkillIds: z
    .array(z.string().regex(/^[\w][\w.:-]*$/))
    .max(3)
    .optional(),
  runContext: RunContextEnvelopeInputSchema.optional(),
  agentProfileId: z.string().optional(),
  thinkingConfig: ThinkingConfigSchema,
});

const RunRequestSchema = z.object({
  prompt: z.string().min(1),
  sessionId: z.string().optional(),
  conversation: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .optional(),
  workDir: z.string().optional(),
  userWorkspaceDir: z.string().optional(),
  allowWorkspaceWrite: z.boolean().optional(),
  taskId: z.string().optional(),
  pluginId: z.string().min(1).max(180).optional(),
  pluginInputs: z.record(z.string(), z.unknown()).optional(),
  modelConfig: ModelConfigSchema,
  sandboxConfig: SandboxConfigSchema,
  images: z
    .array(
      z.object({
        data: z.string(),
        mimeType: z.string(),
      }),
    )
    .optional(),
  skillsConfig: SkillsConfigSchema,
  mcpConfig: McpConfigSchema,
  language: z.string().optional(),
  runtimeContext: RuntimeContextSchema,
  allowedFolders: AllowedFoldersSchema,
  mentionedMcpServers: z.array(z.string()).optional(),
  pinnedSkills: z
    .array(z.string().regex(/^[\w][\w.-]*$/))
    .max(3)
    .optional(),
  supplementalSkillIds: z
    .array(z.string().regex(/^[\w][\w.:-]*$/))
    .max(3)
    .optional(),
  runContext: RunContextEnvelopeInputSchema.optional(),
  agentProfileId: z.string().optional(),
  thinkingConfig: ThinkingConfigSchema,
  outputFormat: z
    .object({
      type: z.literal('json_schema'),
      schema: z.record(z.string(), z.unknown()),
    })
    .optional(),
  isolation: z.enum(['shared', 'worktree']).optional(),
});

const agentRoutes = new Hono();

// ---- Zombie Process Recovery ----
// On module load, mark any tasks stuck in 'running' without a recent heartbeat
// as 'error'. This handles cases where the API was killed mid-task.
const zombieLogger = createLogger('ZombieRecovery');
try {
  const zombies = markZombieTasks(10);
  if (zombies.length > 0) {
    zombieLogger.info(
      `Recovered ${zombies.length} zombie task(s): ${zombies.map((z) => z.id).join(', ')}`,
    );
  }
} catch (err) {
  // Non-fatal: table might not have heartbeat_at column yet on first run
  zombieLogger.debug('Zombie recovery skipped:', errorMessage(err));
}

/**
 * Ensure a task (and its parent session) exist in SQLite before streaming.
 *
 * The frontend creates session+task via /db/sessions and /db/tasks but those
 * calls can fail silently (network error, timing, etc.). If the task is missing
 * when saveMessageToDatabase runs, every message save throws a FOREIGN KEY
 * constraint error. This guard upserts session+task so streaming is always safe.
 */
function ensureTaskExists(
  taskId: string,
  sessionId: string | undefined,
  prompt: string,
  workDir?: string,
): void {
  try {
    if (getDbTask(taskId)) return; // already exists, fast path

    const sessId = sessionId || taskId; // fall back to taskId as session sentinel
    if (!getDbSession(sessId)) {
      createDbSession({ id: sessId, prompt: prompt.slice(0, 200) });
    }
    createDbTask({
      id: taskId,
      session_id: sessId,
      task_index: 0,
      prompt: prompt.slice(0, 500),
      work_dir: workDir,
    });
    logger.debug(
      `ensureTaskExists: created task ${taskId} in session ${sessId}`,
    );
  } catch (err) {
    // If upsert fails (e.g. concurrent insert), log and continue — the task
    // may have been created by a racing request, so FK errors may resolve.
    logger.warn('ensureTaskExists failed:', errorMessage(err));
  }
}

/**
 * Create an SSE ReadableStream from an async generator.
 * When taskId is provided, messages are:
 * 1. Published to the TaskEventBus for observer clients
 * 2. Saved to the database (backend is single source of truth)
 *
 * When profileId is provided, signals task completion to the queue manager
 * so it can dequeue the next task for that profile.
 */
interface SSEStreamOptions {
  taskId?: string;
  model?: string;
  profileId?: string;
  agentRunId?: string;
  // Provider/model/workspace identity of the run; recorded against the
  // durable native session id so /resume can refuse a mismatched replay.
  resumeIdentity?: {
    providerId: string;
    modelId?: string;
    workspaceRoot?: string;
  };
}

function createSSEStream(
  generator: AsyncGenerator<unknown>,
  opts: SSEStreamOptions = {},
) {
  const { taskId, model, profileId, agentRunId, resumeIdentity } = opts;
  const encoder = new TextEncoder();
  const streamInstanceId = crypto.randomUUID();

  // ---------- Heartbeat for thinking phases ----------
  // Touch task updated_at periodically so frontend stuck detection doesn't
  // fire during extended thinking phases that produce no DB messages.
  let lastHeartbeatTime = 0;
  const HEARTBEAT_INTERVAL_MS = 30_000;

  // ---------- Text accumulation buffer ----------
  // Following the "flush on boundary" pattern (Vercel AI SDK / Convex):
  // stream each text delta to the client immediately for real-time display,
  // but accumulate text in a buffer and flush ONE merged row to the DB when
  // a non-text message (tool_use, tool_result, done, etc.) arrives or the
  // stream ends.  This prevents hundreds of single-token DB rows.
  let textBuffer = '';
  const artifactEnvelopeFilter = new ArtifactEnvelopeTextFilter();

  const flushTextBuffer = () => {
    if (!textBuffer || !taskId) return;
    saveMessageToDatabase(
      taskId,
      streamInstanceId,
      {
        type: 'text',
        content: textBuffer,
      },
      model,
    );
    textBuffer = '';
  };

  return new ReadableStream({
    async start(controller) {
      // Track last tool_use ID for parentId linkage on tool_result messages
      let lastToolUseId: string | undefined;
      let streamSuccess = true;

      try {
        for await (const message of generator) {
          let filteredMessage = message;
          if (
            isAgentStreamMessage(message) &&
            message.type === 'text' &&
            typeof message.content === 'string'
          ) {
            const filteredContent = artifactEnvelopeFilter.push(
              message.content,
            );
            if (!filteredContent) continue;
            filteredMessage = {
              ...message,
              content: filteredContent,
            };
          }

          // Stamp trace metadata for trace viewer timeline
          const msg = filteredMessage as Record<string, unknown>;
          if (!msg.startedAt) {
            msg.startedAt = new Date().toISOString();
          }
          if (msg.type === 'tool_use' && msg.id) {
            lastToolUseId = msg.id as string;
          }
          if (msg.type === 'tool_result' && lastToolUseId && !msg.parentId) {
            msg.parentId = lastToolUseId;
          }

          let streamMessage = filteredMessage;
          let streamEventId: string | undefined;

          if (taskId) {
            // Fan-out: publish to event bus for observer clients
            const bufferedEvent =
              typeof taskEventBus.publishWithEnvelope === 'function'
                ? taskEventBus.publishWithEnvelope(taskId, filteredMessage)
                : undefined;
            if (bufferedEvent) {
              streamMessage = bufferedEvent.message;
              streamEventId = bufferedEvent.id;
            } else {
              taskEventBus.publish(taskId, filteredMessage);
            }
          }

          controller.enqueue(
            encoder.encode(formatSSEMessage(streamMessage, streamEventId)),
          );

          if (taskId) {
            // Accumulate text; flush everything else at boundaries
            const msg = streamMessage as { type?: string; content?: string };
            if (msg.type === 'text' && msg.content) {
              // Deduplicate: skip if this exact text already ends the buffer
              // (Codex SDK can emit identical agent_message items per turn)
              if (
                !(msg.content.length > 20 && textBuffer.endsWith(msg.content))
              ) {
                textBuffer += msg.content;
              }
            } else if (
              msg.type === 'thinking' ||
              msg.type === 'planning_status' ||
              (streamMessage as { isProgress?: boolean }).isProgress
            ) {
              // Transient progress indicators — touch task heartbeat to prevent
              // frontend stuck detection, but don't persist to DB.
              const now = Date.now();
              if (taskId && now - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
                lastHeartbeatTime = now;
                touchTask(taskId);
                updateTaskHeartbeat(taskId);
              }
            } else if (msg.type === 'session') {
              // Update task work_dir with the actual session CWD so the
              // frontend workspace panel / file tree shows the right directory.
              const sessionMsg = streamMessage as {
                cwd?: string;
                sessionId?: string;
                resumeSessionId?: string;
              };
              const durableSessionId =
                sessionMsg.resumeSessionId ?? sessionMsg.sessionId;
              if ((sessionMsg.cwd || durableSessionId) && taskId) {
                try {
                  updateTask(taskId, {
                    work_dir: sessionMsg.cwd,
                    agent_session_id: durableSessionId,
                  });
                } catch {
                  // Non-fatal — task may not exist yet
                }
                if (durableSessionId && resumeIdentity) {
                  try {
                    upsertAgentResumeIdentity({
                      taskId,
                      providerId: resumeIdentity.providerId,
                      modelId: resumeIdentity.modelId,
                      workspaceRoot: resumeIdentity.workspaceRoot,
                      nativeSessionId: durableSessionId,
                    });
                  } catch {
                    // Non-fatal — without a record the resume guard stays
                    // permissive, matching pre-guard behavior.
                  }
                }
              }
            } else {
              // Boundary reached — flush accumulated text first, then save this message
              flushTextBuffer();
              saveMessageToDatabase(
                taskId,
                streamInstanceId,
                streamMessage,
                model,
              );
              // Keep heartbeat fresh on every boundary message
              const now = Date.now();
              if (now - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
                lastHeartbeatTime = now;
                updateTaskHeartbeat(taskId);
              }
            }
          }
        }
      } catch (error) {
        streamSuccess = false;
        const errorMessage = {
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
        let streamErrorMessage: unknown = errorMessage;
        let streamEventId: string | undefined;

        if (taskId) {
          const bufferedEvent =
            typeof taskEventBus.publishWithEnvelope === 'function'
              ? taskEventBus.publishWithEnvelope(taskId, errorMessage)
              : undefined;
          if (bufferedEvent) {
            streamErrorMessage = bufferedEvent.message;
            streamEventId = bufferedEvent.id;
          } else {
            taskEventBus.publish(taskId, errorMessage);
          }
          flushTextBuffer();
          saveMessageToDatabase(
            taskId,
            streamInstanceId,
            streamErrorMessage,
            model,
          );
        }
        controller.enqueue(
          encoder.encode(formatSSEMessage(streamErrorMessage, streamEventId)),
        );
      } finally {
        const tail = artifactEnvelopeFilter.flush();
        if (tail) {
          const tailMessage: AgentStreamMessage & { startedAt: string } = {
            type: 'text',
            content: tail,
            startedAt: new Date().toISOString(),
          };
          let streamMessage: unknown = tailMessage;
          let streamEventId: string | undefined;
          if (taskId) {
            const bufferedEvent =
              typeof taskEventBus.publishWithEnvelope === 'function'
                ? taskEventBus.publishWithEnvelope(taskId, tailMessage)
                : undefined;
            if (bufferedEvent) {
              streamMessage = bufferedEvent.message;
              streamEventId = bufferedEvent.id;
            } else {
              taskEventBus.publish(taskId, tailMessage);
            }
            textBuffer += tail;
          }
          controller.enqueue(
            encoder.encode(formatSSEMessage(streamMessage, streamEventId)),
          );
        }

        // Final flush: persist any remaining buffered text (e.g. last assistant
        // message with no trailing tool call / abort / disconnect).
        if (taskId) {
          flushTextBuffer();
          taskSeqCounters.delete(taskId);
        }

        // Signal queue manager so it can dequeue the next task for this profile
        if (taskId && profileId) {
          try {
            onTaskComplete(taskId, profileId, streamSuccess);
          } catch {
            // Non-fatal — queue manager failure shouldn't break the stream
          }
        }

        if (agentRunId) {
          finishAgentRun({
            id: agentRunId,
            status: streamSuccess ? 'completed' : 'failed',
            completeness: streamSuccess ? 'complete' : 'unfinished',
          });
        }

        controller.close();
      }
    },
  });
}

/** Shape of messages emitted by the agent stream. */
interface AgentStreamMessage {
  type: string;
  content?: string;
  name?: string;
  id?: string; // tool_use block id (from SDK)
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  toolUseId?: string; // tool_result reference id
  subtype?: string;
  message?: string;
  plan?: unknown;
  cost?: number;
  duration?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  model?: string;
  sessionId?: string;
  resumeSessionId?: string;
}

function isAgentStreamMessage(msg: unknown): msg is AgentStreamMessage {
  return typeof msg === 'object' && msg !== null && 'type' in msg;
}

/** Per-task monotonic sequence counter for deterministic message IDs. */
const taskSeqCounters = new Map<string, number>();

/**
 * Generate a unique message ID.
 *
 * For tool messages, the SDK-provided `toolUseId` is inherently unique.
 * For all other messages, stream instance + per-task sequence avoids
 * collisions across multiple turns in the same task.
 */
function generateMessageId(
  taskId: string,
  streamInstanceId: string,
  msg: Pick<AgentStreamMessage, 'type' | 'id' | 'toolUseId'>,
): string {
  // Use tool_use_id if available (unique per tool execution)
  const toolId = msg.toolUseId || msg.id;
  if (toolId) {
    return `${taskId}_${streamInstanceId}_${toolId}`;
  }

  // Monotonic counter per task
  const seq = (taskSeqCounters.get(taskId) ?? 0) + 1;
  taskSeqCounters.set(taskId, seq);

  return `${taskId}_${streamInstanceId}_${msg.type}_${seq}`;
}

/**
 * Save agent message to database with duplicate protection.
 * Checks for existing message_id before insertion to guard against
 * retries or replayed streams.
 *
 * Note: All DB operations (better-sqlite3) are synchronous, so this
 * function is intentionally not async.
 */
function saveMessageToDatabase(
  taskId: string,
  streamInstanceId: string,
  message: unknown,
  model?: string,
) {
  try {
    if (!isAgentStreamMessage(message)) {
      return;
    }
    const msg = message;

    // Skip messages that don't need database persistence
    if (msg.type === 'session' || msg.type === 'done') {
      return;
    }

    // Skip content-less direct_answer — it's a skip-plan signal, nothing to persist
    if (msg.type === 'direct_answer' && !msg.content) {
      return;
    }

    // Generate deterministic message ID for idempotency
    const messageId = generateMessageId(taskId, streamInstanceId, msg);

    // Idempotency check: skip if message already exists
    if (messageExists(messageId)) {
      logger.debug(
        `Message ${messageId} already persisted, skipping duplicate`,
      );
      return;
    }

    // Zero out cost for subscription/free billing — the SDK reports API pricing
    // but subscription users pay a flat fee, not per-token.
    const billing = resolveBillingType(undefined, model);
    const isZeroCostBilling =
      billing.billingType === 'subscription' || billing.billingType === 'free';
    const effectiveCost = isZeroCostBilling ? 0 : (msg.cost ?? null);

    // Handle plan messages specially
    if (msg.type === 'plan' && msg.plan) {
      createMessage({
        task_id: taskId,
        type: 'plan',
        content: JSON.stringify(msg.plan),
        message_id: messageId,
        cost: effectiveCost,
        usage_input: msg.usage?.input_tokens ?? null,
        usage_output: msg.usage?.output_tokens ?? null,
        usage_cache_read: msg.usage?.cache_read_input_tokens ?? null,
        usage_cache_creation: msg.usage?.cache_creation_input_tokens ?? null,
        model: model || null,
      });
      // Update task cost/duration from planning phase (don't change status)
      if (msg.cost !== undefined || msg.duration !== undefined) {
        updateTask(taskId, {
          cost: effectiveCost ?? undefined,
          duration: msg.duration,
        });
      }
      return;
    }

    // Handle direct_answer messages - extract the actual answer from JSON wrapper
    if (msg.type === 'direct_answer' && msg.content) {
      const actualContent =
        extractStructuredDirectAnswer(msg.content) ?? msg.content;
      createMessage({
        task_id: taskId,
        type: 'text',
        content: actualContent,
        message_id: messageId,
        cost: effectiveCost,
        usage_input: msg.usage?.input_tokens ?? null,
        usage_output: msg.usage?.output_tokens ?? null,
        usage_cache_read: msg.usage?.cache_read_input_tokens ?? null,
        usage_cache_creation: msg.usage?.cache_creation_input_tokens ?? null,
        model: model || null,
      });
      return;
    }

    if (msg.type === 'text' && msg.content) {
      const envelope = parseStructuredEnvelope(msg.content);
      if (envelope?.type === 'direct_answer') {
        createMessage({
          task_id: taskId,
          type: 'text',
          content: envelope.answer,
          message_id: messageId,
          cost: effectiveCost,
          usage_input: msg.usage?.input_tokens ?? null,
          usage_output: msg.usage?.output_tokens ?? null,
          usage_cache_read: msg.usage?.cache_read_input_tokens ?? null,
          usage_cache_creation: msg.usage?.cache_creation_input_tokens ?? null,
          model: model || null,
        });
        return;
      }
      if (envelope?.type === 'plan') {
        createMessage({
          task_id: taskId,
          type: 'plan',
          content: JSON.stringify(envelope.value),
          message_id: messageId,
          cost: effectiveCost,
          usage_input: msg.usage?.input_tokens ?? null,
          usage_output: msg.usage?.output_tokens ?? null,
          usage_cache_read: msg.usage?.cache_read_input_tokens ?? null,
          usage_cache_creation: msg.usage?.cache_creation_input_tokens ?? null,
          model: model || null,
        });
        return;
      }
    }

    // Save all other message types
    createMessage({
      task_id: taskId,
      type: msg.type as
        | 'text'
        | 'tool_use'
        | 'tool_result'
        | 'result'
        | 'error'
        | 'user',
      content: msg.content,
      tool_name: msg.name,
      tool_input: msg.input ? JSON.stringify(msg.input) : undefined,
      tool_output:
        msg.output !== undefined && msg.output !== null
          ? String(msg.output)
          : undefined,
      tool_use_id: msg.toolUseId || msg.id,
      subtype: msg.subtype,
      error_message: msg.message,
      is_error: msg.isError ?? false,
      message_id: messageId,
      cost: effectiveCost,
      usage_input: msg.usage?.input_tokens ?? null,
      usage_output: msg.usage?.output_tokens ?? null,
      usage_cache_read: msg.usage?.cache_read_input_tokens ?? null,
      usage_cache_creation: msg.usage?.cache_creation_input_tokens ?? null,
      model: model || null,
    });

    // Update task status based on message
    updateTaskFromMessage(
      taskId,
      msg.type,
      msg.subtype,
      effectiveCost ?? undefined,
      msg.duration,
    );

    logger.debug(`Saved message ${messageId} for task ${taskId}`);
  } catch (error) {
    // Log but don't throw - message persistence shouldn't break the stream
    logger.error(
      `Failed to save message to database for task ${taskId}:`,
      error,
    );
  }
}

// SSE Response headers
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

function formatSSEMessage(message: unknown, id?: string): string {
  const idLine = id ? `id: ${id}\n` : '';
  return `${idLine}data: ${JSON.stringify(message)}\n\n`;
}

function parseSSECursor(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

// Phase 1: Create a plan (no execution)
agentRoutes.post('/plan', zValidator('json', PlanRequestSchema), async (c) => {
  const body = c.req.valid('json');

  logger.debug('POST /plan received:', {
    hasPrompt: !!body.prompt,
    hasModelConfig: !!body.modelConfig,
    taskId: body.taskId,
    language: body.language || 'not specified',
    hasWorkDir: !!body.workDir,
    modelConfig: body.modelConfig
      ? {
          hasApiKey: !!body.modelConfig.apiKey,
          baseUrl: body.modelConfig.baseUrl,
          model: body.modelConfig.model,
        }
      : null,
  });

  // Validate + authorize workDir (read-only for planning)
  const workDirResult = validateAndAuthorizeWorkDir(
    body.workDir,
    body.allowedFolders as AllowedFolder[] | undefined,
    'read',
  );
  if (!workDirResult.ok) {
    return c.json({ error: workDirResult.error }, workDirResult.status);
  }
  const resolvedWorkDir = workDirResult.resolved;

  // Validate modelConfig.baseUrl against SSRF
  if (body.modelConfig?.baseUrl) {
    const urlCheck = await validateBaseUrlForFetch(
      body.modelConfig.baseUrl,
      'POST',
    );
    if (!urlCheck.valid) {
      logger.warn('Blocked SSRF attempt via modelConfig.baseUrl', {
        baseUrl: safeUrlHostname(body.modelConfig.baseUrl),
        reason: urlCheck.reason,
      });
      return c.json({ error: 'Invalid base URL' }, 400 as ContentfulStatusCode);
    }
  }

  if (body.taskId) {
    ensureTaskExists(body.taskId, body.sessionId, body.prompt, resolvedWorkDir);
  }

  // Short-circuit: simple prompts skip the planning LLM call entirely
  const complexity = classifyTask(body.prompt ?? '');
  logger.debug(
    `Task complexity: ${complexity} (len=${(body.prompt ?? '').length})`,
  );
  if (complexity === 'simple') {
    const readable = createSSEStream(
      (async function* () {
        yield { type: 'direct_answer', skipPlan: true };
        yield { type: 'done' };
      })(),
      { taskId: body.taskId, model: body.modelConfig?.model },
    );
    return new Response(readable, { headers: SSE_HEADERS });
  }

  const session = createSession('plan');
  const readable = createSSEStream(
    runPlanningPhase(
      body.prompt,
      session,
      resolvedWorkDir,
      body.modelConfig,
      body.language,
      body.runtimeContext,
      body.agentProfileId,
      body.taskId,
      undefined, // additionalUserDirs
      body.thinkingConfig,
      body.pluginId,
      body.pluginInputs,
    ),
    {
      taskId: body.taskId,
      model: body.modelConfig?.model,
      profileId: body.agentProfileId,
      // Keep the resume identity record co-located with every
      // agent_session_id update this stream can make.
      resumeIdentity: {
        providerId: body.modelConfig?.agentType ?? DEFAULT_AGENT_PROVIDER,
        modelId: body.modelConfig?.model,
        workspaceRoot: resolvedWorkDir,
      },
    },
  );

  return new Response(readable, { headers: SSE_HEADERS });
});

// Phase 2: Execute an approved plan
agentRoutes.post(
  '/execute',
  zValidator('json', ExecuteRequestSchema),
  async (c) => {
    const body = c.req.valid('json');

    logger.debug('POST /execute received:', {
      planId: body.planId,
      hasPrompt: !!body.prompt,
      taskId: body.taskId,
      language: body.language || 'not specified',
      sandboxConfig: body.sandboxConfig
        ? {
            enabled: body.sandboxConfig.enabled,
            provider: body.sandboxConfig.provider,
          }
        : null,
      skillsConfig: body.skillsConfig,
      mcpConfig: body.mcpConfig,
    });

    // Validate + authorize workDir
    const workDirResult = validateAndAuthorizeWorkDir(
      body.workDir,
      body.allowedFolders as AllowedFolder[] | undefined,
    );
    if (!workDirResult.ok) {
      return c.json({ error: workDirResult.error }, workDirResult.status);
    }
    const resolvedWorkDir = workDirResult.resolved;

    // Validate userWorkspaceDir — it feeds into OS sandbox boundaries
    const userWsDirResult = validateAndAuthorizeWorkDir(
      body.userWorkspaceDir,
      body.allowedFolders as AllowedFolder[] | undefined,
      'read',
    );
    if (!userWsDirResult.ok) {
      return c.json({ error: userWsDirResult.error }, userWsDirResult.status);
    }

    // Validate modelConfig.baseUrl against SSRF
    if (body.modelConfig?.baseUrl) {
      const urlCheck = await validateBaseUrlForFetch(
        body.modelConfig.baseUrl,
        'POST',
      );
      if (!urlCheck.valid) {
        logger.warn('Blocked SSRF attempt via modelConfig.baseUrl', {
          baseUrl: safeUrlHostname(body.modelConfig.baseUrl),
          reason: urlCheck.reason,
        });
        return c.json(
          { error: 'Invalid base URL' },
          400 as ContentfulStatusCode,
        );
      }
    }

    const plan = getPlan(body.planId);
    if (!plan) {
      return c.json(
        { error: 'Plan not found or expired' },
        404 as ContentfulStatusCode,
      );
    }

    if (
      body.taskId &&
      (body.runContext || body.supplementalSkillIds?.length) &&
      !getDbTask(body.taskId)
    ) {
      return c.json({ error: 'Task conversation not found' }, 404);
    }
    if (body.taskId) {
      ensureTaskExists(
        body.taskId,
        body.sessionId,
        body.prompt || plan.goal || '',
        resolvedWorkDir,
      );
    }

    let preparedRun;
    try {
      preparedRun = await prepareTaskRun({
        taskId: body.taskId,
        prompt: body.prompt || plan.goal || '',
        provider: body.modelConfig?.agentType ?? DEFAULT_AGENT_PROVIDER,
        model: body.modelConfig?.model,
        pinnedSkills: body.pinnedSkills,
        supplementalSkillIds: body.supplementalSkillIds,
        runContext: body.runContext,
      });
    } catch (error) {
      if (
        error instanceof RunContextError ||
        error instanceof AgentRunConflictError
      ) {
        return c.json(
          { error: error.message },
          error instanceof RunContextError ? error.status : 409,
        );
      }
      throw error;
    }
    if (preparedRun.reservation?.disposition === 'existing') {
      return c.json({
        runId: preparedRun.reservation.run.id,
        disposition: 'existing',
        status: preparedRun.reservation.run.status,
      });
    }

    const session = createSession('execute');
    const readable = createSSEStream(
      runExecutionPhase(
        body.planId,
        session,
        body.prompt || '',
        resolvedWorkDir,
        body.taskId,
        body.modelConfig,
        body.sandboxConfig,
        body.skillsConfig,
        body.mcpConfig,
        body.language,
        body.runtimeContext,
        body.ptcEnabled,
        body.mentionedMcpServers,
        userWsDirResult.resolved,
        body.allowWorkspaceWrite,
        preparedRun.pinnedSkills,
        body.conversation,
        body.agentProfileId,
        undefined, // additionalUserDirs
        undefined, // autoApprove
        body.thinkingConfig,
        body.pluginId,
        body.pluginInputs,
      ),
      {
        taskId: body.taskId,
        model: body.modelConfig?.model,
        profileId: body.agentProfileId,
        agentRunId: preparedRun.agentRunId,
        // Keep the resume identity record co-located with every
        // agent_session_id update this stream can make.
        resumeIdentity: {
          providerId: body.modelConfig?.agentType ?? DEFAULT_AGENT_PROVIDER,
          modelId: body.modelConfig?.model,
          workspaceRoot: resolvedWorkDir,
        },
      },
    );

    return new Response(readable, { headers: SSE_HEADERS });
  },
);

// Legacy: Direct execution (plan + execute in one call)
agentRoutes.post('/', zValidator('json', RunRequestSchema), async (c) => {
  const body = c.req.valid('json');

  logger.debug('POST / received:', {
    hasPrompt: !!body.prompt,
    language: body.language || 'not specified',
    hasModelConfig: !!body.modelConfig,
    taskId: body.taskId,
    modelConfig: body.modelConfig
      ? {
          hasApiKey: !!body.modelConfig.apiKey,
          baseUrl: body.modelConfig.baseUrl,
          model: body.modelConfig.model,
        }
      : null,
    sandboxConfig: body.sandboxConfig
      ? {
          enabled: body.sandboxConfig.enabled,
          provider: body.sandboxConfig.provider,
        }
      : null,
    hasImages: !!body.images,
    imagesCount: body.images?.length || 0,
  });

  // Debug logging for images
  if (body.images && body.images.length > 0) {
    body.images.forEach(
      (img: { data: string; mimeType: string }, i: number) => {
        logger.debug(
          `Image ${i}: mimeType=${img.mimeType}, dataLength=${img.data?.length || 0}`,
        );
      },
    );
  } else {
    logger.debug('No images in request');
  }

  // Validate + authorize workDir
  const workDirResult = validateAndAuthorizeWorkDir(
    body.workDir,
    body.allowedFolders as AllowedFolder[] | undefined,
  );
  if (!workDirResult.ok) {
    return c.json({ error: workDirResult.error }, workDirResult.status);
  }
  const resolvedWorkDir = workDirResult.resolved;

  // Validate userWorkspaceDir — it feeds into OS sandbox boundaries
  const userWsDirResult = validateAndAuthorizeWorkDir(
    body.userWorkspaceDir,
    body.allowedFolders as AllowedFolder[] | undefined,
    'read',
  );
  if (!userWsDirResult.ok) {
    return c.json({ error: userWsDirResult.error }, userWsDirResult.status);
  }

  // Validate modelConfig.baseUrl against SSRF
  if (body.modelConfig?.baseUrl) {
    const urlCheck = await validateBaseUrlForFetch(
      body.modelConfig.baseUrl,
      'POST',
    );
    if (!urlCheck.valid) {
      logger.warn('Blocked SSRF attempt via modelConfig.baseUrl', {
        baseUrl: safeUrlHostname(body.modelConfig.baseUrl),
        reason: urlCheck.reason,
      });
      return c.json({ error: 'Invalid base URL' }, 400 as ContentfulStatusCode);
    }
  }

  // ── Queue check: enforce per-profile max_concurrent_tasks ──
  if (!body.taskId && (body.runContext || body.supplementalSkillIds?.length)) {
    return c.json(
      { error: 'taskId is required when a run context is supplied' },
      400,
    );
  }
  if (
    body.taskId &&
    (body.runContext || body.supplementalSkillIds?.length) &&
    !getDbTask(body.taskId)
  ) {
    return c.json({ error: 'Task conversation not found' }, 404);
  }
  let preparedRun: Awaited<ReturnType<typeof prepareTaskRun>> = {
    agentRunId: undefined,
    pinnedSkills: body.pinnedSkills,
    reservation: undefined,
  };
  if (body.taskId) {
    ensureTaskExists(body.taskId, body.sessionId, body.prompt, resolvedWorkDir);

    try {
      preparedRun = await prepareTaskRun({
        taskId: body.taskId,
        prompt: body.prompt,
        provider: body.modelConfig?.agentType ?? DEFAULT_AGENT_PROVIDER,
        model: body.modelConfig?.model,
        pinnedSkills: body.pinnedSkills,
        supplementalSkillIds: body.supplementalSkillIds,
        runContext: body.runContext,
      });
    } catch (error) {
      if (
        error instanceof RunContextError ||
        error instanceof AgentRunConflictError
      ) {
        return c.json(
          { error: error.message },
          error instanceof RunContextError ? error.status : 409,
        );
      }
      throw error;
    }
    if (preparedRun.reservation?.disposition === 'existing') {
      return c.json({
        runId: preparedRun.reservation.run.id,
        disposition: 'existing',
        status: preparedRun.reservation.run.status,
      });
    }

    const result = tryExecuteOrQueue(body.taskId, body.agentProfileId, 0);
    if (result.status === 'queued') {
      const queuedTaskId = body.taskId;
      const queuedProfileId = body.agentProfileId;

      // Store a closure capturing all typed request params so the dequeue
      // handler can replay this exact execution when a slot opens
      pendingExecutors.set(queuedTaskId, async () => {
        const dqSession = createSession();
        const readable = createSSEStream(
          runAgent(body.prompt, {
            session: dqSession,
            conversation: body.conversation,
            workDir: resolvedWorkDir,
            taskId: queuedTaskId,
            modelConfig: body.modelConfig,
            sandboxConfig: body.sandboxConfig,
            images: body.images,
            skillsConfig: body.skillsConfig,
            mcpConfig: body.mcpConfig,
            language: body.language,
            runtimeContext: body.runtimeContext,
            mentionedMcpServers: body.mentionedMcpServers,
            userWorkspaceDir: userWsDirResult.resolved,
            allowWorkspaceWrite: body.allowWorkspaceWrite,
            pinnedSkills: preparedRun.pinnedSkills,
            agentProfileId: queuedProfileId,
            outputFormat: body.outputFormat,
            isolation: body.isolation,
            thinkingConfig: body.thinkingConfig,
            pluginId: body.pluginId,
            pluginInputs: body.pluginInputs,
          }),
          {
            taskId: queuedTaskId,
            model: body.modelConfig?.model,
            profileId: queuedProfileId,
            agentRunId: preparedRun.agentRunId,
            resumeIdentity: {
              providerId: body.modelConfig?.agentType ?? DEFAULT_AGENT_PROVIDER,
              modelId: body.modelConfig?.model,
              workspaceRoot: resolvedWorkDir,
            },
          },
        );
        await drainStream(readable);
      });

      return c.json(
        {
          status: 'queued',
          taskId: body.taskId,
          queuePosition: result.queuePosition,
          message: `Task queued at position ${result.queuePosition}. Will start when a slot is available.`,
        },
        202 as ContentfulStatusCode,
      );
    }
  }

  const session = createSession();
  const readable = createSSEStream(
    runAgent(body.prompt, {
      session,
      conversation: body.conversation,
      workDir: resolvedWorkDir,
      taskId: body.taskId,
      modelConfig: body.modelConfig,
      sandboxConfig: body.sandboxConfig,
      images: body.images,
      skillsConfig: body.skillsConfig,
      mcpConfig: body.mcpConfig,
      language: body.language,
      runtimeContext: body.runtimeContext,
      mentionedMcpServers: body.mentionedMcpServers,
      userWorkspaceDir: userWsDirResult.resolved,
      allowWorkspaceWrite: body.allowWorkspaceWrite,
      pinnedSkills: preparedRun.pinnedSkills,
      agentProfileId: body.agentProfileId,
      outputFormat: body.outputFormat,
      isolation: body.isolation,
      thinkingConfig: body.thinkingConfig,
      pluginId: body.pluginId,
      pluginInputs: body.pluginInputs,
    }),
    {
      taskId: body.taskId,
      model: body.modelConfig?.model,
      profileId: body.agentProfileId,
      agentRunId: preparedRun.agentRunId,
      resumeIdentity: {
        providerId: body.modelConfig?.agentType ?? DEFAULT_AGENT_PROVIDER,
        modelId: body.modelConfig?.model,
        workspaceRoot: resolvedWorkDir,
      },
    },
  );

  return new Response(readable, { headers: SSE_HEADERS });
});

// Resume a previous SDK session
const ResumeRequestSchema = z.object({
  resumeSessionId: z.string().min(1),
  prompt: z.string().min(1),
  conversation: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .optional(),
  contextTokensUsed: z.number().int().nonnegative().optional(),
  taskId: z.string().optional(),
  sessionId: z.string().optional(),
  workDir: z.string().optional(),
  language: z.string().optional(),
  runtimeContext: RuntimeContextSchema,
  modelConfig: ModelConfigSchema,
  allowedFolders: AllowedFoldersSchema,
  agentProfileId: z.string().optional(),
  thinkingConfig: ThinkingConfigSchema,
});

agentRoutes.post(
  '/resume',
  zValidator('json', ResumeRequestSchema),
  async (c) => {
    const body = c.req.valid('json');

    logger.debug('POST /resume received:', {
      resumeSessionId: body.resumeSessionId,
      hasPrompt: !!body.prompt,
      taskId: body.taskId,
    });

    const workDirResult = validateAndAuthorizeWorkDir(
      body.workDir,
      body.allowedFolders as AllowedFolder[] | undefined,
    );
    if (!workDirResult.ok) {
      return c.json({ error: workDirResult.error }, workDirResult.status);
    }
    const resolvedWorkDir = workDirResult.resolved;

    if (body.taskId) {
      ensureTaskExists(
        body.taskId,
        body.sessionId,
        body.prompt,
        resolvedWorkDir,
      );
    }

    const requestedIdentity = {
      providerId: body.modelConfig?.agentType ?? DEFAULT_AGENT_PROVIDER,
      modelId: body.modelConfig?.model,
      workspaceRoot: resolvedWorkDir,
    };

    // Native session ids are only meaningful to the provider/runtime that
    // minted them. When the stored identity for this task no longer matches
    // the request, reseed with a fresh run instead of replaying the session
    // id into the wrong SDK. Tasks without a stored identity keep the
    // pre-guard behavior.
    let identityMismatch: string | null = null;
    if (body.taskId) {
      const stored = getAgentResumeIdentity(body.taskId);
      if (stored) {
        identityMismatch = resumeIdentityMismatch(stored, {
          ...requestedIdentity,
          nativeSessionId: body.resumeSessionId,
        });
        if (identityMismatch) {
          logger.warn(
            'Resume identity mismatch; starting fresh run instead of native resume',
            {
              taskId: body.taskId,
              mismatch: identityMismatch,
              storedProvider: stored.providerId,
              requestedProvider: requestedIdentity.providerId,
            },
          );
        }
      }
    }
    if (
      !identityMismatch &&
      shouldRolloverNativeSession(
        body.modelConfig?.model,
        body.contextTokensUsed,
      )
    ) {
      identityMismatch = 'context_rollover';
      logger.info(
        'Native session nearing context limit; reseeding a fresh run',
        {
          taskId: body.taskId,
          model: body.modelConfig?.model,
          contextTokensUsed: body.contextTokensUsed,
        },
      );
    }

    const session = createSession('execute');
    const readable = createSSEStream(
      identityMismatch
        ? runAgent(body.prompt, {
            session,
            conversation: body.conversation,
            workDir: resolvedWorkDir,
            taskId: body.taskId,
            modelConfig: body.modelConfig,
            language: body.language,
            runtimeContext: body.runtimeContext,
            agentProfileId: body.agentProfileId,
            thinkingConfig: body.thinkingConfig,
          })
        : runAgentResume(
            body.resumeSessionId,
            body.prompt,
            session,
            resolvedWorkDir,
            body.taskId,
            body.modelConfig,
            body.language,
            body.runtimeContext,
            body.agentProfileId,
            body.thinkingConfig,
          ),
      {
        taskId: body.taskId,
        model: body.modelConfig?.model,
        profileId: body.agentProfileId,
        resumeIdentity: requestedIdentity,
      },
    );

    return new Response(readable, { headers: SSE_HEADERS });
  },
);

// Rewind files to a specific checkpoint
const RewindRequestSchema = z.object({
  taskId: z.string().min(1),
  userMessageId: z.string().min(1),
  dryRun: z.boolean().optional().default(true),
});

agentRoutes.post(
  '/rewind',
  zValidator('json', RewindRequestSchema),
  async (c) => {
    const body = c.req.valid('json');

    logger.debug('POST /rewind received:', {
      taskId: body.taskId,
      userMessageId: body.userMessageId,
      dryRun: body.dryRun,
    });

    // Try active query first (during execution)
    const activeEntry = activeQueryStore.has(body.taskId);
    if (activeEntry) {
      const sessionId = activeQueryStore.getSessionId(body.taskId);
      if (!sessionId) {
        return c.json(
          { error: 'Session not found for active task' },
          404 as ContentfulStatusCode,
        );
      }
      // Access the query object via the store's internal entries
      // We need to expose the query through a getter
      try {
        const queryObj = activeQueryStore.getQuery(body.taskId);
        if (!queryObj) {
          return c.json(
            { error: 'Active query not found' },
            404 as ContentfulStatusCode,
          );
        }
        const result = await queryObj.rewindFiles(body.userMessageId, {
          dryRun: body.dryRun,
        });
        return c.json(result);
      } catch (err) {
        const msg = errorMessage(err);
        logger.error('Rewind failed:', msg);
        return c.json(
          { canRewind: false, error: msg },
          500 as ContentfulStatusCode,
        );
      }
    }

    // Post-execution: resume session with empty prompt, then rewind
    try {
      const { query: sdkQuery } =
        await import('@anthropic-ai/claude-agent-sdk');
      const { getSetting } = await import('@/shared/db/operations');
      const workDir = getSetting('workDir');
      if (!workDir) {
        return c.json(
          { canRewind: false, error: 'No workspace directory configured' },
          400 as ContentfulStatusCode,
        );
      }

      const resumeQuery = sdkQuery({
        prompt: '',
        options: {
          resume: body.taskId,
          enableFileCheckpointing: true,
          extraArgs: { 'replay-user-messages': null },
          cwd: workDir,
          abortController: new AbortController(),
        },
      });

      const result = await resumeQuery.rewindFiles(body.userMessageId, {
        dryRun: body.dryRun,
      });
      resumeQuery.close();
      return c.json(result);
    } catch (err) {
      const msg = errorMessage(err);
      logger.error('Post-execution rewind failed:', msg);
      return c.json(
        { canRewind: false, error: msg },
        500 as ContentfulStatusCode,
      );
    }
  },
);

// Cancel a specific tool call without aborting the entire session
const CancelToolSchema = z.object({
  sessionId: z.string().min(1),
  toolUseId: z.string().min(1),
});

agentRoutes.post(
  '/cancel-tool',
  zValidator('json', CancelToolSchema),
  async (c) => {
    const body = c.req.valid('json');

    logger.debug('POST /cancel-tool received:', {
      sessionId: body.sessionId,
      toolUseId: body.toolUseId,
    });

    const { getSessionManager } = await import('@/core/session-manager');
    const sm = getSessionManager();
    const cancelled = sm.abortTool(body.sessionId, body.toolUseId);

    if (!cancelled) {
      return c.json(
        { error: 'Tool not found or already completed' },
        404 as ContentfulStatusCode,
      );
    }

    return c.json({ cancelled: true });
  },
);

/**
 * Subscribe to live task updates via SSE.
 * Observer clients use this to watch a task running in another client.
 * Replays all buffered messages first, then streams live updates.
 */
agentRoutes.get('/subscribe/:taskId', (c) => {
  const taskId = c.req.param('taskId');
  const encoder = new TextEncoder();
  const lastEventId = parseSSECursor(
    c.req.query('from') ?? c.req.header('Last-Event-ID'),
  );
  const seqBounds = taskEventBus.getSeqBounds(taskId);
  const canReplayFromCursor =
    lastEventId !== null &&
    seqBounds.minSeq !== null &&
    lastEventId >= seqBounds.minSeq - 1;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const closeStream = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      // Track if we received a terminal event during replay
      let receivedTerminal = false;
      let replayingBuffer = true;

      // Subscribe to event bus — replays buffer + delivers live events
      const unsubscribe = taskEventBus.subscribe(
        taskId,
        (message, event) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(formatSSEMessage(message, event.id)),
            );

            // Track terminal events so we know to close after replay
            const msg = message as { type?: string };
            if (msg.type === 'done' || msg.type === 'error') {
              receivedTerminal = true;
              if (!replayingBuffer) closeStream();
            }
          } catch {
            // Client disconnected, clean up
            closeStream();
          }
        },
        canReplayFromCursor ? { afterSeq: lastEventId } : undefined,
      );
      replayingBuffer = false;

      // After replay: if the task already finished, close the stream.
      // We check both the event bus state AND whether we received a
      // terminal event during replay, to avoid the race where the task
      // completes between subscribe() and this check.
      if (!taskEventBus.isTaskActive(taskId) || receivedTerminal) {
        if (!receivedTerminal && taskEventBus.getBufferSize(taskId) === 0) {
          // No buffer at all — send a synthetic done event
          controller.enqueue(
            encoder.encode(formatSSEMessage({ type: 'done' })),
          );
        }
        closeStream();
        return;
      }

      // Clean up when client disconnects
      c.req.raw.signal.addEventListener('abort', () => {
        closeStream();
      });
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
});

// Generate a concise title for a task based on the user prompt and AI context
const GenerateTitleSchema = z.object({
  userPrompt: z.string().min(1),
  aiContext: z.string().optional(),
  taskId: z.string().optional(),
  language: z.string().optional(), // App locale (e.g. 'en-US', 'zh-CN') for title language
  modelConfig: ModelConfigSchema,
});

agentRoutes.post(
  '/generate-title',
  zValidator('json', GenerateTitleSchema),
  async (c) => {
    const body = c.req.valid('json');

    logger.info('POST /generate-title received:', {
      promptLength: body.userPrompt.length,
      hasAiContext: !!body.aiContext,
      aiContextPreview: body.aiContext?.slice(0, 80),
      taskId: body.taskId,
      language: body.language,
    });

    try {
      const title = await generateTitle(
        body.userPrompt,
        body.aiContext,
        body.modelConfig as
          | { apiKey?: string; baseUrl?: string; model?: string }
          | undefined,
        body.language,
      );

      // If a taskId is provided, update the task title in the database
      if (body.taskId) {
        const updated = updateTask(body.taskId, { title });
        if (updated) {
          logger.info(`Updated task ${body.taskId} title to: "${title}"`);
        }
      }

      return c.json({ title });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error('Failed to generate title:', detail);
      return c.json(
        { error: 'Failed to generate title', detail },
        500 as ContentfulStatusCode,
      );
    }
  },
);

// Send a follow-up reply to a running agent
const ReplyRequestSchema = z.object({
  content: z.string().min(1),
  attachments: z.string().optional(),
  subtype: z.enum(['question_answer']).optional(),
});

const AgentQuestionPayloadSchema = z.object({
  sessionId: z.string().min(1),
  taskId: z.string().uuid().optional(),
  toolUseId: z.string().min(1).optional(),
  questions: z.array(z.record(z.string(), z.unknown())).min(1),
  timeoutMs: z.number().int().positive().optional(),
});

const AgentQuestionAnswerSchema = z.object({
  answer: z.unknown(),
});

agentRoutes.post(
  '/questions',
  zValidator('json', AgentQuestionPayloadSchema),
  async (c) => {
    const body = c.req.valid('json');
    const row = agentQuestionService.createPendingQuestion({
      sessionId: body.sessionId,
      taskId: body.taskId ?? null,
      toolUseId: body.toolUseId ?? null,
      questions: body.questions,
      timeoutMs: body.timeoutMs,
    });
    return c.json({ question: serializeAgentQuestion(row) });
  },
);

agentRoutes.get(
  '/questions/pending',
  zValidator(
    'query',
    z.object({
      sessionId: z.string().min(1).optional(),
      taskId: z.string().min(1).optional(),
    }),
  ),
  (c) => {
    const { sessionId, taskId } = c.req.valid('query');
    if (!sessionId && !taskId) {
      return c.json(
        { error: 'sessionId or taskId is required' },
        400 as ContentfulStatusCode,
      );
    }

    const rows = agentQuestionService.getPendingQuestions({
      sessionId,
      taskId,
    });
    return c.json({ questions: rows.map(serializeAgentQuestion) });
  },
);

agentRoutes.get(
  '/sessions/:sessionId/questions/pending',
  zValidator('param', z.object({ sessionId: z.string().min(1) })),
  (c) => {
    const { sessionId } = c.req.valid('param');
    const rows = agentQuestionService.getPendingQuestions({ sessionId });
    return c.json({ questions: rows.map(serializeAgentQuestion) });
  },
);

agentRoutes.post(
  '/questions/:questionId/answer',
  zValidator('param', z.object({ questionId: z.string().min(1) })),
  zValidator('json', AgentQuestionAnswerSchema),
  async (c) => {
    const { questionId } = c.req.valid('param');
    const body = c.req.valid('json');
    const row = agentQuestionService.answerQuestion(questionId, body.answer);
    if (!row) {
      return c.json(
        { error: 'Question not found' },
        404 as ContentfulStatusCode,
      );
    }
    if (row.status !== 'answered') {
      return c.json(
        { error: `Question is ${row.status}` },
        409 as ContentfulStatusCode,
      );
    }
    return c.json({ question: serializeAgentQuestion(row) });
  },
);

agentRoutes.post(
  '/sessions/:sessionId/questions/:questionId/answer',
  zValidator(
    'param',
    z.object({
      sessionId: z.string().min(1),
      questionId: z.string().min(1),
    }),
  ),
  zValidator('json', AgentQuestionAnswerSchema),
  async (c) => {
    const { sessionId, questionId } = c.req.valid('param');
    const body = c.req.valid('json');
    // Look up by ID without status filter so we can distinguish
    // "not found" (404) from "already resolved" (409) under races.
    const existing = agentQuestionService.getQuestion(questionId);
    if (!existing || existing.session_id !== sessionId) {
      return c.json(
        { error: 'Question not found' },
        404 as ContentfulStatusCode,
      );
    }
    if (existing.status !== 'pending') {
      return c.json(
        { error: `Question is ${existing.status}` },
        409 as ContentfulStatusCode,
      );
    }
    const row = agentQuestionService.answerQuestion(questionId, body.answer);
    if (!row) {
      return c.json(
        { error: 'Question not found' },
        404 as ContentfulStatusCode,
      );
    }
    if (row.status !== 'answered') {
      return c.json(
        { error: `Question is ${row.status}` },
        409 as ContentfulStatusCode,
      );
    }
    return c.json({ question: serializeAgentQuestion(row) });
  },
);

agentRoutes.post(
  '/reply/:taskId',
  zValidator('param', z.object({ taskId: z.string().uuid() })),
  zValidator('json', ReplyRequestSchema),
  async (c) => {
    const { taskId } = c.req.valid('param');
    const body = c.req.valid('json');

    if (!activeQueryStore.has(taskId)) {
      return c.json(
        { error: 'No active agent query for this task' },
        404 as ContentfulStatusCode,
      );
    }

    // Save user message to DB (including attachment refs and subtype for persistence)
    try {
      createMessage({
        task_id: taskId,
        type: 'user',
        content: body.content,
        attachments: body.attachments ?? null,
        subtype: body.subtype ?? null,
      });
    } catch (err) {
      logger.error(`Failed to save reply message for task ${taskId}:`, err);
    }

    // Note: we intentionally do NOT publish user messages to the event bus here.
    // The frontend already adds the message optimistically via replyToRunningAgent.
    // Publishing would cause duplicates on the observer path.

    // Deliver reply to the running agent
    await activeQueryStore.pushReply(taskId, {
      content: body.content,
      timestamp: Date.now(),
    });

    return c.json({ status: 'delivered' });
  },
);

// Stop a running agent
agentRoutes.post('/stop/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const session = getSession(sessionId);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404 as ContentfulStatusCode);
  }

  deleteSession(sessionId);
  return c.json({ status: 'stopped' });
});

// ── Permission response endpoint ─────────────────────────────────────────────
// Frontend calls this when user approves/denies a tool call permission request.
// The Claude adapter's canUseTool callback creates a pending Promise that this
// endpoint resolves.

const PermissionResponseSchema = z.object({
  sessionId: z.string().optional(),
  permissionId: z.string().min(1),
  approved: z.boolean(),
  alwaysAllow: z.boolean().optional(),
});

agentRoutes.post(
  '/permission',
  zValidator('json', PermissionResponseSchema),
  async (c) => {
    const body = c.req.valid('json');
    const { resolvePermission } =
      await import('@/extensions/agent/claude/index');
    const resolved = resolvePermission(
      body.permissionId,
      body.approved,
      body.alwaysAllow,
      body.sessionId,
    );
    const sharedResolved = resolved
      ? false
      : (
          await import('@/core/agent/tool-permission-registry')
        ).resolveHostToolPermission(
          body.permissionId,
          body.approved,
          body.alwaysAllow,
          body.sessionId,
        );
    if (!resolved && !sharedResolved) {
      return c.json(
        { error: 'Permission request not found or already resolved' },
        404 as ContentfulStatusCode,
      );
    }
    return c.json({ status: 'ok' });
  },
);

// Get session status
agentRoutes.get('/session/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const session = getSession(sessionId);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404 as ContentfulStatusCode);
  }

  return c.json({
    id: session.id,
    createdAt: session.createdAt,
    phase: session.phase,
    isAborted: session.abortController.signal.aborted,
  });
});

// Get plan by ID
agentRoutes.get('/plan/:planId', async (c) => {
  const planId = c.req.param('planId');
  const plan = getPlan(planId);

  if (!plan) {
    return c.json({ error: 'Plan not found' }, 404 as ContentfulStatusCode);
  }

  return c.json(plan);
});

// ── Queue management endpoints ──────────────────────────────────────

agentRoutes.get('/queue/status', (c) => {
  const profileId = c.req.query('profileId');
  if (profileId) {
    return c.json({ success: true, data: getQueueState(profileId) });
  }
  return c.json({ success: true, data: getGlobalStats() });
});

agentRoutes.get('/queue/can-accept', (c) => {
  const profileId = c.req.query('profileId');
  return c.json({
    success: true,
    canAccept: canAcceptTask(profileId || null),
  });
});

// ── Dequeue handler: auto-execute tasks when a concurrency slot opens ──
//
// When a task completes and frees a slot, the queue manager emits TASK_DEQUEUED.
// This handler retrieves the stored executor closure (captured during the
// original 202 Accepted response) and runs the agent in the background.
// Messages are published to TaskEventBus so the frontend can observe via
// GET /agent/subscribe/:taskId.

const pendingExecutors = new Map<string, () => Promise<void>>();

// Clean up stale executors when tasks complete or fail through other paths
// (e.g. user cancellation, zombie recovery) to prevent unbounded map growth.
taskEventBus.on(QUEUE_EVENTS.TASK_COMPLETED, (event: { taskId: string }) => {
  pendingExecutors.delete(event.taskId);
});
taskEventBus.on(QUEUE_EVENTS.TASK_FAILED, (event: { taskId: string }) => {
  pendingExecutors.delete(event.taskId);
});

async function drainStream(readable: ReadableStream): Promise<void> {
  const reader = readable.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

taskEventBus.on(
  QUEUE_EVENTS.TASK_DEQUEUED,
  (event: { taskId: string; profileId: string }) => {
    const executor = pendingExecutors.get(event.taskId);
    pendingExecutors.delete(event.taskId);

    if (!executor) {
      logger.warn(
        `No executor for dequeued task ${event.taskId} — context lost (e.g. after restart)`,
      );
      // Mark the task as failed so users see an error state rather than silent disappearance
      updateTask(event.taskId, { status: 'error' });
      onTaskComplete(event.taskId, event.profileId, false);
      return;
    }

    logger.info(
      `Executing dequeued task ${event.taskId} for profile ${event.profileId}`,
    );

    executor().catch((err) => {
      logger.error(`Dequeued task ${event.taskId} failed:`, errorMessage(err));
      onTaskComplete(event.taskId, event.profileId, false);
    });
  },
);

registerExternalMcpRunLauncher((input) => {
  const workDir = getSetting('workDir') ?? undefined;
  const session = createSession();
  const readable = createSSEStream(
    runAgent(input.prompt, {
      session,
      taskId: input.taskId,
      workDir,
      modelConfig: {
        agentType: input.provider,
        model: input.model,
      },
      agentProfileId: input.profileId,
    }),
    {
      taskId: input.taskId,
      model: input.model,
      profileId: input.profileId,
      agentRunId: input.runId,
      resumeIdentity: {
        providerId: input.provider,
        modelId: input.model,
        workspaceRoot: workDir,
      },
    },
  );
  const unregisterRunSession = registerExternalMcpRunSession(
    input.runId,
    session.id,
  );
  void drainStream(readable)
    .catch((err) => {
      logger.error(
        `External MCP agent run ${input.runId} failed:`,
        errorMessage(err),
      );
      finishAgentRun({
        id: input.runId,
        status: 'failed',
        error: 'Agent run failed',
      });
    })
    .finally(() => {
      unregisterRunSession();
    });
});

export { agentRoutes };
