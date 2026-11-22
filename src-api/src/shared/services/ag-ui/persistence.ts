/**
 * AG-UI Event Persister
 *
 * Maps AG-UI BaseEvent objects to DB message rows during streaming.
 * Accumulates deltas (text content, tool args) in memory and flushes
 * on boundary events (TEXT_MESSAGE_END, TOOL_CALL_END, etc.).
 *
 * Uses INSERT OR IGNORE keyed on message_id to handle duplicate writes
 * from reconnection scenarios.
 */

import { realpathSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';

import { EventType } from '@ag-ui/core';
import type { BaseEvent, RunFinishedEvent } from '@ag-ui/core';
import {
  MEDIA_DOWNLOAD_ACTIVITY,
  reconcileDownloadSnapshot,
} from '@neumar/video-ir';
import type Database from 'better-sqlite3';

import { classifyRunFailure } from '@/core/agent/error-retry';
import { adaptRunFailure, type RunMode } from '@/core/agent/runtime-state';

import { getDatabase } from '@/shared/db/index';
import {
  createAgentRun,
  createFile,
  finishAgentRun,
  getTask,
  updateAgentRunAttempt,
  updateAgentRunDelivery,
  updateTask,
  updateTaskHeartbeat,
} from '@/shared/db/operations';
import {
  createTraceArtifactReference,
  createTraceSafeManifest,
  traceManifestAttrs,
} from '@/shared/observability/manifests';
import { recordTraceEvent } from '@/shared/observability/trace';
import { pathHasIgnoredProjectDir } from '@/shared/services/design-mode/ignored-project-dirs';
import { generateDispatchSummary } from '@/shared/services/dispatch-summary';
import { createLogger } from '@/shared/utils/logger';

import {
  CustomEventName,
  SubagentFinishedPayloadSchema,
  SubagentStartedPayloadSchema,
} from './event-schema';
import {
  runUsageFromTerminalEvent,
  sumRunTokens,
  type RunUsageRecord,
} from './run-usage';
import {
  SUBAGENT_MESSAGE_TYPE,
  subagentMessageId,
  type SubagentRecord,
} from './subagent-record';

/**
 * Canonicalize a path so two different absolute references to the same
 * physical file (e.g. `/Volumes/4TB_WD/_Neumar/...` and
 * `/Users/example/.neumar/...` when one is a symlink to the other)
 * dedupe correctly through `createFile`'s `(task_id, path)` unique
 * check. Returns the input on any error so a missing/inaccessible path
 * still gets registered (better to have a row than to silently drop).
 */
function canonicalizePath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** File-writing tools whose args contain a file_path to extract. */
const FILE_WRITING_TOOLS = new Set([
  'Write',
  'Edit',
  'NotebookEdit',
  'MediaGenerateImage',
]);

/** Detectable file extensions for artifact extraction. */
const ARTIFACT_EXT_RE =
  /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|mp4|webm|mov|avi|mkv|mp3|wav|flac|ogg|aac|m4a|pdf|md|doc|docx|txt|pptx|xlsx|html|htm|json|csv|py|js|ts|tsx|jsx|go|rs|java|sh|sql|css)$/i;

const OUTPUT_PATH_SEGMENTS = new Set([
  'out',
  'output',
  'outputs',
  'dist',
  'build',
]);
const SOURCE_PATH_SEGMENTS = new Set(['attachments']);

const TOOL_OUTPUT_FILE_CUE_RE =
  /(?:^|[\s([{>])(?:output|file|image file|video file|audio file|saved|created|generated|wrote|written|exported|rendered)\s*(?:file|to|at|as)?\s*:?\s*$/i;

function pathHasSegment(filePath: string, segments: Set<string>): boolean {
  return filePath.split(/[\\/]+/).some((segment) => segments.has(segment));
}

function hasOutputCueBefore(text: string, pathIndex: number): boolean {
  const prefix = text.slice(Math.max(0, pathIndex - 120), pathIndex);
  return TOOL_OUTPUT_FILE_CUE_RE.test(prefix);
}

/** Determine file type from extension (mirrors frontend agent-files.ts). */
function getFileType(
  path: string,
):
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'presentation'
  | 'spreadsheet'
  | 'code'
  | 'website'
  | 'text' {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext))
    return 'image';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'flv'].includes(ext))
    return 'video';
  if (['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma'].includes(ext))
    return 'audio';
  if (['pdf', 'md', 'doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext))
    return 'document';
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return 'presentation';
  if (['xls', 'xlsx', 'numbers', 'ods'].includes(ext)) return 'spreadsheet';
  if (['html', 'htm'].includes(ext)) return 'website';
  if (
    [
      'js',
      'jsx',
      'ts',
      'tsx',
      'py',
      'go',
      'rs',
      'java',
      'c',
      'cpp',
      'cs',
      'rb',
      'php',
      'swift',
      'sh',
      'sql',
    ].includes(ext)
  )
    return 'code';
  return 'text';
}

/** Activity types the app renders; any other type is dropped, not stored. */
const SUPPORTED_ACTIVITY_TYPES = new Set([
  'plan',
  'status',
  MEDIA_DOWNLOAD_ACTIVITY,
]);

interface ActivityRow {
  activityType: string;
  content: Record<string, unknown>;
  subagentRunId?: string;
}

let activityStmtCache: {
  db: Database.Database;
  select: Database.Statement;
  update: Database.Statement;
} | null = null;

function activityStmts() {
  const db = getDatabase();
  if (!activityStmtCache || activityStmtCache.db !== db) {
    activityStmtCache = {
      db,
      select: db.prepare(
        "SELECT content, subtype, subagent_run_id FROM messages WHERE task_id = ? AND message_id = ? AND type = 'activity' LIMIT 1",
      ),
      update: db.prepare(
        "UPDATE messages SET content = ? WHERE task_id = ? AND message_id = ? AND type = 'activity'",
      ),
    };
  }
  return activityStmtCache;
}

/**
 * The stored activity for an id, read from the database rather than a per-run
 * cache: a delta may patch an activity that an earlier run created.
 */
function readActivityRow(
  taskId: string,
  messageId: string,
): ActivityRow | undefined {
  const row = activityStmts().select.get(taskId, messageId) as
    | {
        content: string | null;
        subtype: string | null;
        subagent_run_id: string | null;
      }
    | undefined;
  if (!row?.subtype || !SUPPORTED_ACTIVITY_TYPES.has(row.subtype)) {
    return undefined;
  }
  try {
    const content: unknown = JSON.parse(row.content ?? '');
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      return undefined;
    }
    return {
      activityType: row.subtype,
      content: content as Record<string, unknown>,
      ...(row.subagent_run_id ? { subagentRunId: row.subagent_run_id } : {}),
    };
  } catch {
    return undefined;
  }
}

function updateActivityContent(
  taskId: string,
  messageId: string,
  content: Record<string, unknown>,
): void {
  activityStmts().update.run(JSON.stringify(content), taskId, messageId);
}

/** RFC 6902 `test` equality: deep, and insensitive to object key order. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => jsonEqual(item, b[i]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        jsonEqual(left[key], right[key]),
    )
  );
}

/** A canonical array index: no sign, no leading zero, no exponent, not empty. */
const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

/**
 * Apply a validated RFC 6902 operation list to an activity JSON object.
 * Kept server-side so the journal persists the exact same value the client
 * projects; every mutation targets a private clone and fails atomically.
 */
function patchActivityContent(
  source: Record<string, unknown>,
  rawPatch: unknown,
): Record<string, unknown> | undefined {
  if (!Array.isArray(rawPatch)) return undefined;
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const pointer = (path: unknown): string[] | undefined => {
    if (typeof path !== 'string') return undefined;
    if (path === '') return [];
    if (!path.startsWith('/')) return undefined;
    const parts = path.slice(1).split('/');
    if (parts.some((part) => /~(?![01])/.test(part))) return undefined;
    return parts.map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  };
  const locate = (root: unknown, parts: string[]) => {
    let value = root;
    for (const part of parts) {
      if (Array.isArray(value)) {
        if (!ARRAY_INDEX.test(part) || Number(part) >= value.length)
          return undefined;
        value = value[Number(part)];
      } else if (
        value &&
        typeof value === 'object' &&
        Object.prototype.hasOwnProperty.call(value, part)
      ) {
        value = (value as Record<string, unknown>)[part];
      } else return undefined;
    }
    return value;
  };
  const write = (
    root: unknown,
    parts: string[],
    op: string,
    value?: unknown,
  ): unknown => {
    if (!parts.length) return op === 'remove' ? undefined : clone(value);
    const parent = locate(root, parts.slice(0, -1));
    const key = parts.at(-1)!;
    if (!parent || typeof parent !== 'object')
      throw new Error('missing parent');
    if (
      parts.some((part) =>
        ['__proto__', 'constructor', 'prototype'].includes(part),
      )
    )
      throw new Error('unsafe pointer');
    if (Array.isArray(parent)) {
      const index =
        key === '-' && op === 'add'
          ? parent.length
          : ARRAY_INDEX.test(key)
            ? Number(key)
            : -1;
      if (
        index < 0 ||
        index > parent.length ||
        (op !== 'add' && index >= parent.length)
      )
        throw new Error('invalid array index');
      if (op === 'add') parent.splice(index, 0, clone(value));
      else if (op === 'remove') parent.splice(index, 1);
      else parent[index] = clone(value);
    } else {
      const record = parent as Record<string, unknown>;
      if (op !== 'add' && !Object.prototype.hasOwnProperty.call(record, key))
        throw new Error('missing key');
      if (op === 'remove') delete record[key];
      else record[key] = clone(value);
    }
    return root;
  };
  let doc: unknown = clone(source);
  try {
    for (const raw of rawPatch) {
      if (!raw || typeof raw !== 'object') return undefined;
      const op = raw as {
        op?: unknown;
        path?: unknown;
        from?: unknown;
        value?: unknown;
      };
      const path = pointer(op.path);
      if (!path) return undefined;
      switch (op.op) {
        case 'add':
        case 'replace':
          if (!('value' in op)) return undefined;
          doc = write(doc, path, op.op, op.value);
          break;
        case 'remove':
          doc = write(doc, path, 'remove');
          break;
        case 'copy':
        case 'move': {
          const from = pointer(op.from);
          if (!from) return undefined;
          const value = locate(doc, from);
          if (value === undefined) return undefined;
          if (op.op === 'move') {
            if (
              path.length > from.length &&
              from.every((part, index) => path[index] === part)
            )
              return undefined;
            doc = write(doc, from, 'remove');
          }
          doc = write(doc, path, 'add', value);
          break;
        }
        case 'test':
          if (!('value' in op) || !jsonEqual(locate(doc, path), op.value))
            return undefined;
          break;
        default:
          return undefined;
      }
    }
    return doc && typeof doc === 'object' && !Array.isArray(doc)
      ? (doc as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

const logger = createLogger('AGUIEventPersister');

// Module-level prepared-statement cache keyed on DB instance. Recompiles on
// reconnect (operations.ts swaps connections when a pragma probe fails),
// otherwise reuses across runs/persisters — insertMessage fires hundreds of
// times per task and re-preparing the SQL each time was burning real CPU.
let insertMessageStmtCache: {
  db: Database.Database;
  stmt: Database.Statement;
} | null = null;

function getInsertMessageStmt(): Database.Statement {
  const db = getDatabase();
  if (!insertMessageStmtCache || insertMessageStmtCache.db !== db) {
    insertMessageStmtCache = {
      db,
      stmt: db.prepare(`
        INSERT OR IGNORE INTO messages (
          task_id, type, content, tool_name, tool_input, tool_output,
          tool_use_id, subtype, error_message, message_id, run_id, branch_id,
          subagent_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
    };
  }
  return insertMessageStmtCache.stmt;
}

let updateMessageContentStmtCache: {
  db: Database.Database;
  stmt: Database.Statement;
} | null = null;

function getUpdateMessageContentStmt(): Database.Statement {
  const db = getDatabase();
  if (
    !updateMessageContentStmtCache ||
    updateMessageContentStmtCache.db !== db
  ) {
    updateMessageContentStmtCache = {
      db,
      stmt: db.prepare(
        'UPDATE messages SET content = ? WHERE task_id = ? AND message_id = ?',
      ),
    };
  }
  return updateMessageContentStmtCache.stmt;
}

/** The AG-UI `subagentRunId` an event carries, if a sub-agent produced it. */
function eventOwner(event: BaseEvent): string | undefined {
  const owner = (event as BaseEvent & { subagentRunId?: unknown })
    .subagentRunId;
  return typeof owner === 'string' && owner ? owner : undefined;
}

/**
 * Stateful persister — instantiate once per AG-UI run.
 * Accumulates streaming deltas and flushes complete messages to DB.
 */
export class AGUIEventPersister {
  private pendingText = '';
  private pendingTextMessageId: string | null = null;
  private pendingReasoningText = '';
  private pendingReasoningMessageId: string | null = null;
  /** Sub-agent invocation that owns the reasoning block in progress. */
  private pendingReasoningOwner: string | undefined;
  /** Sub-agent invocation that owns the text block in progress. */
  private pendingTextOwner: string | undefined;
  /** Sub-agent invocation that owns each open tool call, by tool call id. */
  private pendingToolOwners: Record<string, string> = {};
  /** Live record per invocation, rewritten onto its row when it ends. */
  private subagentRecords = new Map<string, SubagentRecord>();
  private pendingToolArgs: Record<string, string> = {};
  private pendingToolNames: Record<string, string> = {};
  private pendingToolStartedAt: Record<string, number> = {};
  /** True when a plan CUSTOM event was seen — prevents marking task as 'completed' on RUN_FINISHED. */
  private planEmitted = false;
  /** Timestamp (ms) when the run started — used to compute duration on RUN_FINISHED. */
  private readonly startedAtMs: number = Date.now();
  private rootTraceEventId: string | null = null;
  /** Accumulates assistant text for dispatch summary generation. */
  private assistantTextAccum = '';
  /** Tracks unique tool names used during the run for dispatch summary. */
  private toolsUsedSet = new Set<string>();
  private rootRunPersisted = false;
  private terminalProcess: 'succeeded' | 'failed' | 'cancelled' | null = null;
  private artifactDetected = false;
  private recordedArtifactIds = new Set<string>();
  /**
   * Coalesce flag for `scanSessionOutputDir`. Bash often fires in bursts
   * (a 50-step build script), but each call would otherwise trigger one
   * readdir + N stat() per invocation. With this gate we collapse rapid
   * bursts into a single trailing scan ~500 ms after the last Bash call.
   */
  private incrementalScanScheduled = false;
  private static readonly INCREMENTAL_SCAN_DELAY_MS = 500;

  constructor(
    private readonly taskId: string,
    private readonly runId?: string,
    private readonly workspaceRoot?: string,
    /** Agent subprocess cwd; `{sessionCwd}/output` is scanned on run end. */
    private readonly sessionCwd?: string,
    /** Agent provider name (claude, codex, http-agent, …) for agent_runs. */
    private readonly provider: string = 'claude',
    private readonly provenance: {
      model?: string;
      runtimeVersion?: string;
      attempt?: number;
      sessionHandleKind?: string;
      invalidationReason?: string;
    } = {},
    private readonly mode: RunMode = 'task',
    /** Conversation branch this run's output rows belong to. */
    private readonly branchId: string = 'main',
  ) {}

  get runStartedAtMs(): number {
    return this.startedAtMs;
  }

  async scanOutputArtifacts(): Promise<number> {
    return this.scanSessionOutputDir();
  }

  recordReattachedArtifact(filePath: string): void {
    this.recordArtifact(filePath);
  }

  private ensureRootRunRow(): void {
    if (this.rootRunPersisted || !this.runId) return;
    try {
      createAgentRun({
        id: this.runId,
        taskId: this.taskId,
        provider: this.provider,
        model: this.provenance.model,
        runtimeVersion: this.provenance.runtimeVersion,
        attempt: this.provenance.attempt,
        sessionHandleKind: this.provenance.sessionHandleKind,
        invalidationReason: this.provenance.invalidationReason,
      });
      this.rootRunPersisted = true;
    } catch (err) {
      logger.warn(
        'createAgentRun failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private finalizeRootRun(
    status: 'completed' | 'failed' | 'cancelled',
    error?: string,
    verdict?: {
      completeness: 'complete' | 'unfinished' | 'unknown';
      delivery: 'not_expected' | 'pending' | 'delivered' | 'blocked' | 'failed';
      retry: 'not_safe' | 'safe_once' | 'user_action';
      failureCause?: string;
    },
    usage?: RunUsageRecord,
  ): void {
    if (!this.rootRunPersisted || !this.runId) return;
    try {
      finishAgentRun({
        id: this.runId,
        status,
        // Only what the terminal event reported: a run that reported nothing
        // keeps NULL usage rather than a fabricated zero.
        costUsd: usage?.costUsd,
        tokensIn: sumRunTokens(usage?.usage, (entry) => entry.inputTokens),
        tokensOut: sumRunTokens(usage?.usage, (entry) => entry.outputTokens),
        usageJson: usage ? JSON.stringify(usage) : undefined,
        error: error ?? null,
        completeness: verdict?.completeness,
        delivery: verdict?.delivery,
        retry: verdict?.retry,
        failureCause: verdict?.failureCause,
      });
    } catch (err) {
      logger.warn(
        'finishAgentRun failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Process a single AG-UI event. Call this for every event in the stream.
   * Internally accumulates deltas and flushes on boundary events.
   */
  handleEvent(event: BaseEvent): void {
    try {
      switch (event.type) {
        case EventType.RUN_STARTED: {
          if (this.mode === 'task') {
            updateTask(this.taskId, { status: 'running' });
            updateTaskHeartbeat(this.taskId);
          }
          this.ensureRootRunRow();
          this.rootTraceEventId = this.runId ?? crypto.randomUUID();
          recordTraceEvent({
            id: this.rootTraceEventId,
            taskId: this.taskId,
            sessionId: this.runId ?? null,
            kind: 'model_call',
            agent: this.provider,
            provider: this.provider,
            status: 'running',
            startedAt: this.startedAtMs,
            attrs: {
              aguiType: event.type,
              threadId: (event as BaseEvent & { threadId?: string }).threadId,
              runId: this.runId,
            },
          });
          break;
        }

        case EventType.ACTIVITY_SNAPSHOT: {
          if (this.mode !== 'task') break;
          const e = event as BaseEvent & {
            messageId?: unknown;
            activityType?: unknown;
            content?: unknown;
            replace?: boolean;
          };
          const id = typeof e.messageId === 'string' ? e.messageId : '';
          const activityType = e.activityType;
          if (
            !id ||
            typeof activityType !== 'string' ||
            !SUPPORTED_ACTIVITY_TYPES.has(activityType) ||
            !e.content ||
            typeof e.content !== 'object' ||
            Array.isArray(e.content)
          )
            break;
          const existing = readActivityRow(this.taskId, id);
          const content =
            activityType === MEDIA_DOWNLOAD_ACTIVITY
              ? reconcileDownloadSnapshot(
                  this.taskId,
                  id,
                  existing?.content,
                  e.content,
                )
              : (e.content as Record<string, unknown>);
          if (!content) break;
          if (existing) {
            // `replace: false` leaves an existing activity alone; it never
            // merges. A type change is not a replacement of the same widget.
            if (e.replace === false || existing.activityType !== activityType) {
              break;
            }
            updateActivityContent(this.taskId, id, content);
            break;
          }
          this.insertMessage({
            type: 'activity',
            content: JSON.stringify(content),
            subtype: activityType,
            messageId: id,
            subagentRunId: eventOwner(event),
          });
          break;
        }

        case EventType.ACTIVITY_DELTA: {
          if (this.mode !== 'task') break;
          const e = event as BaseEvent & {
            messageId?: unknown;
            activityType?: unknown;
            patch?: unknown;
          };
          const id = typeof e.messageId === 'string' ? e.messageId : '';
          if (!id) break;
          // A delta for an activity that does not exist is skipped, per the
          // AG-UI spec; a failed patch leaves the stored content untouched.
          const existing = readActivityRow(this.taskId, id);
          if (!existing || existing.activityType !== e.activityType) break;
          const patched = patchActivityContent(existing.content, e.patch);
          const content =
            existing.activityType === MEDIA_DOWNLOAD_ACTIVITY
              ? reconcileDownloadSnapshot(
                  this.taskId,
                  id,
                  existing.content,
                  patched,
                )
              : patched;
          if (!content) break;
          updateActivityContent(this.taskId, id, content);
          break;
        }

        case EventType.MESSAGES_SNAPSHOT: {
          // A server reconnect projects the DB's current activity rows through
          // dbMessagesToFullAGUI. They are already durable, so no rewrite here.
          break;
        }

        case EventType.TEXT_MESSAGE_START: {
          const e = event as BaseEvent & { messageId: string };
          this.pendingTextMessageId = e.messageId;
          this.pendingTextOwner = eventOwner(event);
          this.pendingText = '';
          break;
        }

        case EventType.TEXT_MESSAGE_CONTENT: {
          const e = event as BaseEvent & { delta: string };
          this.pendingText += e.delta ?? '';
          break;
        }

        case EventType.TEXT_MESSAGE_END: {
          if (this.pendingText && this.pendingTextMessageId) {
            this.insertMessage({
              type: 'text',
              content: this.pendingText,
              messageId: this.pendingTextMessageId,
              subagentRunId: this.pendingTextOwner,
            });
            // The dispatch summary describes the parent run, so a child's
            // text stays out of it. Cap it to bound memory on long runs.
            if (
              !this.pendingTextOwner &&
              this.assistantTextAccum.length < 8000
            ) {
              this.assistantTextAccum += this.pendingText + '\n';
            }
            this.extractFilesFromOutput(this.pendingText);
          }
          this.pendingText = '';
          this.pendingTextMessageId = null;
          this.pendingTextOwner = undefined;
          break;
        }

        case EventType.REASONING_MESSAGE_START: {
          const e = event as BaseEvent & { messageId: string };
          this.pendingReasoningMessageId = e.messageId;
          this.pendingReasoningText = '';
          this.pendingReasoningOwner = eventOwner(event);
          break;
        }

        case EventType.REASONING_MESSAGE_CONTENT: {
          const e = event as BaseEvent & { delta: string };
          this.pendingReasoningText += e.delta ?? '';
          break;
        }

        case EventType.REASONING_MESSAGE_END: {
          if (this.pendingReasoningText && this.pendingReasoningMessageId) {
            this.insertMessage({
              type: 'text',
              content: this.pendingReasoningText,
              subtype: 'thinking',
              messageId: this.pendingReasoningMessageId,
              subagentRunId: this.pendingReasoningOwner,
            });
          }
          this.pendingReasoningText = '';
          this.pendingReasoningMessageId = null;
          this.pendingReasoningOwner = undefined;
          break;
        }

        case EventType.TOOL_CALL_START: {
          const e = event as BaseEvent & {
            toolCallId: string;
            toolCallName: string;
          };
          this.pendingToolArgs[e.toolCallId] = '';
          this.pendingToolNames[e.toolCallId] = e.toolCallName ?? 'unknown';
          this.pendingToolStartedAt[e.toolCallId] = Date.now();
          const toolOwner = eventOwner(event);
          if (toolOwner) this.pendingToolOwners[e.toolCallId] = toolOwner;
          break;
        }

        case EventType.TOOL_CALL_ARGS: {
          const e = event as BaseEvent & { toolCallId: string; delta: string };
          this.pendingToolArgs[e.toolCallId] =
            (this.pendingToolArgs[e.toolCallId] ?? '') + (e.delta ?? '');
          break;
        }

        case EventType.TOOL_CALL_END: {
          const e = event as BaseEvent & { toolCallId: string };
          const toolName = this.pendingToolNames[e.toolCallId] ?? 'unknown';
          const toolArgs = this.pendingToolArgs[e.toolCallId] ?? '';
          this.toolsUsedSet.add(toolName);
          this.insertMessage({
            type: 'tool_use',
            toolName,
            toolInput: toolArgs,
            toolUseId: e.toolCallId,
            messageId: `${this.taskId}_${e.toolCallId}`,
            subagentRunId: this.pendingToolOwners[e.toolCallId],
          });
          recordTraceEvent({
            id: `${this.taskId}_${this.runId ?? 'run'}_${e.toolCallId}`,
            taskId: this.taskId,
            sessionId: this.runId ?? null,
            messageId: `${this.taskId}_${e.toolCallId}`,
            parentEventId: this.rootTraceEventId,
            kind: 'tool_call',
            agent: this.provider,
            provider: this.provider,
            tool: toolName,
            status: 'running',
            startedAt: this.pendingToolStartedAt[e.toolCallId] ?? Date.now(),
            attrs: { input: toolArgs },
          });

          // Extract file artifacts from file-writing tools
          this.extractFileFromToolCall(toolName, toolArgs);

          // Bash can write files via `mmdc`, `ffmpeg`, redirects, etc.
          // — none of those flow through `Write`/`Edit`. Trigger a
          // debounced output-dir scan so those files surface in the
          // sidebar in real time instead of only at run end.
          if (this.mode === 'task' && toolName === 'Bash') {
            this.scheduleIncrementalScan();
          }

          delete this.pendingToolArgs[e.toolCallId];
          break;
        }

        case EventType.TOOL_CALL_RESULT: {
          const e = event as BaseEvent & {
            toolCallId: string;
            content: string;
            messageId?: string;
            isError?: boolean;
          };
          const toolTraceId = `${this.taskId}_${this.runId ?? 'run'}_${e.toolCallId}`;
          const startedAt =
            this.pendingToolStartedAt[e.toolCallId] ?? Date.now();
          this.insertMessage({
            type: 'tool_result',
            toolOutput: e.content,
            toolUseId: e.toolCallId,
            messageId: e.messageId ?? `${this.taskId}_result_${e.toolCallId}`,
            subagentRunId:
              eventOwner(event) ?? this.pendingToolOwners[e.toolCallId],
          });
          delete this.pendingToolOwners[e.toolCallId];
          // Phase 7: cap trace event output to a fixed budget. The defended
          // content already replaces BLOCK results with a placeholder before
          // reaching this layer, so this cap is a size hardening guard, not
          // a content redaction. Keeping under 8 KiB keeps the SQLite trace
          // table from ballooning when an MCP tool returns megabyte payloads.
          const TRACE_OUTPUT_MAX = 8 * 1024;
          const cappedOutput =
            typeof e.content === 'string' && e.content.length > TRACE_OUTPUT_MAX
              ? e.content.slice(0, TRACE_OUTPUT_MAX) +
                `\n[trace truncated: original was ${e.content.length} bytes]`
              : e.content;
          recordTraceEvent({
            id: toolTraceId,
            taskId: this.taskId,
            sessionId: this.runId ?? null,
            messageId: e.messageId ?? `${this.taskId}_result_${e.toolCallId}`,
            parentEventId: this.rootTraceEventId,
            kind: 'tool_call',
            agent: this.provider,
            provider: this.provider,
            tool: this.pendingToolNames[e.toolCallId] ?? 'unknown',
            status: e.isError ? 'error' : 'ok',
            startedAt,
            endedAt: Date.now(),
            attrs: { output: cappedOutput },
          });
          delete this.pendingToolStartedAt[e.toolCallId];
          delete this.pendingToolNames[e.toolCallId];

          // MCP tool results may be content-block arrays; flatten for regex match.
          const toolOutputStr =
            typeof e.content === 'string'
              ? e.content
              : JSON.stringify(e.content);
          this.extractFilesFromOutput(toolOutputStr);
          break;
        }

        case EventType.CUSTOM: {
          const e = event as BaseEvent & { name: string; value: unknown };
          if (e.name === 'plan') {
            this.planEmitted = true;
            this.insertMessage({
              type: 'plan',
              content: JSON.stringify(e.value),
              messageId: `${this.taskId}_plan_${(event as BaseEvent & { seq?: number }).seq ?? crypto.randomUUID()}`,
            });
          } else if (e.name === 'auto_retry') {
            this.ensureRootRunRow();
            const attempt = (e.value as { attempt?: unknown })?.attempt;
            if (typeof attempt === 'number' && this.runId) {
              updateAgentRunAttempt(this.runId, attempt);
            }
          } else if (e.name === 'continuation_attempt') {
            this.ensureRootRunRow();
            const value = e.value as {
              attempt?: unknown;
              kind?: unknown;
            };
            recordTraceEvent({
              taskId: this.taskId,
              sessionId: this.runId,
              kind: 'model_call',
              agent: this.provider,
              provider: this.provider,
              status: 'ok',
              attrs: {
                continuationAttempt:
                  typeof value.attempt === 'number' ? value.attempt : 1,
                continuationKind:
                  typeof value.kind === 'string'
                    ? value.kind
                    : 'post_tool_completion',
              },
            });
          } else if (e.name === CustomEventName.SubagentStarted) {
            // Persist child run row keyed on the spawn event's runId so
            // SUBAGENT_FINISHED can match by id without ambiguity.
            const parsed = SubagentStartedPayloadSchema.safeParse(e.value);
            if (parsed.success) {
              try {
                createAgentRun({
                  id: parsed.data.runId,
                  taskId: parsed.data.childTaskId,
                  parentRunId: parsed.data.parentRunId,
                  provider: parsed.data.agentProvider,
                });
              } catch (err) {
                logger.warn(
                  'createAgentRun (subagent) failed:',
                  err instanceof Error ? err.message : String(err),
                );
              }
            }
          } else if (e.name === CustomEventName.SubagentFinished) {
            const parsed = SubagentFinishedPayloadSchema.safeParse(e.value);
            if (parsed.success) {
              try {
                finishAgentRun({
                  id: parsed.data.runId,
                  status: parsed.data.status,
                  costUsd: parsed.data.costUsd,
                  tokensIn: parsed.data.tokensIn,
                  tokensOut: parsed.data.tokensOut,
                });
              } catch (err) {
                logger.warn(
                  'finishAgentRun (subagent) failed:',
                  err instanceof Error ? err.message : String(err),
                );
              }
            }
          }
          break;
        }

        case EventType.SUBAGENT_STARTED: {
          const e = event as BaseEvent & {
            subagentRunId: string;
            name: string;
            description?: string;
            parentSubagentRunId?: string;
            parentToolCallId?: string;
          };
          const record: SubagentRecord = {
            name: e.name,
            status: 'running',
            startedAt: Date.now(),
            ...(e.description === undefined
              ? {}
              : { description: e.description }),
            ...(e.parentSubagentRunId
              ? { parentSubagentRunId: e.parentSubagentRunId }
              : {}),
            ...(e.parentToolCallId
              ? { parentToolCallId: e.parentToolCallId }
              : {}),
          };
          this.subagentRecords.set(e.subagentRunId, record);
          this.insertMessage({
            type: SUBAGENT_MESSAGE_TYPE,
            content: JSON.stringify(record),
            messageId: subagentMessageId(
              this.taskId,
              this.runId,
              e.subagentRunId,
            ),
            subagentRunId: e.subagentRunId,
          });
          break;
        }

        case EventType.SUBAGENT_FINISHED: {
          const e = event as BaseEvent & {
            subagentRunId: string;
            result?: string;
            outcome?: { type?: string; interruptIds?: string[] };
          };
          // A suspended segment ends awaiting a decision, not as success.
          this.endSubagent(
            e.subagentRunId,
            e.outcome?.type === 'suspended'
              ? {
                  status: 'suspended',
                  ...(e.outcome.interruptIds?.length
                    ? { interruptIds: e.outcome.interruptIds }
                    : {}),
                }
              : {
                  status: 'completed',
                  ...(e.result === undefined ? {} : { result: e.result }),
                },
          );
          break;
        }

        case EventType.SUBAGENT_ERROR: {
          const e = event as BaseEvent & {
            subagentRunId: string;
            message: string;
            code?: string;
          };
          this.endSubagent(e.subagentRunId, {
            status: 'error',
            error: {
              message: e.message,
              ...(e.code ? { code: e.code } : {}),
            },
          });
          break;
        }

        case EventType.RUN_ERROR: {
          this.closeOpenSubagents();
          const runUsage = runUsageFromTerminalEvent(event);
          if (this.terminalProcess) {
            logger.warn('Ignoring late RUN_ERROR after terminal verdict', {
              runId: this.runId,
              terminalProcess: this.terminalProcess,
            });
            break;
          }
          const e = event as BaseEvent & { message: string; code?: string };
          const isCancelled = this.isUserAbortError(e.message);
          const failure = classifyRunFailure({
            message: e.message,
            code: e.code,
          });
          const adaptedFailure = adaptRunFailure(
            this.mode,
            failure.cause,
            failure.retryDisposition === 'safe_auto_retry'
              ? 'safe_once'
              : failure.retryDisposition === 'hitl_required'
                ? 'user_action'
                : 'not_safe',
          );
          // Flush any open text blocks before recording the error
          this.flushPending();
          this.ensureRootRunRow();
          this.insertMessage({
            type: 'error',
            errorMessage: e.message,
            subtype: e.code ?? undefined,
            messageId: `${this.taskId}_error_${(event as BaseEvent & { seq?: number }).seq ?? crypto.randomUUID()}`,
          });
          // Update task status + duration
          if (this.mode === 'task') {
            try {
              const duration = Date.now() - this.startedAtMs;
              updateTask(this.taskId, {
                status: isCancelled ? 'stopped' : 'error',
                duration,
              });
            } catch {
              // Best-effort
            }
          }
          this.terminalProcess = isCancelled ? 'cancelled' : 'failed';
          this.finalizeRootRun(
            isCancelled ? 'cancelled' : 'failed',
            e.message,
            {
              completeness: adaptedFailure.verdict.completeness,
              delivery: this.artifactDetected
                ? 'delivered'
                : adaptedFailure.verdict.delivery,
              retry: adaptedFailure.verdict.retry,
              failureCause: adaptedFailure.verdict.failureCause,
            },
            runUsage,
          );
          recordTraceEvent({
            id:
              this.rootTraceEventId ??
              `${this.taskId}_${this.runId ?? 'run'}_model`,
            taskId: this.taskId,
            sessionId: this.runId ?? null,
            kind: 'model_call',
            agent: this.provider,
            provider: this.provider,
            status: isCancelled ? 'cancelled' : 'error',
            startedAt: this.startedAtMs,
            endedAt: Date.now(),
            inputTokens:
              sumRunTokens(runUsage?.usage, (entry) => entry.inputTokens) ??
              null,
            outputTokens:
              sumRunTokens(runUsage?.usage, (entry) => entry.outputTokens) ??
              null,
            costUsd: runUsage?.costUsd ?? null,
            attrs: {
              failureCause: failure.cause,
              retryDisposition: failure.retryDisposition,
              recoveryAction: failure.recoveryAction.type,
            },
            error: { message: e.message, code: e.code, failure },
          });
          if (this.mode === 'task') {
            void this.scanSessionOutputDir();
            // Produce a closing summary so the chat isn't silent on failure.
            this.generateAndStoreSummary('run_error_summary', e.message);
          }
          break;
        }

        case EventType.RUN_FINISHED: {
          const { outcome } = event as RunFinishedEvent;
          this.closeOpenSubagents(
            outcome?.type === 'interrupt' ? 'suspended' : 'error',
            outcome?.type === 'interrupt'
              ? outcome.interrupts?.map((interrupt) => interrupt.id)
              : undefined,
          );
          const runUsage = runUsageFromTerminalEvent(event);
          if (this.terminalProcess) break;
          this.flushPending();
          const duration = Date.now() - this.startedAtMs;
          const cancelled = outcome?.type === 'cancelled';
          // A run that stops for a decision completed its phase but left the
          // declared work unfinished; it is neither a failure nor success.
          const awaitingDecision =
            this.planEmitted || outcome?.type === 'interrupt';
          if (this.mode === 'task' && (awaitingDecision || cancelled)) {
            try {
              updateTask(this.taskId, { status: 'stopped', duration });
            } catch {
              // Best-effort
            }
          } else if (this.mode === 'task') {
            this.insertMessage({
              type: 'result',
              subtype: 'success',
              messageId: `${this.taskId}_result_${(event as BaseEvent & { seq?: number }).seq ?? crypto.randomUUID()}`,
            });
            try {
              updateTask(this.taskId, { status: 'completed', duration });
            } catch {
              // Best-effort
            }
            this.generateAndStoreSummary('dispatch_summary');
          }
          this.terminalProcess = cancelled ? 'cancelled' : 'succeeded';
          this.finalizeRootRun(
            cancelled ? 'cancelled' : 'completed',
            cancelled
              ? 'Run stopped by user'
              : awaitingDecision
                ? 'Run ended with unfinished declared work'
                : undefined,
            {
              completeness:
                cancelled || awaitingDecision ? 'unfinished' : 'complete',
              delivery: this.artifactDetected ? 'delivered' : 'not_expected',
              retry: cancelled
                ? 'not_safe'
                : awaitingDecision
                  ? 'user_action'
                  : 'not_safe',
              ...(cancelled
                ? { failureCause: 'cancelled' }
                : awaitingDecision
                  ? { failureCause: 'awaiting_decision' }
                  : {}),
            },
            runUsage,
          );
          recordTraceEvent({
            id:
              this.rootTraceEventId ??
              `${this.taskId}_${this.runId ?? 'run'}_model`,
            taskId: this.taskId,
            sessionId: this.runId ?? null,
            kind: 'model_call',
            agent: this.provider,
            provider: this.provider,
            status: cancelled ? 'cancelled' : 'ok',
            startedAt: this.startedAtMs,
            endedAt: Date.now(),
            inputTokens:
              sumRunTokens(runUsage?.usage, (entry) => entry.inputTokens) ??
              null,
            outputTokens:
              sumRunTokens(runUsage?.usage, (entry) => entry.outputTokens) ??
              null,
            costUsd: runUsage?.costUsd ?? null,
            attrs: {
              planEmitted: this.planEmitted,
              outcome: outcome?.type ?? 'success',
              completeness:
                cancelled || awaitingDecision ? 'unfinished' : 'complete',
            },
          });
          if (this.mode === 'task') void this.scanSessionOutputDir();
          break;
        }

        case EventType.STATE_SNAPSHOT: {
          // First STATE_SNAPSHOT after RUN_STARTED is our trigger to insert
          // the root agent_runs row — the emitter doesn't expose RUN_STARTED
          // in the persister's switch, but a snapshot always follows.
          this.ensureRootRunRow();

          // Update task row with latest cost/usage from STATE_SNAPSHOT
          const snapshot = (
            event as BaseEvent & { snapshot?: Record<string, unknown> }
          ).snapshot;
          const usageData = snapshot?.usage as
            | { inputTokens?: number; outputTokens?: number; cost?: number }
            | undefined;
          // The run row takes its usage from the terminal event, not from here:
          // a snapshot is a live projection. Only the task-level cost, which
          // the producer reports as a session total, still comes from it.
          if (usageData?.cost != null && this.mode === 'task') {
            try {
              // cost from STATE_SNAPSHOT is already billing-aware (zeroed by effectiveCost)
              updateTask(this.taskId, { cost: usageData.cost });
            } catch {
              // Best-effort
            }
          }
          break;
        }

        default:
          break;
      }
    } catch (err) {
      logger.error('Failed to persist AG-UI event', {
        eventType: event.type,
        taskId: this.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Flush any accumulated but unflushed text/reasoning. */
  private flushPending(): void {
    if (this.pendingText && this.pendingTextMessageId) {
      this.insertMessage({
        type: 'text',
        content: this.pendingText,
        messageId: this.pendingTextMessageId,
        subagentRunId: this.pendingTextOwner,
      });
      this.pendingText = '';
      this.pendingTextMessageId = null;
      this.pendingTextOwner = undefined;
    }
    if (this.pendingReasoningText && this.pendingReasoningMessageId) {
      this.insertMessage({
        type: 'text',
        content: this.pendingReasoningText,
        subtype: 'thinking',
        messageId: this.pendingReasoningMessageId,
        subagentRunId: this.pendingReasoningOwner,
      });
      this.pendingReasoningText = '';
      this.pendingReasoningMessageId = null;
      this.pendingReasoningOwner = undefined;
    }
  }

  /**
   * Insert a message row using INSERT OR IGNORE to handle duplicates
   * (message_id has a unique index).
   */
  private insertMessage(params: {
    type: string;
    content?: string;
    toolName?: string;
    toolInput?: string;
    toolOutput?: string;
    toolUseId?: string;
    subtype?: string;
    errorMessage?: string;
    messageId?: string;
    /** AG-UI `subagentRunId` of the invocation that produced the row. */
    subagentRunId?: string;
  }): void {
    if (this.mode !== 'task') return;
    try {
      getInsertMessageStmt().run(
        this.taskId,
        params.type,
        params.content ?? null,
        params.toolName ?? null,
        params.toolInput ?? null,
        params.toolOutput ?? null,
        params.toolUseId ?? null,
        params.subtype ?? null,
        params.errorMessage ?? null,
        params.messageId ?? null,
        this.runId ?? null,
        this.branchId,
        params.subagentRunId ?? null,
      );
    } catch (err) {
      // Best-effort — don't crash the stream for a persistence failure
      logger.error('INSERT OR IGNORE failed', {
        taskId: this.taskId,
        messageId: params.messageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * The emitter closes every child before a run ends. This covers a run that
   * ends without it, such as a synthetic RUN_ERROR from the transport, so a
   * finished run never leaves a card that reads as still running. A child left
   * open when the run paused for a decision is suspended, not failed.
   */
  private closeOpenSubagents(
    status: 'error' | 'suspended' = 'error',
    interruptIds?: string[],
  ): void {
    for (const [subagentRunId, record] of this.subagentRecords) {
      if (record.status !== 'running') continue;
      this.endSubagent(
        subagentRunId,
        status === 'suspended'
          ? {
              status: 'suspended',
              ...(interruptIds?.length ? { interruptIds } : {}),
            }
          : {
              status: 'error',
              error: {
                message: 'Run ended before the sub-agent finished',
                code: 'run_ended',
              },
            },
      );
    }
  }

  /** Rewrites a sub-agent's row with its terminal status. */
  private endSubagent(
    subagentRunId: string,
    outcome: Pick<
      SubagentRecord,
      'status' | 'result' | 'error' | 'interruptIds'
    >,
  ): void {
    if (this.mode !== 'task') return;
    const current = this.subagentRecords.get(subagentRunId);
    if (!current) return;
    const ended: SubagentRecord = {
      ...current,
      ...outcome,
      endedAt: Date.now(),
    };
    this.subagentRecords.set(subagentRunId, ended);
    try {
      getUpdateMessageContentStmt().run(
        JSON.stringify(ended),
        this.taskId,
        subagentMessageId(this.taskId, this.runId, subagentRunId),
      );
    } catch (err) {
      logger.error('Sub-agent status update failed', {
        taskId: this.taskId,
        subagentRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Extract file artifacts from file-writing tool calls (Write, Edit, etc.).
   * Parses tool args JSON for file_path and registers in files table.
   */
  private extractFileFromToolCall(
    toolName: string,
    toolArgsJson: string,
  ): void {
    if (this.mode !== 'task') return;
    if (!FILE_WRITING_TOOLS.has(toolName)) return;
    try {
      const args = JSON.parse(toolArgsJson) as Record<string, unknown>;
      const filePath = (args.file_path ?? args.path ?? args.filePath) as
        | string
        | undefined;
      if (!filePath || typeof filePath !== 'string') return;

      const fileName = filePath.split('/').pop() ?? filePath;
      const fileType = getFileType(filePath);
      const preview =
        typeof args.content === 'string'
          ? args.content.slice(0, 200)
          : undefined;

      createFile({
        task_id: this.taskId,
        name: fileName,
        type: fileType,
        path: canonicalizePath(filePath),
        preview,
      });
      this.artifactDetected = true;
      this.recordArtifact(filePath);
      logger.debug('Extracted file from tool call', { toolName, filePath });
    } catch {
      // Best-effort — malformed JSON or DB error
    }
  }

  private recordArtifact(filePath: string): void {
    if (!this.runId) return;
    const entry = createTraceArtifactReference({
      filePath,
      taskId: this.mode === 'task' ? this.taskId : undefined,
      projectId: this.mode === 'task' ? undefined : this.taskId,
    });
    if (this.recordedArtifactIds.has(entry.id)) return;
    this.recordedArtifactIds.add(entry.id);
    recordTraceEvent({
      id: `${this.runId}:${entry.id}`,
      taskId: this.taskId,
      sessionId: this.runId,
      parentEventId: this.rootTraceEventId,
      kind: 'artifact_write',
      agent: this.provider,
      provider: this.provider,
      status: 'ok',
      attrs: traceManifestAttrs(
        createTraceSafeManifest('artifact_manifest', [entry]),
      ),
    });
  }

  /** Detect user-initiated aborts so we don't spend an LLM call summarising them.
   *  Intentionally narrow: a bare "aborted" also matches `AbortSignal.timeout()`
   *  and network errors, which are real failures the user should see. */
  private isUserAbortError(message: string): boolean {
    return /cancell?ed by user|user (?:abort|cancel)|run stopped by user|session stopped by user/i.test(
      message,
    );
  }

  private generateAndStoreSummary(
    subtype: 'dispatch_summary' | 'run_error_summary',
    errorMessage?: string,
  ): void {
    if (errorMessage && this.isUserAbortError(errorMessage)) return;

    const taskId = this.taskId;
    const task = getTask(taskId);
    if (!task) return;

    const assistantOutput = this.assistantTextAccum;
    const toolsUsed = [...this.toolsUsedSet];
    const updateTitleIfEmpty = subtype === 'dispatch_summary';

    generateDispatchSummary(
      task.prompt,
      assistantOutput,
      toolsUsed,
      errorMessage,
    )
      .then((summary) => {
        if (!summary) return;
        this.insertMessage({
          type: 'result',
          subtype,
          content: summary,
          messageId: `${taskId}_${this.branchId}_${subtype}`,
        });
        if (updateTitleIfEmpty && !task.title) {
          updateTask(taskId, { title: summary.slice(0, 120) });
        }
        logger.info('Summary stored', {
          taskId,
          subtype,
          summaryLength: summary.length,
        });
      })
      .catch((err) => {
        logger.warn('Failed to generate summary', {
          taskId,
          subtype,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  /**
   * Schedule a `scanSessionOutputDir` after a short delay, coalescing
   * concurrent Bash bursts into a single trailing scan. Idempotent —
   * multiple calls within the window collapse to one.
   */
  private scheduleIncrementalScan(): void {
    if (this.incrementalScanScheduled) return;
    this.incrementalScanScheduled = true;
    setTimeout(() => {
      this.incrementalScanScheduled = false;
      void this.scanSessionOutputDir();
    }, AGUIEventPersister.INCREMENTAL_SCAN_DELAY_MS).unref?.();
  }

  /** Backfill files on disk that the in-stream parser missed (e.g. orphan
   *  ffmpeg outputs after a mid-stream crash, mermaid CLI renders, etc.).
   *  `createFile` dedupes on path. Only files mtime'd after this run's
   *  start are registered — prevents orphaned files from an earlier
   *  session being attributed to this task.
   *
   *  Scans BOTH `{sessionCwd}/output` and `{workspaceRoot}/output` when
   *  they differ — agents on session-isolated cwds frequently use
   *  relative `output/` paths that resolve to the workspace root, not
   *  the session cwd. Without the second scan path, those files never
   *  surface in the sidebar. */
  private async scanSessionOutputDir(): Promise<number> {
    const candidates: string[] = [];
    if (this.sessionCwd) candidates.push(path.join(this.sessionCwd, 'output'));
    if (
      this.workspaceRoot &&
      (!this.sessionCwd ||
        path.resolve(this.workspaceRoot) !== path.resolve(this.sessionCwd))
    ) {
      candidates.push(path.join(this.workspaceRoot, 'output'));
    }
    if (candidates.length === 0) return 0;

    // 1s slack accommodates clock skew between the start timestamp (captured
    // on the Node side) and filesystem mtimes on HFS+/APFS.
    const mtimeFloor = this.startedAtMs - 1_000;
    let registered = 0;
    const seen = new Set<string>();
    for (const outputDir of candidates) {
      let entries: string[];
      try {
        entries = await readdir(outputDir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (name.startsWith('.')) continue;
        if (!ARTIFACT_EXT_RE.test(name)) continue;
        const full = path.join(outputDir, name);
        if (seen.has(full)) continue;
        seen.add(full);
        try {
          const st = await stat(full);
          if (!st.isFile()) continue;
          if (st.mtimeMs < mtimeFloor) continue;
          createFile({
            task_id: this.taskId,
            name,
            type: getFileType(name),
            path: canonicalizePath(full),
            preview: 'Detected in session output dir',
          });
          this.artifactDetected = true;
          this.recordArtifact(full);
          registered++;
        } catch {
          // Best-effort per-file
        }
      }
    }
    if (registered > 0) {
      if (this.runId) updateAgentRunDelivery(this.runId, 'delivered');
      logger.info('Backfilled session output files', {
        taskId: this.taskId,
        count: registered,
        outputDirs: candidates,
      });
    }
    return registered;
  }

  /**
   * Extract file paths from tool output text (Bash, Skill results).
   * Looks for absolute paths with known extensions.
   */
  private extractFilesFromOutput(output: string): void {
    if (this.mode !== 'task' || !output) return;
    try {
      const matches = output.matchAll(/\/[^\s"'`\n]+/g);
      for (const match of matches) {
        const candidate = match[0].replace(/[)}\],:;]+$/, ''); // strip trailing punctuation
        if (!ARTIFACT_EXT_RE.test(candidate)) continue;
        // Accept paths under workspaceRoot OR sessionCwd — either may be unset
        // depending on how the task was started.
        const inWorkspace =
          !this.workspaceRoot || candidate.startsWith(this.workspaceRoot);
        const inSession =
          !!this.sessionCwd && candidate.startsWith(this.sessionCwd);
        if (!inWorkspace && !inSession) continue;

        // Inspect only the path *within* the project root for ignored
        // directories (node_modules/, dist/, tmp/, …). Checking the absolute
        // path would also match system ancestors — e.g. Linux's /tmp — and
        // wrongly drop real output files.
        const projectRoot = inSession
          ? this.sessionCwd
          : this.workspaceRoot && candidate.startsWith(this.workspaceRoot)
            ? this.workspaceRoot
            : undefined;
        if (
          projectRoot &&
          pathHasIgnoredProjectDir(candidate.slice(projectRoot.length))
        ) {
          continue;
        }

        if (pathHasSegment(candidate, SOURCE_PATH_SEGMENTS)) continue;
        if (
          !pathHasSegment(candidate, OUTPUT_PATH_SEGMENTS) &&
          !hasOutputCueBefore(output, match.index ?? 0)
        ) {
          continue;
        }

        const fileName = candidate.split('/').pop() ?? candidate;
        const canonicalPath = canonicalizePath(candidate);
        createFile({
          task_id: this.taskId,
          name: fileName,
          type: getFileType(candidate),
          path: canonicalPath,
          preview: 'Detected in tool output',
          provenance: findFollowingProvenance(
            output,
            (match.index ?? 0) + match[0].length,
          ),
        });
        this.artifactDetected = true;
        this.recordArtifact(candidate);
        logger.debug('Extracted file from tool output', {
          path: canonicalPath,
        });
      }
    } catch {
      // Best-effort
    }
  }
}

/**
 * The MCP media server emits `<!--neuma:provenance {json}-->` immediately after
 * the `File:` / `Video file:` line. Scan a short window after the matched path
 * and return the JSON string (unparsed) ready for storage.
 */
function findFollowingProvenance(
  text: string,
  startIdx: number,
): string | undefined {
  const window = text.slice(startIdx, startIdx + 2048);
  const m = window.match(/<!--neuma:provenance\s+([\s\S]*?)-->/);
  return m?.[1]?.trim();
}
