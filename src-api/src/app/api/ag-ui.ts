import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { EventType } from '@ag-ui/core';
import type { BaseEvent, Interrupt } from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import {
  isConversationalPrompt,
  isSingleActionPrompt,
} from '@/core/agent/base';
import { listOpenPermissionWaits } from '@/core/agent/permission-waits';
import {
  resolveRunContext,
  RunContextEnvelopeInputSchema,
  RunContextError,
} from '@/core/agent/run-context';
import type {
  AgentMessage,
  AgentProvider,
  ConversationMessage,
  ImageAttachment,
} from '@/core/agent/types';

import { getCachedAgentRuntimeStatus } from '@/shared/agent-runtimes';
import { getDatabase } from '@/shared/db/index';
import {
  AgentRunConflictError,
  createFileSnapshot,
  finishAgentRun,
  getAgentRun,
  getMessagesByBranch,
  getMessagesByTaskId,
  getOrchestrationRunsByTaskId,
  getSetting,
  getTask,
  reserveAgentRun,
  updateOrchestrationRunStatus,
  updateTask,
} from '@/shared/db/operations';
import type { Message } from '@/shared/db/types';
import type { LibraryFile } from '@/shared/db/types';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';
import { activeQueryStore } from '@/shared/services/active-query-store';
import { AttachmentPromotionService } from '@/shared/services/ag-ui/attachment-promotion';
import { startDetachedAGUIRun } from '@/shared/services/ag-ui/detached-run';
import {
  AGUIEmitter,
  type AGUIRunContext,
} from '@/shared/services/ag-ui/emitter';
import {
  dbMessagesToFullAGUI,
  dbMessagesToSubagents,
} from '@/shared/services/ag-ui/history';
import {
  parseDecisionInterruptId,
  permissionInterrupt,
  ResumeSchema,
} from '@/shared/services/ag-ui/interrupts';
import { replayAGUIEvents } from '@/shared/services/ag-ui/journal';
import { listOpenInterrupts } from '@/shared/services/ag-ui/open-interrupts';
import { PausableSource } from '@/shared/services/ag-ui/pausable-source';
import {
  applyPermissionAnswers,
  validatePermissionEntries,
} from '@/shared/services/ag-ui/permission-decisions';
import {
  expectContinuationRunId,
  hasPermissionHold,
  holdUntilPermissionsSettled,
  releasePermissionHold,
} from '@/shared/services/ag-ui/permission-hold';
import { AGUIEventPersister } from '@/shared/services/ag-ui/persistence';
import {
  parsePlanRun,
  pendingPlanRun,
  planInterruptForRun,
  resolvePlanDecision,
} from '@/shared/services/ag-ui/plan-decisions';
import {
  answerQuestionOnce,
  cancelQuestionOnce,
  resolveQuestionResume,
} from '@/shared/services/ag-ui/question-decisions';
import {
  canReconcilePendingDelivery,
  dbFileToAGUITaskFile,
  restoreReattachFiles,
  type ReattachRunContext,
} from '@/shared/services/ag-ui/reattach';
import {
  cancelActiveAGUIRun,
  findActiveAGUIRun,
  getActiveAGUIRun,
} from '@/shared/services/ag-ui/runtime';
import { subscribeSSEToBus } from '@/shared/services/ag-ui/transport';
import {
  createSession,
  resolveAgentProvider,
  runAgent,
  runExecutionPhase,
  runPlanningPhase,
} from '@/shared/services/agent';
import {
  resolveBranchContextPlan,
  withBranchSdkSessionRecording,
  type BranchContextPlan,
} from '@/shared/services/branch-sdk-session';
import {
  readLiveArtifactQuietMs,
  withDesignLiveArtifactQuietClose,
} from '@/shared/services/design-mode/artifact-quiet-close';
import {
  createTaskDownloadAttachment,
  type DownloadAttachment,
} from '@/shared/services/media-download/attachment';
import { startDownloadBatch } from '@/shared/services/media-download/registry';
import {
  cancelDownloadDestinationRequest,
  claimDownloadDestination,
  DOWNLOAD_DESTINATION_QUESTION,
} from '@/shared/services/media-download/requests';
import { withDownloadBatch } from '@/shared/services/media-download/run-batch';
import { withSessionContext } from '@/shared/services/session-context';
import { taskEventBus } from '@/shared/services/task-event-bus';
import { isTaskRewinding } from '@/shared/services/task-file-access';
import { createLogger } from '@/shared/utils/logger';
import { expandPath } from '@/shared/utils/paths';
import {
  safeFetch,
  validateBaseUrlForFetch,
} from '@/shared/utils/url-validator';

const logger = createLogger('AGUIRoute');
const runModeParamSchema = z.enum(['task', 'design', 'video']);

function runProvenance(config?: { model?: string; agentType?: AgentProvider }) {
  const runtimeId = config?.agentType ?? 'claude';
  const runtime = getCachedAgentRuntimeStatus(runtimeId);
  const continuation = runtime?.capabilities.sessionContinuation;
  const sessionHandleKind =
    continuation === 'acp-load'
      ? 'acp-session-handle'
      : continuation === 'continue-latest'
        ? 'continue-latest'
        : continuation === 'by-id'
          ? 'cli-thread-id'
          : undefined;
  return {
    model: config?.model,
    runtimeVersion: runtime?.version,
    sessionHandleKind,
  };
}

function safeUrlHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '<invalid>';
  }
}

function recordValue(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const next = (value as Record<string, unknown>)[key];
  return next && typeof next === 'object'
    ? (next as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isDesignLiveArtifactRun(
  forwardedProps: Record<string, unknown> | undefined,
): boolean {
  if (!forwardedProps) return false;
  if (forwardedProps.designModeLiveArtifact === true) return true;
  if (forwardedProps.liveArtifact === true) return true;
  if (stringValue(forwardedProps.projectIntent) === 'live-artifact') {
    return true;
  }
  const designMode = recordValue(forwardedProps, 'designMode');
  if (stringValue(designMode?.intent) === 'live-artifact') return true;
  const runtimeContext = recordValue(forwardedProps, 'runtimeContext');
  if (
    stringValue(runtimeContext?.mode) === 'design' &&
    (stringValue(runtimeContext?.intent) === 'live-artifact' ||
      stringValue(runtimeContext?.artifactKind) === 'live-artifact')
  ) {
    return true;
  }
  return false;
}

function forwardedQuietMs(
  forwardedProps: Record<string, unknown> | undefined,
): number {
  return readLiveArtifactQuietMs(forwardedProps?.liveArtifactQuietMs);
}

/**
 * Resolve per-session cwd so in-process MCP tools don't fall back to the
 * root workDir. Check the basename rather than substring-matching — a user
 * workspace like `/home/user/sessions/neuma` otherwise gets wrongly treated
 * as pre-resolved and skips the per-task subdir.
 */
function resolveSessionCwd(
  workspaceRoot: string | undefined,
  taskId: string,
): string | undefined {
  if (!workspaceRoot) return undefined;
  const expanded = expandPath(workspaceRoot);
  if (basename(expanded).startsWith('session-')) return expanded;
  return join(expanded, 'sessions', `session-${taskId}`);
}

function withSeq(event: BaseEvent, seq: number): BaseEvent {
  return { ...event, seq } as BaseEvent;
}

function fileDeltaForRun(
  file: LibraryFile,
  runId: string,
  sourceToolCallId?: string,
) {
  return {
    op: 'add' as const,
    path: '/files/-',
    value: {
      ...dbFileToAGUITaskFile(file),
      runId,
      sourceToolCallId,
      role: 'input',
    },
  };
}

interface ToolStartEvent extends BaseEvent {
  toolCallName: string;
  toolCallId?: string;
  threadId?: string;
  runId?: string;
}

function isToolStartEvent(event: BaseEvent): event is ToolStartEvent {
  if (event.type !== EventType.TOOL_CALL_START) return false;
  const candidate = event as Record<string, unknown>;
  return (
    typeof candidate.toolCallName === 'string' &&
    (candidate.toolCallId === undefined ||
      typeof candidate.toolCallId === 'string') &&
    (candidate.threadId === undefined ||
      typeof candidate.threadId === 'string') &&
    (candidate.runId === undefined || typeof candidate.runId === 'string')
  );
}

async function* withAttachmentPromotionEvents(
  events: AsyncGenerator<BaseEvent>,
  promoter: AttachmentPromotionService,
  runId: string,
): AsyncGenerator<BaseEvent> {
  let seq = 0;
  for await (const rawEvent of events) {
    const event = withSeq(rawEvent, seq++);
    yield event;

    if (!isToolStartEvent(event)) continue;

    const files = await promoter.promoteForTool(
      event.toolCallName,
      event.toolCallId,
    );
    if (files.length === 0) continue;

    yield withSeq(
      {
        type: EventType.STATE_DELTA,
        threadId: event.threadId,
        runId: event.runId ?? runId,
        timestamp: Date.now(),
        delta: files.map((file) =>
          fileDeltaForRun(file, runId, event.toolCallId),
        ),
      } as BaseEvent,
      seq++,
    );
  }
}

/** Regex matching common image/media URLs in tool output (handles query params). */
const MEDIA_URL_RE =
  /https?:\/\/[^\s"'<>]+?\.(?:png|jpe?g|gif|webp|svg|mp4|webm|wav|mp3)(?:\?[^\s"'<>]*)?/gi;

/**
 * Download an external URL to the session workspace folder.
 * If a file with the same name already exists, the existing file is moved to
 * a `.versions/` subfolder with a timestamp suffix so the user can compare
 * versions later (e.g., via the Diff tab).
 * Returns the local file path on success, null on failure.
 */
async function downloadMediaToWorkspace(
  url: string,
  workDir: string,
  taskId?: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const urlPath = new URL(url).pathname;
    let fileName = basename(urlPath).split('?')[0] || 'generated-image.png';
    // Sanitize filename
    fileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

    await mkdir(workDir, { recursive: true });
    const localPath = join(workDir, fileName);

    // Version backup: if file already exists, move it to .versions/ before overwriting
    try {
      await stat(localPath);
      // File exists — create versioned backup
      const versionsDir = join(workDir, '.versions');
      await mkdir(versionsDir, { recursive: true });
      const ext = extname(fileName);
      const base = fileName.slice(0, -ext.length || undefined);
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const versionedName = `${base}.${ts}${ext}`;
      await rename(localPath, join(versionsDir, versionedName));
      logger.info(`Versioned backup: ${versionedName}`);

      // Record in file_snapshots table if taskId is available
      if (taskId) {
        try {
          createFileSnapshot({
            id: crypto.randomUUID(),
            task_id: taskId,
            file_path: localPath,
            content_before: join(versionsDir, versionedName),
            content_after: localPath,
          });
        } catch {
          // Non-fatal — snapshot is best-effort
        }
      }
    } catch {
      // File doesn't exist yet — no versioning needed
    }

    // Defense-in-depth SSRF check — URL comes from MCP tool output, not directly
    // from user, but validate anyway to block private IP / metadata redirects.
    const urlCheck = await validateBaseUrlForFetch(url);
    if (!urlCheck.valid) {
      logger.warn('downloadMediaToWorkspace SSRF blocked:', {
        reason: urlCheck.reason,
      });
      return null;
    }

    const response = await safeFetch(url, trustedLocalPolicy(), { signal });
    if (response.status < 200 || response.status >= 300) return null;

    const buffer = response.body;
    if (!buffer) return null;
    await writeFile(localPath, buffer);
    logger.info(`Downloaded media to workspace: ${localPath}`);
    return localPath;
  } catch (err) {
    logger.warn('Failed to download media to workspace:', err);
    return null;
  }
}

/**
 * Wraps an agent stream generator to:
 * 1. Intercept 'session' messages → update task work_dir in DB
 * 2. Intercept MCP media tool results → download external URLs to workspace
 */
async function* withWorkDirSync(
  stream: AsyncGenerator<AgentMessage>,
  taskId: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentMessage> {
  let sessionCwd: string | null = null;
  // Track tool_use id → name so we can identify MCP media tools on tool_result
  // (tool_result messages carry toolUseId but NOT the tool name).
  const toolNames = new Map<string, string>();

  for await (const msg of stream) {
    // Capture session CWD
    if (msg.type === 'session' && msg.cwd) {
      sessionCwd = msg.cwd;
      try {
        updateTask(taskId, { work_dir: msg.cwd });
      } catch {
        // Non-fatal
      }
    }

    // Track tool names from tool_use messages
    if (msg.type === 'tool_use' && msg.id && msg.name) {
      toolNames.set(msg.id, msg.name);
    }

    // Download MCP media tool outputs to the workspace folder.
    // tool_result messages don't carry the tool name — look it up from the
    // tool_use id we tracked above.
    if (sessionCwd && msg.type === 'tool_result' && msg.output) {
      const toolName = toolNames.get(msg.toolUseId ?? '');
      const isMediaMcp =
        toolName?.startsWith('mcp__') &&
        (toolName.includes('image') ||
          toolName.includes('media') ||
          toolName.includes('generate'));

      if (isMediaMcp) {
        const output = typeof msg.output === 'string' ? msg.output : '';
        const urls = output.match(MEDIA_URL_RE);
        if (urls) {
          let rewritten = output;
          for (const url of urls) {
            const localPath = await downloadMediaToWorkspace(
              url,
              sessionCwd,
              taskId,
              signal,
            );
            if (localPath) {
              rewritten += `\n\nSaved to: ${localPath}`;
            }
          }
          if (rewritten !== output) {
            yield { ...msg, output: rewritten };
            continue;
          }
        }
      }
    }

    yield msg;
  }
}

const agui = new Hono();

/**
 * Maps taskId → AbortController for active agent runs.
 * Allows /ag-ui/stop/:taskId to abort the agent without relying on SSE disconnect.
 * Entries are removed on run completion (RUN_FINISHED/RUN_ERROR).
 */
const activeRunControllers = new Map<string, AbortController>();

/**
 * Maps taskId → current runId's busKey.
 * Each run uses a unique busKey (`agui-${taskId}-${runId}`) to prevent
 * cross-run event replay. The subscribe endpoint looks up the active busKey here.
 */
const activeRunBusKeys = new Map<string, string>();

/**
 * Maps taskId → context needed to rebuild the live file snapshot for a
 * reconnecting client. The persister owns the output-dir scan window.
 */
const activeRunContexts = new Map<string, ReattachRunContext>();

function activeRunContextFor(
  runId: string,
  persister: AGUIEventPersister,
): ReattachRunContext {
  return {
    runId,
    startedAtMs: persister.runStartedAtMs,
    scanOutputArtifacts: () => persister.scanOutputArtifacts(),
    recordRestoredArtifact: (filePath) =>
      persister.recordReattachedArtifact(filePath),
  };
}

/** Everything a run needs to start, and to start again after a pause. */
interface AGUIRunLaunch {
  taskId: string;
  threadId: string;
  runId: string;
  controller: AbortController;
  /** The agent's messages. A continuation run reads the same source. */
  source: PausableSource<AgentMessage>;
  emitterContext: Omit<AGUIRunContext, 'signal' | 'taskId'>;
  makePersister: (runId: string) => AGUIEventPersister;
  makePromoter: (runId: string) => AttachmentPromotionService;
  quietClose: {
    enabled: boolean;
    quietMs: ReturnType<typeof forwardedQuietMs>;
  };
}

/**
 * Starts one detached run and returns its bus key.
 *
 * A run that ends at an open tool-permission prompt leaves its agent waiting.
 * It keeps its controller and message source, and a hold starts the next run
 * on that source once no prompt for the task is open. Any other ending
 * releases the controller.
 */
function launchAGUIRun(spec: AGUIRunLaunch): string {
  const { taskId, threadId, runId, controller } = spec;
  const emitter = new AGUIEmitter(threadId, runId, {
    ...spec.emitterContext,
    signal: controller.signal,
    taskId,
  });
  const busKey = `agui-${taskId}-${runId}`;
  activeRunBusKeys.set(taskId, busKey);
  const persister = spec.makePersister(runId);
  activeRunContexts.set(taskId, activeRunContextFor(runId, persister));
  const promoter = spec.makePromoter(runId);
  const releaseController = (): void => {
    if (activeRunControllers.get(taskId) === controller) {
      activeRunControllers.delete(taskId);
    }
  };

  startDetachedAGUIRun({
    mode: 'task',
    ownerKey: taskId,
    runId,
    threadId,
    busKey,
    controller,
    persister,
    reattach: activeRunContextFor(runId, persister),
    events: withDesignLiveArtifactQuietClose(
      withAttachmentPromotionEvents(
        emitter.transform(spec.source),
        promoter,
        runId,
      ),
      {
        enabled: spec.quietClose.enabled,
        taskId,
        runId,
        threadId,
        quietMs: spec.quietClose.quietMs,
      },
    ),
    onTerminal: () => {
      if (activeRunBusKeys.get(taskId) === busKey) {
        activeRunBusKeys.delete(taskId);
      }
      if (activeRunContexts.get(taskId)?.runId === runId) {
        activeRunContexts.delete(taskId);
      }
      if (!emitter.isPaused()) {
        releaseController();
        return;
      }
      if (controller.signal.aborted) {
        spec.source.close();
        releaseController();
        return;
      }
      holdUntilPermissionsSettled({
        taskId,
        signal: controller.signal,
        resume: (nextRunId) => {
          // The continuation is a new emitter. Carry the plan the paused run
          // left open, so its terminal event settles the same widget.
          launchAGUIRun({
            ...spec,
            runId: nextRunId,
            emitterContext: {
              ...spec.emitterContext,
              planActivityId: emitter.openPlanActivityId() ?? undefined,
            },
          });
        },
        abandon: () => {
          spec.source.close();
          releaseController();
        },
      });
    },
  }).catch((err) => {
    logger.error('AG-UI detached pipeline error', {
      error: err,
      threadId,
      runId,
    });
  });
  return busKey;
}

/** Matches `data:<mimeType>;base64,<data>` — used by extractImages and image field parsing. */
const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/;

/**
 * Wraps an agent stream with separate 'planning' and 'execution' step boundaries.
 * Emits step_started:planning first, then on the first 'plan' message transitions to execution.
 * On direct-answer paths (no plan message), closes planning and opens/closes execution anyway.
 */
async function* withPlanExecutionSteps(
  source: AsyncGenerator<AgentMessage>,
): AsyncGenerator<AgentMessage> {
  let planSeen = false;
  yield { type: 'step_started', stepName: 'planning' };
  for await (const msg of source) {
    if (msg.type === 'plan' && !planSeen) {
      planSeen = true;
      yield msg;
      yield { type: 'step_finished', stepName: 'planning' };
      yield { type: 'step_started', stepName: 'execution' };
    } else {
      yield msg;
    }
  }
  if (!planSeen) {
    // Direct-answer path: no plan was seen, close planning step
    yield { type: 'step_finished', stepName: 'planning' };
    yield { type: 'step_started', stepName: 'execution' };
  }
  yield { type: 'step_finished', stepName: 'execution' };
}

/**
 * A complete, empty run for a resume that decides not to execute anything
 * (plan rejected or cancelled), or that leaves other decisions open. Returning
 * bare JSON would leave the client's pending interrupt open; a terminal run
 * clears it, or replaces it with the interrupts still waiting.
 */
function terminalRunStream(
  c: Context,
  input: {
    threadId: string;
    runId: string;
    outcome: 'success' | 'cancelled' | { interrupts: Interrupt[] };
  },
): Response {
  return streamSSE(c, async (stream) => {
    const encoder = new EventEncoder({ accept: c.req.header('Accept') ?? '' });
    const timestamp = Date.now();
    await stream.write(
      encoder.encode({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
        timestamp,
      } as BaseEvent),
    );
    await stream.write(
      encoder.encode({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
        timestamp,
        ...(input.outcome === 'cancelled'
          ? { outcome: { type: 'cancelled' } }
          : typeof input.outcome === 'object'
            ? {
                outcome: {
                  type: 'interrupt',
                  interrupts: input.outcome.interrupts,
                },
              }
            : {}),
      } as BaseEvent),
    );
  });
}

// AG-UI protocol sends content as string or ContentBlock[]. An `activity`
// message carries an object; it is accepted so a thread that holds one can
// run, and is then dropped by the role filter before model input is built.
const messageContentSchema = z
  .union([z.string(), z.array(z.unknown()), z.record(z.string(), z.unknown())])
  .nullable()
  .optional();
type MessageContent = z.infer<typeof messageContentSchema>;

const imageBlockSchema = z.object({
  type: z.literal('image'),
  /** Data URL: `data:<mimeType>;base64,<data>` */
  image: z.string(),
});

const runSchema = z.object({
  threadId: z.string(),
  messages: z
    .array(
      z.object({
        id: z.string().optional(),
        role: z.string(),
        content: messageContentSchema,
      }),
    )
    .optional()
    .default([]),
  /** Reserved for Phase 4 bidirectional state sync */
  state: z.unknown().optional(),
  runId: z.string().optional(),
  clientRequestId: z.string().min(1).max(200).optional(),
  messageId: z.string().min(1).max(200).optional(),
  supplementalSkillIds: z.array(z.string()).max(3).optional(),
  runContext: RunContextEnvelopeInputSchema.optional(),
  workDir: z.string().optional(),
  taskId: z.string().optional(),
  modelConfig: z.record(z.string(), z.unknown()).optional(),
  language: z.string().optional(),
  /** CopilotKit forwarded props — task id, work dir, model config, images */
  forwardedProps: z.record(z.string(), z.unknown()).optional(),
  /**
   * Standard AG-UI resume: answers to the interrupts that ended a previous
   * run. CopilotKit sends this as a top-level field, not inside forwardedProps.
   */
  resume: ResumeSchema.optional(),
  /**
   * Image attachments injected by ModelAwareHttpAgent to bypass
   * toAgUiMessages() which strips image content blocks.
   */
  images: z.array(imageBlockSchema).optional(),
});

const interruptSchema = z.object({
  response: z.string(),
});

/** Reusable validator for taskId path params — rejects traversal patterns. */
const taskIdParamSchema = z.string().regex(/^[\w][\w.-]*$/);

/**
 * Builds ConversationMessage[] from V1 DB messages.
 * Mirrors the logic in buildConversationHistory (agent-messages.ts) on the frontend.
 */
function buildConversationFromDb(messages: Message[]): ConversationMessage[] {
  const result: ConversationMessage[] = [];
  let pendingAssistant = '';

  const flushAssistant = () => {
    if (pendingAssistant) {
      result.push({ role: 'assistant', content: pendingAssistant.trim() });
      pendingAssistant = '';
    }
  };

  for (const msg of messages) {
    if (msg.type === 'user' && msg.content) {
      flushAssistant();
      result.push({ role: 'user', content: msg.content });
    } else if (msg.type === 'text' && msg.content) {
      pendingAssistant += msg.content + '\n';
    } else if (msg.type === 'tool_use' && msg.tool_name) {
      // Include tool name and truncated args for agent context
      const argsPreview = msg.tool_input
        ? msg.tool_input.length > 200
          ? msg.tool_input.slice(0, 200) + '...'
          : msg.tool_input
        : '';
      pendingAssistant += `[Used tool: ${msg.tool_name}${argsPreview ? ` with args: ${argsPreview}` : ''}]\n`;
    } else if (msg.type === 'tool_result' && msg.tool_output) {
      // Include truncated tool output for agent context
      const outputPreview =
        msg.tool_output.length > 500
          ? msg.tool_output.slice(0, 500) + '...'
          : msg.tool_output;
      pendingAssistant += `[Tool result: ${outputPreview}]\n`;
    }
  }
  flushAssistant();
  return result;
}

/**
 * AG-UI protocol endpoint.
 * Accepts RunAgentInput, runs the agent via existing service, streams AG-UI events.
 * Coexists with /api/agent routes during migration.
 *
 * Error handling: AGUIEmitter.transform() always emits the terminal event
 * (RUN_FINISHED or RUN_ERROR). The Hono onError handler only fires for errors
 * that escape before the stream is opened (e.g. JSON parse failures).
 */
/** Extract plain text from AG-UI message content (string or ContentBlock[]). */
function extractText(content: MessageContent): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        typeof b === 'object' && b !== null && 'text' in b
          ? String((b as { text: unknown }).text)
          : '',
      )
      .join('');
  }
  return '';
}

/** Extract image attachments from AG-UI message content (ContentBlock[]). */
function extractImages(content: MessageContent): ImageAttachment[] {
  if (!Array.isArray(content)) return [];
  const images: ImageAttachment[] = [];
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).type === 'image' &&
      typeof (block as Record<string, unknown>).image === 'string'
    ) {
      const dataUrl = (block as { image: string }).image;
      // Parse data URL: data:<mimeType>;base64,<data>
      const match = DATA_URL_RE.exec(dataUrl);
      if (match) {
        images.push({ mimeType: match[1]!, data: match[2]! });
      }
    }
  }
  return images;
}

agui.post('/run', zValidator('json', runSchema), async (c) => {
  const {
    threadId,
    messages,
    runId: bodyRunId,
    clientRequestId,
    messageId,
    supplementalSkillIds,
    runContext: requestedRunContext,
    workDir,
    taskId,
    modelConfig,
    language,
    images: bodyImages,
    forwardedProps,
  } = c.req.valid('json');

  const runId = crypto.randomUUID();

  // Resolve forwarded props — CopilotKit passes frontend values here
  const forwardedTaskId = (forwardedProps?.taskId as string) ?? undefined;
  const effectiveTaskId = taskId ?? forwardedTaskId ?? threadId;

  // Desktop UI is the install-owner. Tag every run with platform='desktop'
  // so ConnectorPolicy (src-api/src/shared/auth/connector-policy.ts) returns
  // ALLOW_ALL instead of fail-closed DENY_ALL on missing channelContext.
  const desktopChannelContext = {
    platform: 'desktop',
    conversationId: effectiveTaskId,
    permissionTier: 'admin' as const,
  };
  const effectiveWorkDir =
    workDir ?? (forwardedProps?.workDir as string | undefined);
  const additionalWorkDirs = Array.isArray(forwardedProps?.additionalWorkDirs)
    ? (forwardedProps.additionalWorkDirs as string[]).filter(
        (s) => typeof s === 'string',
      )
    : undefined;
  const effectiveModelConfig =
    modelConfig ??
    (forwardedProps?.modelConfig as Record<string, unknown> | undefined);
  const effectiveLanguage =
    language ?? (forwardedProps?.language as string | undefined);
  const mentionedMcpServers =
    (forwardedProps?.mcpServers as string[] | undefined) ?? undefined;
  let pinnedSkills =
    (forwardedProps?.pinnedSkills as string[] | undefined) ?? undefined;
  const agentProfileId =
    (forwardedProps?.assigneeProfileId as string | undefined) ?? undefined;
  const autoApprove =
    (forwardedProps?.autoApprove as boolean | undefined) === true;
  const liveArtifactQuietCloseEnabled = isDesignLiveArtifactRun(forwardedProps);
  const liveArtifactQuietMs = forwardedQuietMs(forwardedProps);
  const rawBranchId =
    (forwardedProps?.branchId as string | undefined) ?? undefined;
  const branchId =
    rawBranchId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      rawBranchId,
    )
      ? rawBranchId
      : undefined;

  // Validate modelConfig.baseUrl against SSRF early — used by both resume and normal runs.
  const validatedModelConfig = effectiveModelConfig as
    | {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
        agentType?: AgentProvider;
      }
    | undefined;
  if (validatedModelConfig?.baseUrl) {
    const urlCheck = await validateBaseUrlForFetch(
      validatedModelConfig.baseUrl,
      'POST',
    );
    if (!urlCheck.valid) {
      logger.warn('Blocked SSRF attempt via modelConfig.baseUrl', {
        baseUrl: safeUrlHostname(validatedModelConfig.baseUrl),
        reason: urlCheck.reason,
      });
      return c.json({ error: 'Invalid base URL' }, 400);
    }
  }

  // Standard AG-UI resume — CopilotKit sends answers to the interrupts that
  // ended a previous run as a top-level `resume` array.
  //
  // A plan decision starts the execution run. A decision whose continuation
  // is a live SDK callback (tool permission, native AskUserQuestion) cannot be
  // answered here: this request is a new run, and the runtime supersedes the
  // live one before the route sees it. Those answers keep their live endpoint,
  // and this route says so explicitly instead of dropping a pending reply.
  const resumeEntries = c.req.valid('json').resume;
  // A question answer is the next turn: it is validated here, recorded where
  // the run is accepted, and then runs through the normal path below.
  const questionResume = resolveQuestionResume({
    taskId: effectiveTaskId,
    entries: resumeEntries ?? [],
    lastUserText: extractText(
      messages.filter((m) => m.role === 'user').at(-1)?.content,
    ),
  });
  if (questionResume.kind === 'rejected') {
    return c.json(questionResume.body, questionResume.status);
  }
  if (questionResume.kind === 'cancel') {
    if (!cancelQuestionOnce(questionResume.questionId)) {
      return c.json(
        {
          error: 'This decision was already answered',
          code: 'already_resolved',
          interruptIds: resumeEntries?.map((entry) => entry.interruptId) ?? [],
        },
        409,
      );
    }
    // A cancelled destination question can never be claimed, so the batch it
    // would have authorized starts nothing.
    cancelDownloadDestinationRequest(
      effectiveTaskId,
      questionResume.questionId,
    );
    return terminalRunStream(c, { threadId, runId, outcome: 'cancelled' });
  }
  if (
    questionResume.kind === 'none' &&
    resumeEntries &&
    resumeEntries.length > 0
  ) {
    const refs = resumeEntries.map((entry) => ({
      entry,
      ref: parseDecisionInterruptId(entry.interruptId),
    }));
    const unknown = refs.find((item) => item.ref === null);
    if (unknown) {
      return c.json(
        {
          error: `Unknown interrupt: ${unknown.entry.interruptId}`,
          code: 'unknown_interrupt',
        },
        404,
      );
    }
    const seen = new Set<string>();
    for (const item of refs) {
      if (seen.has(item.entry.interruptId)) {
        return c.json(
          {
            error: `Interrupt answered twice: ${item.entry.interruptId}`,
            code: 'duplicate_interrupt',
          },
          400,
        );
      }
      seen.add(item.entry.interruptId);
    }

    const planEntries = refs.filter((item) => item.ref?.kind === 'plan');
    if (planEntries.length > 1) {
      return c.json(
        { error: 'A batch may answer one plan', code: 'multiple_plans' },
        400,
      );
    }
    if (planEntries.length === 1 && refs.length > 1) {
      return c.json(
        {
          error: 'A plan decision cannot share a run with other decisions',
          code: 'mixed_batch',
        },
        400,
      );
    }
    if (planEntries.length === 0) {
      const onlyPermissions = refs.every(
        (item) => item.ref?.kind === 'permission',
      );
      if (!onlyPermissions) {
        return c.json(
          {
            error:
              'This decision is waiting on a live run; answer it through its live endpoint',
            code: 'continuation_requires_live_endpoint',
            interruptIds: resumeEntries.map((entry) => entry.interruptId),
          },
          409,
        );
      }

      const validation = validatePermissionEntries(
        effectiveTaskId,
        resumeEntries,
      );
      switch (validation.kind) {
        case 'unavailable':
          return c.json(
            {
              error:
                'This permission is no longer waiting; it was answered, expired, or the app restarted',
              code: 'continuation_unavailable',
              interruptId: validation.interruptId,
            },
            409,
          );
        case 'wrong_thread':
          return c.json(
            {
              error: 'This decision belongs to another task',
              code: 'wrong_thread',
              interruptId: validation.interruptId,
            },
            409,
          );
        case 'invalid_response':
          return c.json(
            {
              error: validation.error,
              code: 'invalid_response',
              interruptId: validation.interruptId,
            },
            400,
          );
        case 'valid':
          break;
      }
      // A prompt answered while its run is still live has no run to continue.
      if (!hasPermissionHold(effectiveTaskId)) {
        return c.json(
          {
            error:
              'This decision is waiting on a live run; answer it through its live endpoint',
            code: 'continuation_requires_live_endpoint',
            interruptIds: resumeEntries.map((entry) => entry.interruptId),
          },
          409,
        );
      }

      const answeredIds = new Set(
        validation.answers.map((answer) => answer.requestId),
      );
      const stillOpen = listOpenPermissionWaits(effectiveTaskId).filter(
        (wait) => !answeredIds.has(wait.prompt.id),
      );
      // The last answer settles the final prompt and starts the continuation
      // inside this call, so it must already know which run id to use.
      expectContinuationRunId(
        effectiveTaskId,
        stillOpen.length === 0 ? runId : undefined,
      );
      const lost = await applyPermissionAnswers(validation.answers);
      if (lost.length > 0) {
        return c.json(
          {
            error: 'This decision was already answered',
            code: 'already_resolved',
            interruptIds: lost,
          },
          409,
        );
      }

      if (stillOpen.length > 0) {
        // Some prompts remain: this request ends at them, as the first run did.
        return terminalRunStream(c, {
          threadId,
          runId,
          outcome: { interrupts: stillOpen.map(permissionInterrupt) },
        });
      }
      const continuationBusKey = activeRunBusKeys.get(effectiveTaskId);
      if (continuationBusKey !== `agui-${effectiveTaskId}-${runId}`) {
        // Stopped while the answer was in flight: there is nothing to continue.
        return terminalRunStream(c, { threadId, runId, outcome: 'cancelled' });
      }
      return streamSSE(c, async (stream) => {
        await subscribeSSEToBus(
          stream,
          continuationBusKey,
          c.req.header('Accept') ?? '',
          c.req.raw.signal,
        );
        logger.info('AG-UI permission continuation SSE stream closed', {
          threadId,
          runId,
        });
      });
    }

    const outcome = resolvePlanDecision(effectiveTaskId, planEntries[0]!.entry);
    switch (outcome.kind) {
      case 'unknown':
        return c.json(
          { error: 'Plan not found', code: 'unknown_interrupt' },
          404,
        );
      case 'wrong_thread':
        return c.json(
          {
            error: 'This decision belongs to another task',
            code: 'wrong_thread',
          },
          409,
        );
      case 'already_resolved':
        return c.json(
          {
            error: 'This decision was already answered',
            code: 'already_resolved',
            status: outcome.status,
          },
          409,
        );
      case 'stale':
        return c.json(
          {
            error: 'This plan is no longer awaiting a decision',
            code: 'stale_interrupt',
          },
          409,
        );
      case 'invalid_response':
        return c.json({ error: outcome.error, code: 'invalid_response' }, 400);
      case 'rejected':
      case 'cancelled':
        return terminalRunStream(c, {
          threadId,
          runId,
          outcome: outcome.kind === 'cancelled' ? 'cancelled' : 'success',
        });
      case 'approved':
        break;
    }

    const planRun = outcome.run;
    const executePlanId = planRun.id;
    const planGoal = outcome.plan.goal;
    const originalPrompt =
      extractText(messages.filter((m) => m.role === 'user').at(0)?.content) ||
      planGoal;

    const execSession = createSession('execute');
    // Abort any previous run for this task before starting execution
    const prevExecController = activeRunControllers.get(effectiveTaskId);
    if (prevExecController) {
      prevExecController.abort();
    }
    activeRunControllers.set(effectiveTaskId, execSession.abortController);

    const wsRoot = effectiveWorkDir ?? getSetting('workDir') ?? undefined;
    const execSessionCwd = resolveSessionCwd(wsRoot, effectiveTaskId);
    const execDownloads = createTaskDownloadAttachment(
      {
        taskId: effectiveTaskId,
        runId,
        language: effectiveLanguage,
      },
      resolveAgentProvider(validatedModelConfig),
    );
    const planExecStream = runExecutionPhase(
      executePlanId,
      execSession,
      originalPrompt,
      wsRoot,
      effectiveTaskId,
      validatedModelConfig,
      undefined, // sandboxConfig
      undefined, // skillsConfig
      undefined, // mcpConfig
      effectiveLanguage,
      undefined, // runtimeContext
      undefined, // ptcEnabled
      mentionedMcpServers,
      wsRoot, // userWorkspaceDir — grants agent access to the user's folder
      !!wsRoot, // allowWorkspaceWrite
      pinnedSkills,
      undefined, // conversation — execution phase uses plan context
      agentProfileId,
      additionalWorkDirs, // additional user directories for multi-folder selection
      undefined, // autoApprove
      undefined, // thinkingConfig
      undefined, // pluginId
      undefined, // pluginInputs
      desktopChannelContext, // Phase A connector-tier isolation — desktop = admin
      undefined, // verbatimPrompt
      execDownloads,
    );
    // Record the execution run's SDK session so a later branch can fork it.
    // Planning only runs with no assistant history, so on a branch this is
    // the branch's first, fresh session.
    const rawExecStream = withBranchSdkSessionRecording(planExecStream, {
      taskId: effectiveTaskId,
      branchId: branchId ?? 'main',
      runId,
      provider: resolveAgentProvider(validatedModelConfig),
      plan: branchId ? { path: 'sdk', mode: 'fresh' } : { path: 'main' },
      sdkSessionId: execSession.id,
      signal: execSession.abortController.signal,
    });
    // Wrap the stream in a session context so in-process MCP tools (media
    // generation, etc.) resolve the per-session output dir instead of
    // falling back to `${workDir}/output`. Without this wrapper, approved-
    // plan execution wrote generated images to the workspace root.
    const contextualExecStream = execSessionCwd
      ? withSessionContext(
          {
            workDir: execSessionCwd,
            sessionId: execSession.id,
            taskId: effectiveTaskId,
          },
          rawExecStream,
        )
      : rawExecStream;
    const agentStream = withWorkDirSync(
      contextualExecStream,
      effectiveTaskId,
      execSession.abortController.signal,
    );

    // Launch detached pipeline — runs independently of the SSE connection.
    // Events are published to taskEventBus + persisted regardless of client state.
    const busKey = launchAGUIRun({
      taskId: effectiveTaskId,
      threadId,
      runId,
      controller: execSession.abortController,
      source: new PausableSource(withPlanExecutionSteps(agentStream)),
      emitterContext: {
        workspaceRoot: wsRoot,
        taskTitle: planGoal,
        provider: validatedModelConfig?.agentType ?? 'claude',
        model: validatedModelConfig?.model,
      },
      // Pass sessionCwd so scanSessionOutputDir can backfill agent-generated
      // files into the DB at RUN_FINISHED (matches non-interrupt branch).
      makePersister: (id) =>
        new AGUIEventPersister(
          effectiveTaskId,
          id,
          wsRoot,
          execSessionCwd,
          validatedModelConfig?.agentType ?? 'claude',
          runProvenance(validatedModelConfig),
          'task',
          branchId ?? 'main',
        ),
      makePromoter: (id) =>
        new AttachmentPromotionService({
          taskId: effectiveTaskId,
          runId: id,
          sessionCwd: execSessionCwd,
        }),
      quietClose: {
        enabled: liveArtifactQuietCloseEnabled,
        quietMs: liveArtifactQuietMs,
      },
    });

    // SSE handler subscribes to the bus as a passive consumer.
    return streamSSE(
      c,
      async (stream) => {
        await subscribeSSEToBus(
          stream,
          busKey,
          c.req.header('Accept') ?? '',
          c.req.raw.signal,
        );
        logger.info('AG-UI plan execution SSE stream closed', {
          threadId,
          runId,
        });
      },
      async (error, stream) => {
        logger.error('AG-UI plan execution stream error', {
          error,
          threadId,
          runId,
        });
        await stream.writeSSE({
          data: JSON.stringify({
            type: EventType.RUN_ERROR,
            threadId,
            runId,
            message: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
          }),
        });
      },
    );
  }

  // Extract the last user message as the prompt
  const userMessages = messages.filter((m) => m.role === 'user');
  const lastUserMsg = userMessages.at(-1);
  const prompt = extractText(lastUserMsg?.content);
  if (!prompt) {
    return c.json({ error: 'No user message found in messages' }, 400);
  }

  let normalizedRunContext;
  try {
    normalizedRunContext = await resolveRunContext({
      mode: 'task',
      ownerKey: effectiveTaskId,
      envelope: {
        ...requestedRunContext,
        clientRequestId:
          requestedRunContext?.clientRequestId ?? clientRequestId ?? bodyRunId,
        messageId:
          requestedRunContext?.messageId ?? messageId ?? lastUserMsg?.id,
        supplementalSkillIds:
          requestedRunContext?.supplementalSkillIds ?? supplementalSkillIds,
      },
      legacyPinnedSkills: pinnedSkills,
      effectiveWorkDir,
    });
  } catch (error) {
    if (error instanceof RunContextError) {
      return c.json({ error: error.message }, error.status);
    }
    throw error;
  }
  pinnedSkills = normalizedRunContext.supplementalSkillIds;

  // A rewind owns the task's files until its apply loop ends; refuse the run
  // before reserving it rather than letting the agent stream fail mid-start.
  if (
    normalizedRunContext.mode === 'task' &&
    isTaskRewinding(effectiveTaskId)
  ) {
    return c.json(
      {
        error:
          'Task files are being rewound; start the run after the rewind finishes',
      },
      409,
    );
  }

  let reservation;
  try {
    reservation = reserveAgentRun({
      runId,
      mode: normalizedRunContext.mode,
      ownerKey: normalizedRunContext.ownerKey,
      projectId: normalizedRunContext.projectId,
      conversationId: normalizedRunContext.conversationId,
      clientRequestId: normalizedRunContext.clientRequestId,
      requestMessageId: normalizedRunContext.messageId,
      messageContent: prompt,
      provider: validatedModelConfig?.agentType ?? 'claude',
      model: validatedModelConfig?.model,
      runtimeVersion: runProvenance(validatedModelConfig).runtimeVersion,
      sessionHandleKind: runProvenance(validatedModelConfig).sessionHandleKind,
      recovery: normalizedRunContext.recovery,
    });
  } catch (error) {
    if (error instanceof AgentRunConflictError) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
  if (reservation.disposition === 'existing') {
    const activeContext = activeRunContexts.get(effectiveTaskId);
    const activeBusKey = activeRunBusKeys.get(effectiveTaskId);
    if (
      activeContext?.runId === reservation.run.id &&
      activeBusKey &&
      taskEventBus.isTaskActive(activeBusKey)
    ) {
      return streamSSE(c, async (stream) => {
        await subscribeSSEToBus(
          stream,
          activeBusKey,
          c.req.header('Accept') ?? '',
          c.req.raw.signal,
        );
      });
    }
    return c.json({
      runId: reservation.run.id,
      disposition: 'existing',
      status: reservation.run.status,
    });
  }

  // Prefer top-level images field (injected by ModelAwareHttpAgent to bypass
  // toAgUiMessages() stripping). Fall back to forwardedProps.images (CopilotKit V2
  // path), then to content-block extraction.
  const fpImages = (forwardedProps?.images ?? []) as Array<{
    type: string;
    image: string;
  }>;
  const rawImages = bodyImages?.length
    ? bodyImages
    : fpImages.length
      ? fpImages
      : [];
  const images: ImageAttachment[] = rawImages.length
    ? rawImages
        .map((b) => {
          const m = DATA_URL_RE.exec(b.image);
          return m ? { mimeType: m[1]!, data: m[2]! } : null;
        })
        .filter((x): x is ImageAttachment => x !== null)
    : extractImages(lastUserMsg?.content);

  // Build conversation history (all messages except the last user message)
  let conversation: ConversationMessage[] = messages
    .slice(0, -1)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: extractText(m.content),
    }));

  // Fallback: if V2 runtime has no prior context (fresh mount) but the task has
  // DB history from a previous V1 session, load it so the agent can continue
  // the conversation with full context.
  if (conversation.length === 0 && effectiveTaskId) {
    const dbMsgs = branchId
      ? getMessagesByBranch(effectiveTaskId, branchId)
      : getMessagesByTaskId(effectiveTaskId);
    if (dbMsgs.length > 0) {
      conversation = buildConversationFromDb(dbMsgs);
      logger.info('Loaded conversation context from DB', {
        taskId: effectiveTaskId,
        branchId: branchId ?? 'main',
        turns: conversation.length,
      });
    }
  }
  // Resolve before this run's user message is persisted: a branch's first run
  // forks the SDK session at its fork point, later runs resume that session.
  const runProvider = resolveAgentProvider(validatedModelConfig);
  let branchPlan: BranchContextPlan;
  try {
    branchPlan = resolveBranchContextPlan({
      taskId: effectiveTaskId,
      branchId: branchId ?? 'main',
      provider: runProvider,
    });
  } catch (err) {
    logger.warn('Branch SDK session lookup failed; using text history', {
      taskId: effectiveTaskId,
      branchId,
      error: err instanceof Error ? err.message : String(err),
    });
    branchPlan = branchId
      ? { path: 'text', reason: 'no-recorded-session' }
      : { path: 'main' };
  }
  if (branchPlan.path !== 'main') {
    logger.info('Branch run context', {
      taskId: effectiveTaskId,
      branchId,
      provider: runProvider,
      path: branchPlan.path,
      ...(branchPlan.path === 'sdk'
        ? { mode: branchPlan.mode }
        : { reason: branchPlan.reason }),
    });
  }
  const branchSession =
    branchPlan.path === 'sdk' && branchPlan.mode !== 'fresh'
      ? branchPlan.branchSession
      : undefined;

  // The answer is recorded only now that the run is accepted, so a refused
  // run leaves the question open. Check and write are one synchronous step.
  let claimedDownload: ReturnType<typeof claimDownloadDestination> | undefined;
  if (questionResume.kind === 'answer') {
    // A download answer authorizes exactly one batch. The claim is taken
    // before the answer is recorded, so a folder that is no longer permitted
    // leaves the question open for another choice.
    if (
      Object.prototype.hasOwnProperty.call(
        questionResume.answers,
        DOWNLOAD_DESTINATION_QUESTION,
      )
    ) {
      const claim = claimDownloadDestination(
        effectiveTaskId,
        questionResume.questionId,
        questionResume.answers[DOWNLOAD_DESTINATION_QUESTION] ?? '',
        runId,
      );
      if (!claim.ok) {
        finishAgentRun({
          id: reservation.run.id,
          status: 'failed',
          completeness: 'unfinished',
          error: claim.message,
        });
        return c.json(
          {
            error: claim.message,
            code:
              claim.reason === 'started'
                ? 'already_resolved'
                : 'destination_denied',
            interruptIds: [`question:${questionResume.questionId}`],
          },
          409,
        );
      }
      claimedDownload = claim;
    }
    const recorded = answerQuestionOnce(
      questionResume.questionId,
      questionResume.answers,
    );
    if (!recorded.ok) {
      // This request created the reservation and no run will use it; leaving
      // it `running` would hold the task until the next restart.
      finishAgentRun({
        id: reservation.run.id,
        status: 'failed',
        completeness: 'unfinished',
        error: recorded.message,
      });
      return c.json(
        {
          error: recorded.message,
          code:
            recorded.reason === 'expired'
              ? 'continuation_unavailable'
              : 'already_resolved',
          interruptIds: [`question:${questionResume.questionId}`],
        },
        409,
      );
    }
  }

  // Resolve workspace root early — needed for task INSERT and STATE_SNAPSHOT context
  const workspaceRoot = effectiveWorkDir ?? getSetting('workDir') ?? undefined;

  try {
    const db = getDatabase();

    // Persist user messages so branching can reference them by message_id.
    // INSERT OR IGNORE avoids duplicates across follow-up runs (message_id has a unique index).
    // An answer's turn is tagged so rewind and the legacy transcript treat it as an answer.
    const userMsgStmt = db.prepare(
      `INSERT OR IGNORE INTO messages (task_id, type, content, message_id, branch_id, run_id, created_at, subtype)
       VALUES (?, 'user', ?, ?, ?, ?, datetime('now'), ?)`,
    );
    for (const msg of userMessages) {
      const content = extractText(msg.content);
      const persistedMessageId =
        msg === lastUserMsg ? normalizedRunContext.messageId : msg.id;
      if (persistedMessageId && content) {
        userMsgStmt.run(
          effectiveTaskId,
          content,
          persistedMessageId,
          branchId ?? 'main',
          runId,
          msg === lastUserMsg && questionResume.kind === 'answer'
            ? 'question_answer'
            : null,
        );
      }
    }
  } catch {
    // Best-effort — don't block the run for a DB error
  }

  // Route: conversational prompts and image-attached runs skip planning.
  // Multi-turn follow-ups (conversation has assistant replies) also skip —
  // only the first user message goes through planning.
  // Non-Claude agents (Codex, Gemini, HTTP) handle planning internally —
  // their plan() only emits boilerplate, so always skip to direct execution.
  const hasAssistantHistory = conversation.some((m) => m.role === 'assistant');
  const isNonNativePlanner =
    validatedModelConfig?.agentType &&
    validatedModelConfig.agentType !== 'claude';
  const isConversational = isConversationalPrompt(prompt);
  const isSingleAction = isSingleActionPrompt(prompt);
  if (!isConversational && !isSingleAction && !hasAssistantHistory) {
    logger.info('Planning decision debug', {
      promptPreview: prompt.slice(0, 120),
      promptLength: prompt.length,
      isConversational,
      isSingleAction,
    });
  }
  const skipPlanning =
    isNonNativePlanner ||
    images.length > 0 ||
    hasAssistantHistory ||
    isConversational ||
    isSingleAction;
  const session = createSession(skipPlanning ? 'execute' : 'plan');

  // Abort any previous run for this task (React StrictMode double-mount,
  // user sending a new message while previous run is still in-flight, etc.)
  const prevController = activeRunControllers.get(effectiveTaskId);
  if (prevController) {
    prevController.abort();
  }
  // Register the session's AbortController so /ag-ui/stop/:taskId can abort it.
  activeRunControllers.set(effectiveTaskId, session.abortController);
  const taskTitle = taskId ? (getTask(taskId)?.title ?? undefined) : undefined;
  const abortSignal = c.req.raw.signal;

  // The download tool is attached to the run that can ask the user a question:
  // the direct turn and the execution phase after a plan. A planning run only
  // plans, so it gets none.
  const downloads: DownloadAttachment | undefined = skipPlanning
    ? createTaskDownloadAttachment(
        {
          taskId: effectiveTaskId,
          runId,
          language: effectiveLanguage,
        },
        runProvider,
      )
    : undefined;

  // Do NOT propagate client disconnect → session abort.
  // The agent generator runs in a detached pipeline (runDetachedPipeline)
  // that unconditionally publishes to taskEventBus + AGUIEventPersister.
  // The SSE handler subscribes as a passive consumer via subscribeSSEToBus.
  // Client disconnect only stops SSE writing — the generator keeps running
  // so late-joiners can reconnect via /ag-ui/subscribe/:taskId.
  // The agent's own completion (RUN_FINISHED/RUN_ERROR) or an explicit
  // /ag-ui/stop/:taskId call is the canonical stop signal.

  logger.info('AG-UI run started', {
    threadId,
    runId,
    promptLength: prompt.length,
    imageCount: images.length,
    bodyImageCount: bodyImages?.length ?? 0,
    skipPlanning,
    isSingleAction,
    hasAssistantHistory,
    conversationLength: conversation.length,
  });

  // Planning path: run plan phase, emit plan as interrupt, stream ends.
  // Direct path: run agent directly (conversational, images, or follow-up).
  const rawStream = skipPlanning
    ? withBranchSdkSessionRecording(
        runAgent(prompt, {
          session,
          // A forked or resumed SDK session already holds the history.
          conversation:
            branchPlan.path !== 'sdk' && conversation.length > 0
              ? conversation
              : undefined,
          branchSession,
          workDir: workspaceRoot,
          taskId: effectiveTaskId,
          modelConfig: validatedModelConfig,
          images: images.length > 0 ? images : undefined,
          language: effectiveLanguage,
          mentionedMcpServers,
          userWorkspaceDir: workspaceRoot,
          allowWorkspaceWrite: !!workspaceRoot,
          pinnedSkills,
          agentProfileId,
          additionalUserDirs: additionalWorkDirs,
          autoApprove,
          channelContext: desktopChannelContext,
          downloads,
        }),
        {
          taskId: effectiveTaskId,
          branchId: branchId ?? 'main',
          runId,
          provider: runProvider,
          plan: branchPlan,
          sdkSessionId: session.id,
          signal: session.abortController.signal,
        },
      )
    : runPlanningPhase(
        prompt,
        session,
        workspaceRoot,
        validatedModelConfig,
        effectiveLanguage,
        undefined, // runtimeContext
        agentProfileId,
        effectiveTaskId,
        additionalWorkDirs,
        undefined, // thinkingConfig
        undefined, // pluginId
        undefined, // pluginInputs
        desktopChannelContext, // Phase A connector-tier isolation — desktop = admin
      );
  // Resolve per-session cwd so in-process MCP tools don't fall back to root workDir.
  const sessionCwd = resolveSessionCwd(workspaceRoot, effectiveTaskId);
  const batchStream = claimedDownload?.ok
    ? withDownloadBatch(
        rawStream,
        claimedDownload.value.operation,
        startDownloadBatch,
        session.abortController.signal,
      )
    : rawStream;
  const contextualStream = sessionCwd
    ? withSessionContext(
        { workDir: sessionCwd, sessionId: session.id, taskId: effectiveTaskId },
        batchStream,
      )
    : batchStream;

  // Wrap to sync the agent's actual session CWD into the task's work_dir
  const agentStream = withWorkDirSync(
    contextualStream,
    effectiveTaskId,
    session.abortController.signal,
  );

  // Launch detached pipeline — runs independently of the SSE connection.
  // Events are published to taskEventBus + persisted regardless of client state.
  // Late-joiners reconnecting via /ag-ui/subscribe/:taskId will receive all events.
  const busKey = launchAGUIRun({
    taskId: effectiveTaskId,
    threadId,
    runId,
    controller: session.abortController,
    source: new PausableSource(withPlanExecutionSteps(agentStream)),
    emitterContext: {
      workspaceRoot,
      taskTitle,
      // Only a planning run ends with a decision to make.
      planInterrupt: !skipPlanning,
      provider: validatedModelConfig?.agentType ?? 'claude',
      model: validatedModelConfig?.model,
    },
    makePersister: (id) =>
      new AGUIEventPersister(
        effectiveTaskId,
        id,
        workspaceRoot,
        sessionCwd,
        validatedModelConfig?.agentType ?? 'claude',
        runProvenance(validatedModelConfig),
        'task',
        branchId ?? 'main',
      ),
    makePromoter: (id) =>
      new AttachmentPromotionService({
        taskId: effectiveTaskId,
        runId: id,
        sessionCwd,
      }),
    quietClose: {
      enabled: liveArtifactQuietCloseEnabled,
      quietMs: liveArtifactQuietMs,
    },
  });

  // SSE handler subscribes to the bus as a passive consumer.
  // Client disconnect only stops SSE writing — the generator keeps running.
  return streamSSE(
    c,
    async (stream) => {
      await subscribeSSEToBus(
        stream,
        busKey,
        c.req.header('Accept') ?? '',
        abortSignal,
      );
      logger.info('AG-UI run SSE stream closed', { threadId, runId });
    },
    async (error, stream) => {
      // Hono streamSSE error handler — fires if an unhandled exception escapes
      logger.error('AG-UI unhandled stream error', { error, threadId, runId });
      await stream.writeSSE({
        data: JSON.stringify({
          type: EventType.RUN_ERROR,
          threadId,
          runId,
          message: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        }),
      });
    },
  );
});

agui.post('/cancel/:mode/:ownerKey/:runId', (c) => {
  const mode = runModeParamSchema.safeParse(c.req.param('mode'));
  if (!mode.success) return c.json({ error: 'Invalid mode' }, 400);
  const ownerKey = c.req.param('ownerKey');
  const runId = c.req.param('runId');
  const run = getAgentRun(runId);
  if (!run) return c.json({ error: 'Run not found' }, 404);
  if (run.mode !== mode.data || run.owner_key !== ownerKey) {
    return c.json({ error: 'Run owner mismatch' }, 409);
  }
  return c.json({
    ok: cancelActiveAGUIRun(mode.data, ownerKey, runId),
  });
});

/**
 * AG-UI stop — explicitly aborts a running agent.
 * Called by the frontend's stop button. Required because client disconnect
 * no longer auto-aborts the agent (to support background runs).
 */
agui.post('/stop/:taskId', (c) => {
  const rawTaskId = c.req.param('taskId');
  const parsed = taskIdParamSchema.safeParse(rawTaskId);
  if (!parsed.success) return c.json({ error: 'Invalid taskId' }, 400);
  const taskId = parsed.data;

  const activeRun = findActiveAGUIRun('task', taskId);
  const controller = activeRunControllers.get(taskId);
  // A run held at a permission prompt has no active run; release it first so
  // the abort below settles the prompt without starting a continuation.
  releasePermissionHold(taskId);
  if (activeRun) {
    cancelActiveAGUIRun('task', taskId, activeRun.runId);
    activeRunControllers.delete(taskId);
    logger.info('Agent stopped via /stop endpoint', { taskId });
  } else if (controller) {
    controller.abort();
    activeRunControllers.delete(taskId);
    logger.info('Agent stopped via /stop endpoint', { taskId });
  }
  return c.json({ ok: true });
});

/**
 * AG-UI interrupt — maps to existing task reply mechanism.
 * Allows the frontend to send a user reply to a suspended agent.
 * Uses taskId as the key (matching how the agent was registered in activeQueryStore).
 */
agui.post(
  '/interrupt/:taskId',
  zValidator('json', interruptSchema),
  async (c) => {
    const rawTaskId = c.req.param('taskId');
    const parsed = taskIdParamSchema.safeParse(rawTaskId);
    if (!parsed.success) return c.json({ error: 'Invalid taskId' }, 400);
    const taskId = parsed.data;
    const { response } = c.req.valid('json');
    await activeQueryStore.pushReply(taskId, {
      content: response,
      timestamp: Date.now(),
    });
    return c.json({ ok: true });
  },
);

/**
 * AG-UI message history endpoint.
 * Returns the full message history for a task in AG-UI message format.
 * Also indicates whether the task has an active run.
 */
agui.get('/history/:taskId', async (c) => {
  const rawTaskId = c.req.param('taskId');
  const parsed = taskIdParamSchema.safeParse(rawTaskId);
  if (!parsed.success) return c.json({ error: 'Invalid taskId' }, 400);
  const taskId = parsed.data;
  const dbMessages = getMessagesByTaskId(taskId);
  const aguiMessages = dbMessagesToFullAGUI(dbMessages);
  const taskStatus = getTask(taskId)?.status;
  const activeBusKey = activeRunBusKeys.get(taskId);
  const activeRunContext =
    activeBusKey && taskEventBus.isTaskActive(activeBusKey)
      ? activeRunContexts.get(taskId)
      : undefined;
  const { files } = await restoreReattachFiles(taskId, activeRunContext);
  return c.json({
    messages: aguiMessages,
    subagents: dbMessagesToSubagents(dbMessages),
    files,
    isRunning: activeBusKey ? taskEventBus.isTaskActive(activeBusKey) : false,
    taskStatus,
  });
});

/**
 * AG-UI pending plan endpoint.
 * Returns the latest pending plan for a task (if any) together with the
 * standard interrupt that answers it. The interrupt id is what a resume entry
 * must name, so the client never reconstructs it from the plan id.
 */
agui.get('/pending-plan/:taskId', (c) => {
  const rawTaskId = c.req.param('taskId');
  const parsed = taskIdParamSchema.safeParse(rawTaskId);
  if (!parsed.success) return c.json({ error: 'Invalid taskId' }, 400);
  const taskId = parsed.data;

  // Only return a pending plan if the task is actually awaiting approval.
  // Tasks marked 'stopped' are in the plan-approval state (set by AGUIEventPersister
  // when planEmitted=true). Completed/error tasks should not resurface old plans.
  const planRun = pendingPlanRun(taskId);
  const plan = planRun ? parsePlanRun(planRun) : null;
  if (!planRun || !plan) {
    return c.json({ plan: null, interrupt: null });
  }
  return c.json({
    plan,
    interrupt: planInterruptForRun(planRun),
  });
});

/**
 * Open decisions for a task. Used after a reload or task switch: the client
 * cannot recover interrupts from messages, so it asks the backend that owns
 * the decision records.
 */
agui.get('/interrupts/:taskId', async (c) => {
  const rawTaskId = c.req.param('taskId');
  const parsed = taskIdParamSchema.safeParse(rawTaskId);
  if (!parsed.success) return c.json({ error: 'Invalid taskId' }, 400);
  return c.json({ interrupts: await listOpenInterrupts(parsed.data) });
});

/**
 * AG-UI reject plan endpoint.
 * Marks all pending plans for a task as 'rejected' so the poll stops resurfacing them.
 */
agui.post('/reject-plan/:taskId', (c) => {
  const rawTaskId = c.req.param('taskId');
  const parsed = taskIdParamSchema.safeParse(rawTaskId);
  if (!parsed.success) return c.json({ error: 'Invalid taskId' }, 400);
  const taskId = parsed.data;

  const planRuns = getOrchestrationRunsByTaskId(taskId);
  for (const run of planRuns) {
    if (run.run_type === 'plan' && run.status === 'pending') {
      updateOrchestrationRunStatus(run.id, 'rejected');
    }
  }
  return c.json({ ok: true });
});

/**
 * Durable mode-owned replay endpoint. SQLite is authoritative; the in-memory
 * bus is only the live tail after the persisted suffix has been emitted.
 */
agui.get('/subscribe/:mode/:ownerKey/:runId', async (c) => {
  const mode = runModeParamSchema.safeParse(c.req.param('mode'));
  if (!mode.success) return c.json({ error: 'Invalid mode' }, 400);
  const ownerKey = c.req.param('ownerKey');
  const runId = c.req.param('runId');
  const run = getAgentRun(runId);
  if (!run) return c.json({ error: 'Run not found' }, 404);
  if (run.mode !== mode.data || run.owner_key !== ownerKey) {
    return c.json({ error: 'Run owner mismatch' }, 409);
  }

  const afterSeq = parseLastEventId(c.req.header('Last-Event-ID')) ?? -1;
  const persisted = replayAGUIEvents(runId, afterSeq);
  const active = getActiveAGUIRun(mode.data, ownerKey, runId);
  const encoder = new EventEncoder({ accept: c.req.header('Accept') ?? '' });
  const textEncoder = new TextEncoder();
  const firstSeq = (persisted[0] as (BaseEvent & { seq?: number }) | undefined)
    ?.seq;
  const hasGap =
    afterSeq >= 0 && typeof firstSeq === 'number' && firstSeq > afterSeq + 1;
  const gapMessages =
    mode.data === 'task' && hasGap ? getMessagesByTaskId(ownerKey) : [];
  const taskSnapshot =
    mode.data === 'task' && hasGap
      ? {
          type: 'MESSAGES_SNAPSHOT',
          messages: dbMessagesToFullAGUI(gapMessages),
          subagents: dbMessagesToSubagents(gapMessages),
          files: (
            await restoreReattachFiles(
              ownerKey,
              run.status === 'running' || canReconcilePendingDelivery(run)
                ? active?.reattach
                : undefined,
            )
          ).files,
          seq: afterSeq,
          timestamp: Date.now(),
        }
      : null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        controller.close();
      };
      const write = (event: BaseEvent) => {
        if (closed) return;
        controller.enqueue(textEncoder.encode(encoder.encode(event)));
      };

      if (taskSnapshot) {
        controller.enqueue(
          textEncoder.encode(`data: ${JSON.stringify(taskSnapshot)}\n\n`),
        );
      }
      let lastReplayedSeq = afterSeq;
      let terminal = false;
      for (const event of persisted) {
        write(event);
        const seq = (event as BaseEvent & { seq?: number }).seq;
        if (typeof seq === 'number') lastReplayedSeq = seq;
        terminal =
          event.type === EventType.RUN_FINISHED ||
          event.type === EventType.RUN_ERROR;
      }
      if (terminal || !active || run.status !== 'running') {
        close();
        return;
      }

      let subscribing = true;
      let terminalDuringSubscribe = false;
      unsubscribe = taskEventBus.subscribe(
        active.busKey,
        (message) => {
          const event = message as BaseEvent;
          write(event);
          if (
            event.type === EventType.RUN_FINISHED ||
            event.type === EventType.RUN_ERROR
          ) {
            if (subscribing) terminalDuringSubscribe = true;
            else close();
          }
        },
        { afterSeq: lastReplayedSeq },
      );
      subscribing = false;
      if (terminalDuringSubscribe) {
        close();
        return;
      }
      c.req.raw.signal.addEventListener('abort', close, { once: true });
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

/**
 * AG-UI late-joiner subscribe endpoint.
 *
 * Replays all buffered AG-UI events for a task and then delivers live events.
 * Used by clients that missed the initial /ag-ui/run response (e.g., multi-tab,
 * page refresh during a run, background task monitoring).
 *
 * Events are serialized using EventEncoder so clients get proper SSE framing.
 * The busKey matches the key used in /ag-ui/run: `agui-${taskId ?? threadId}`.
 */
agui.get('/subscribe/:taskId', async (c) => {
  const rawTaskId = c.req.param('taskId');
  const parsed = taskIdParamSchema.safeParse(rawTaskId);
  if (!parsed.success) return c.json({ error: 'Invalid taskId' }, 400);
  const taskId = parsed.data;
  const busKey = activeRunBusKeys.get(taskId);
  if (!busKey) {
    // No active run — client should fall back to /ag-ui/history endpoint
    return c.json({ error: 'No active run for this task' }, 404);
  }
  const textEncoder = new TextEncoder();
  const eventEncoder = new EventEncoder({
    accept: c.req.header('Accept') ?? '',
  });
  const lastEventId = parseLastEventId(c.req.header('Last-Event-ID'));
  const seqBounds = taskEventBus.getSeqBounds(busKey);
  const canReplayFromLastEventId =
    lastEventId !== null &&
    seqBounds.minSeq !== null &&
    lastEventId >= seqBounds.minSeq - 1;

  // Load full message history from DB for MESSAGES_SNAPSHOT
  const dbMessages = getMessagesByTaskId(taskId);
  const snapshotMessages = dbMessagesToFullAGUI(dbMessages);
  const { files: snapshotFiles } = await restoreReattachFiles(
    taskId,
    activeRunContexts.get(taskId),
  );

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};

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

      // Emit MESSAGES_SNAPSHOT when the client has no usable sequence cursor.
      // Clients with Last-Event-ID can replay only the missing suffix from the
      // in-memory bus, avoiding duplicate text/tool deltas after task switches.
      if (!canReplayFromLastEventId) {
        try {
          const snapshot = {
            type: 'MESSAGES_SNAPSHOT',
            messages: snapshotMessages,
            subagents: dbMessagesToSubagents(dbMessages),
            files: snapshotFiles,
            seq: lastEventId ?? -1,
            timestamp: Date.now(),
          };
          controller.enqueue(
            textEncoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`),
          );
        } catch {
          closeStream();
          return;
        }
      }

      let receivedTerminal = false;
      let replayingBuffer = true;

      unsubscribe = taskEventBus.subscribe(
        busKey,
        (message) => {
          if (closed) return;
          try {
            const encoded = eventEncoder.encode(message as BaseEvent);
            controller.enqueue(textEncoder.encode(encoded));

            const event = message as { type?: string };
            if (
              event.type === EventType.RUN_FINISHED ||
              event.type === EventType.RUN_ERROR
            ) {
              receivedTerminal = true;
              if (!replayingBuffer) closeStream();
            }
          } catch {
            closeStream();
          }
        },
        canReplayFromLastEventId ? { afterSeq: lastEventId } : undefined,
      );
      replayingBuffer = false;

      // After replay: if the run already finished, close the stream
      if (!taskEventBus.isTaskActive(busKey) || receivedTerminal) {
        closeStream();
        return;
      }

      c.req.raw.signal.addEventListener('abort', () => {
        closeStream();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

function parseLastEventId(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export { agui };
export { agui as aguiRoutes };
