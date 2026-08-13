import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { EventType } from '@ag-ui/core';
import type { BaseEvent } from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import {
  isConversationalPrompt,
  isSingleActionPrompt,
} from '@/core/agent/base';
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
import { AGUIEmitter } from '@/shared/services/ag-ui/emitter';
import { dbMessagesToFullAGUI } from '@/shared/services/ag-ui/history';
import { replayAGUIEvents } from '@/shared/services/ag-ui/journal';
import { AGUIEventPersister } from '@/shared/services/ag-ui/persistence';
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
  runAgent,
  runExecutionPhase,
  runPlanningPhase,
} from '@/shared/services/agent';
import {
  readLiveArtifactQuietMs,
  withDesignLiveArtifactQuietClose,
} from '@/shared/services/design-mode/artifact-quiet-close';
import { withSessionContext } from '@/shared/services/session-context';
import { taskEventBus } from '@/shared/services/task-event-bus';
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

// AG-UI protocol sends content as string or ContentBlock[] — accept both
const messageContentSchema = z
  .union([z.string(), z.array(z.unknown())])
  .nullable()
  .optional();

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
  /** CopilotKit forwarded props — contains command.resume for interrupt responses */
  forwardedProps: z.record(z.string(), z.unknown()).optional(),
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
function extractText(content: string | unknown[] | null | undefined): string {
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
function extractImages(
  content: string | unknown[] | null | undefined,
): ImageAttachment[] {
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

  // CopilotKit interrupt resume — resolve() sends a new run with
  // forwardedProps.command.resume containing the user's response.
  // For plan approval: look up the stored plan and run execution phase.
  // For rejection: return immediately (plan discarded).
  const command = forwardedProps?.command as { resume?: unknown } | undefined;
  if (command?.resume) {
    const resumeData = command.resume as Record<string, unknown>;
    const approved = resumeData.approved === true;
    logger.info('CopilotKit interrupt resume', {
      taskId: effectiveTaskId,
      threadId,
      approved,
    });

    if (!approved) {
      return c.json({ ok: true });
    }

    // Approved — find the latest pending plan for this task and run execution phase
    const planRuns = getOrchestrationRunsByTaskId(effectiveTaskId);
    const planRun = planRuns.find(
      (r) => r.run_type === 'plan' && r.status === 'pending',
    );
    if (!planRun) {
      logger.warn('Plan not found for approved interrupt', {
        taskId: effectiveTaskId,
      });
      return c.json({ error: 'Plan not found' }, 404);
    }

    const executePlanId = planRun.id;
    // Mark plan as approved so it won't be returned by /pending-plan again
    updateOrchestrationRunStatus(executePlanId, 'approved');
    let planGoal = '';
    try {
      planGoal = (JSON.parse(planRun.payload) as { goal?: string }).goal ?? '';
    } catch {
      /* best-effort */
    }
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
    const execEmitter = new AGUIEmitter(threadId, runId, {
      workspaceRoot: wsRoot,
      taskTitle: planGoal,
    });

    const busKey = `agui-${effectiveTaskId}-${runId}`;
    activeRunBusKeys.set(effectiveTaskId, busKey);
    // Pass sessionCwd so scanSessionOutputDir can backfill agent-generated
    // files into the DB at RUN_FINISHED (matches non-interrupt branch).
    const persister = new AGUIEventPersister(
      effectiveTaskId,
      runId,
      wsRoot,
      execSessionCwd,
      validatedModelConfig?.agentType ?? 'claude',
      runProvenance(validatedModelConfig),
    );
    activeRunContexts.set(
      effectiveTaskId,
      activeRunContextFor(runId, persister),
    );

    const rawExecStream = runExecutionPhase(
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
    );
    // Wrap the stream in a session context so in-process MCP tools (media
    // generation, etc.) resolve the per-session output dir instead of
    // falling back to `${workDir}/output`. Without this wrapper, approved-
    // plan execution wrote generated images to the workspace root.
    const contextualExecStream = execSessionCwd
      ? withSessionContext(
          { workDir: execSessionCwd, sessionId: execSession.id },
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
    const execPromoter = new AttachmentPromotionService({
      taskId: effectiveTaskId,
      runId,
      sessionCwd: execSessionCwd,
    });
    startDetachedAGUIRun({
      mode: 'task',
      ownerKey: effectiveTaskId,
      runId,
      threadId,
      busKey,
      controller: execSession.abortController,
      persister,
      reattach: activeRunContextFor(runId, persister),
      events: withDesignLiveArtifactQuietClose(
        withAttachmentPromotionEvents(
          execEmitter.transform(withPlanExecutionSteps(agentStream)),
          execPromoter,
          runId,
        ),
        {
          enabled: liveArtifactQuietCloseEnabled,
          taskId: effectiveTaskId,
          runId,
          threadId,
          quietMs: liveArtifactQuietMs,
        },
      ),
      onTerminal: () => {
        if (
          activeRunControllers.get(effectiveTaskId) ===
          execSession.abortController
        ) {
          activeRunControllers.delete(effectiveTaskId);
        }
        if (activeRunBusKeys.get(effectiveTaskId) === busKey) {
          activeRunBusKeys.delete(effectiveTaskId);
        }
        if (activeRunContexts.get(effectiveTaskId)?.runId === runId) {
          activeRunContexts.delete(effectiveTaskId);
        }
      },
    }).catch((err) => {
      logger.error('AG-UI plan execution pipeline error', {
        error: err,
        threadId,
        runId,
      });
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
  // Resolve workspace root early — needed for task INSERT and STATE_SNAPSHOT context
  const workspaceRoot = effectiveWorkDir ?? getSetting('workDir') ?? undefined;

  try {
    const db = getDatabase();

    // Persist user messages so branching can reference them by message_id.
    // INSERT OR IGNORE avoids duplicates across follow-up runs (message_id has a unique index).
    const userMsgStmt = db.prepare(
      `INSERT OR IGNORE INTO messages (task_id, type, content, message_id, branch_id, run_id, created_at)
       VALUES (?, 'user', ?, ?, ?, ?, datetime('now'))`,
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
  const emitter = new AGUIEmitter(threadId, runId, {
    workspaceRoot,
    taskTitle,
  });

  const abortSignal = c.req.raw.signal;

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
    ? runAgent(prompt, {
        session,
        conversation: conversation.length > 0 ? conversation : undefined,
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
      })
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
  const contextualStream = sessionCwd
    ? withSessionContext(
        { workDir: sessionCwd, sessionId: session.id },
        rawStream,
      )
    : rawStream;

  // Wrap to sync the agent's actual session CWD into the task's work_dir
  const agentStream = withWorkDirSync(
    contextualStream,
    effectiveTaskId,
    session.abortController.signal,
  );

  // Launch detached pipeline — runs independently of the SSE connection.
  // Events are published to taskEventBus + persisted regardless of client state.
  // Late-joiners reconnecting via /ag-ui/subscribe/:taskId will receive all events.
  const busKey = `agui-${effectiveTaskId}-${runId}`;
  activeRunBusKeys.set(effectiveTaskId, busKey);
  const persister = new AGUIEventPersister(
    effectiveTaskId,
    runId,
    workspaceRoot,
    sessionCwd,
    validatedModelConfig?.agentType ?? 'claude',
    runProvenance(validatedModelConfig),
  );
  activeRunContexts.set(effectiveTaskId, activeRunContextFor(runId, persister));
  const attachmentPromoter = new AttachmentPromotionService({
    taskId: effectiveTaskId,
    runId,
    sessionCwd,
  });

  startDetachedAGUIRun({
    mode: 'task',
    ownerKey: effectiveTaskId,
    runId,
    threadId,
    busKey,
    controller: session.abortController,
    persister,
    reattach: activeRunContextFor(runId, persister),
    events: withDesignLiveArtifactQuietClose(
      withAttachmentPromotionEvents(
        emitter.transform(withPlanExecutionSteps(agentStream)),
        attachmentPromoter,
        runId,
      ),
      {
        enabled: liveArtifactQuietCloseEnabled,
        taskId: effectiveTaskId,
        runId,
        threadId,
        quietMs: liveArtifactQuietMs,
      },
    ),
    onTerminal: () => {
      if (
        activeRunControllers.get(effectiveTaskId) === session.abortController
      ) {
        activeRunControllers.delete(effectiveTaskId);
      }
      if (activeRunBusKeys.get(effectiveTaskId) === busKey) {
        activeRunBusKeys.delete(effectiveTaskId);
      }
      if (activeRunContexts.get(effectiveTaskId)?.runId === runId) {
        activeRunContexts.delete(effectiveTaskId);
      }
    },
  }).catch((err) => {
    logger.error('AG-UI detached pipeline error', {
      error: err,
      threadId,
      runId,
    });
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
  const activeBusKey = activeRunBusKeys.get(taskId);
  const activeRunContext =
    activeBusKey && taskEventBus.isTaskActive(activeBusKey)
      ? activeRunContexts.get(taskId)
      : undefined;
  const { files } = await restoreReattachFiles(taskId, activeRunContext);
  return c.json({
    messages: aguiMessages,
    files,
    isRunning: activeBusKey ? taskEventBus.isTaskActive(activeBusKey) : false,
  });
});

/**
 * AG-UI pending plan endpoint.
 * Returns the latest pending plan for a task (if any).
 * Used by the V2 frontend to show the plan approval card after planning completes.
 */
agui.get('/pending-plan/:taskId', (c) => {
  const rawTaskId = c.req.param('taskId');
  const parsed = taskIdParamSchema.safeParse(rawTaskId);
  if (!parsed.success) return c.json({ error: 'Invalid taskId' }, 400);
  const taskId = parsed.data;

  // Only return a pending plan if the task is actually awaiting approval.
  // Tasks marked 'stopped' are in the plan-approval state (set by AGUIEventPersister
  // when planEmitted=true). Completed/error tasks should not resurface old plans.
  const task = getTask(taskId);
  if (!task || task.status !== 'stopped') {
    return c.json({ plan: null });
  }

  const planRuns = getOrchestrationRunsByTaskId(taskId);
  const planRun = planRuns.find(
    (r) => r.run_type === 'plan' && r.status === 'pending',
  );
  if (!planRun) {
    return c.json({ plan: null });
  }

  try {
    const plan = JSON.parse(planRun.payload);
    return c.json({ plan });
  } catch {
    return c.json({ plan: null });
  }
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
  const taskSnapshot =
    mode.data === 'task' && hasGap
      ? {
          type: 'MESSAGES_SNAPSHOT',
          messages: dbMessagesToFullAGUI(getMessagesByTaskId(ownerKey)),
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
