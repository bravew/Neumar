/**
 * Thread State Store (Zustand)
 *
 * Caches per-task message state in memory for instant task switching.
 * This store is the source of truth for **inactive threads** only.
 * Active threads use CopilotKit's agent state directly.
 *
 * LRU eviction keeps memory bounded — evicted threads reload from DB on next visit.
 */

import { EventType } from '@ag-ui/core';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import {
  applyActivityPatch,
  jsonClone,
  type JsonPatchOperation,
} from '@/shared/lib/activity-patch';
import {
  createCompleteToolCallState,
  createErrorToolCallState,
  createExecutingToolCallState,
  createInProgressToolCallState,
} from '@/shared/lib/tool-call-state';
import type { ToolCallState } from '@/shared/types/tool-call';
import { randomUUID } from '@/shared/utils/uuid';

/** CopilotKit-compatible message shape */
export interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'reasoning' | 'activity';
  content?: string | Record<string, unknown>;
  /**
   * An `activity` message carries its payload as an object in `content`, the
   * AG-UI wire shape, so history, CopilotKit and the reducer agree. It is a
   * UI-only message and never part of the model's conversation.
   */
  activityType?: string;
  /** Marks this assistant message as a persisted agent error (RUN_ERROR). */
  isError?: boolean;
  /** Optional subtype — e.g. 'dispatch_summary', 'run_error_summary'. */
  subtype?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
    toolStage?: 'pending' | 'streaming' | 'complete' | 'error';
    toolState?: ToolCallState;
    final?: boolean;
  }>;
  toolCallId?: string;
  /** Sub-agent invocation that produced this message; absent for the parent run. */
  subagentRunId?: string;
  /** JSON-encoded MessageAttachment[] for user messages (from DB rehydration). */
  attachments?: string;
}

/** One sub-agent invocation, keyed by the AG-UI `subagentRunId`. */
export interface ThreadSubagent {
  id: string;
  name: string;
  description?: string;
  parentSubagentRunId?: string;
  parentToolCallId?: string;
  status: 'running' | 'completed' | 'suspended' | 'error';
  result?: string;
  error?: { message: string; code?: string };
  startedAt?: number;
  endedAt?: number;
}

export type ThreadHydrationState = 'pending' | 'hydrated' | 'error';

export const THREAD_STORE_REDUCED_EVENT_TYPES = new Set<string>([
  EventType.TEXT_MESSAGE_START,
  EventType.TEXT_MESSAGE_CONTENT,
  EventType.TEXT_MESSAGE_END,
  EventType.TEXT_MESSAGE_CHUNK,
  EventType.REASONING_MESSAGE_START,
  EventType.REASONING_MESSAGE_CONTENT,
  EventType.REASONING_MESSAGE_END,
  EventType.REASONING_MESSAGE_CHUNK,
  EventType.TOOL_CALL_START,
  EventType.TOOL_CALL_ARGS,
  EventType.TOOL_CALL_END,
  EventType.TOOL_CALL_CHUNK,
  EventType.TOOL_CALL_RESULT,
  EventType.RUN_STARTED,
  EventType.RUN_FINISHED,
  EventType.RUN_ERROR,
  EventType.STATE_SNAPSHOT,
  EventType.STATE_DELTA,
  EventType.ACTIVITY_SNAPSHOT,
  EventType.ACTIVITY_DELTA,
  EventType.MESSAGES_SNAPSHOT,
  EventType.SUBAGENT_STARTED,
  EventType.SUBAGENT_FINISHED,
  EventType.SUBAGENT_ERROR,
]);

export const THREAD_STORE_IGNORED_EVENT_TYPES = new Set<string>([
  EventType.RAW,
  EventType.CUSTOM,
  EventType.STEP_STARTED,
  EventType.STEP_FINISHED,
  EventType.REASONING_START,
  EventType.REASONING_END,
  EventType.REASONING_ENCRYPTED_VALUE,
]);

export interface TaskFile {
  id: string;
  taskId?: string;
  name: string;
  path: string;
  mime?: string;
  kind:
    | 'image'
    | 'video'
    | 'audio'
    | 'pdf'
    | 'html'
    | 'doc'
    | 'code'
    | 'text'
    | 'presentation'
    | 'spreadsheet'
    | 'other';
  sizeBytes?: number;
  createdAt: string | number;
  runId?: string;
  sourceToolCallId?: string;
  role?: 'input' | 'output';
  previewPath?: string;
  preview?: string | null;
  thumbnail?: string | null;
  provenance?: string | null;
}

/**
 * Per-thread accumulator for in-flight streaming state. Mirrors the server-
 * side AGUIEventPersister (src-api/src/shared/services/ag-ui/persistence.ts) —
 * text deltas, reasoning, and tool-call args stream piecewise, so we collect
 * them here until the matching `*_END` event materialises the final message.
 */
interface ThreadAccumulator {
  /** Assistant text message in progress */
  textMessageId: string | null;
  /** Reasoning message in progress */
  reasoningMessageId: string | null;
  /** `toolCallId` → tool name (captured on TOOL_CALL_START) */
  toolNames: Record<string, string>;
  /** `toolCallId` → parent assistant messageId that owns the call */
  toolParentMsgId: Record<string, string>;
}

interface ThreadState {
  messages: ThreadMessage[];
  messagesIndexById: Record<string, number>;
  /** Sub-agent invocations in the order they started. */
  subagents: ThreadSubagent[];
  files: TaskFile[];
  filesIndexById: Record<string, number>;
  isRunning: boolean;
  hydratedFromDb: boolean;
  hydrationState: ThreadHydrationState;
  lastAccessedAt: number;
  accum: ThreadAccumulator;
  /**
   * Highest AG-UI event sequence number applied to this thread. Events with
   * `seq <= lastAppliedSeq` are skipped so buffered deltas that overlap a
   * hydration snapshot don't double-append to already-complete messages on
   * reconnect. Reset to -1 on hydrateFromDB.
   */
  lastAppliedSeq: number;
}

export interface AGUIStreamEvent {
  type: string;
  seq?: number;
  messageId?: string;
  delta?: string | JsonPatchOperation[];
  toolCallId?: string;
  toolCallName?: string;
  parentMessageId?: string;
  /** A string for text and tool results; an object for ACTIVITY_SNAPSHOT. */
  content?: string | Record<string, unknown>;
  message?: string;
  code?: string;
  role?: string;
  snapshot?: Record<string, unknown>;
  /** ACTIVITY_SNAPSHOT / ACTIVITY_DELTA */
  activityType?: string;
  replace?: boolean;
  patch?: unknown;
  /** MESSAGES_SNAPSHOT */
  messages?: ThreadMessage[];
  /**
   * RUN_FINISHED: why the run ended; absent means success. A suspended
   * SUBAGENT_FINISHED carries the same shape and names the decisions it waits on.
   */
  outcome?: {
    type?: string;
    /** RUN_FINISHED with type 'interrupt': the decisions still open. */
    interrupts?: unknown[];
    /** SUBAGENT_FINISHED with type 'suspended'. */
    interruptIds?: string[];
  };
  timestamp?: number;
  /** Set on a sub-agent's own events, and on SUBAGENT_* lifecycle events. */
  subagentRunId?: string;
  /** SUBAGENT_STARTED */
  name?: string;
  description?: string;
  parentSubagentRunId?: string;
  parentToolCallId?: string;
  /** SUBAGENT_FINISHED */
  result?: unknown;
}

/**
 * Tool result text for a run the user stopped. It is the message the server
 * sent as RUN_ERROR for a stop before stops became a cancelled outcome.
 */
const RUN_STOPPED_MESSAGE = 'Run stopped by user';

const RUN_ENDED_CODE = 'run_ended';

/**
 * Ends a sub-agent that is still running. The server closes every child before
 * a run ends, so this only covers a run that ended without that (a dropped
 * stream, a crashed process). It is shown as ended early, never as completed.
 * A run that ended awaiting a decision suspends its children instead: the work
 * may continue once the decision is answered.
 */
function closeRunningSubagents(
  subagents: ThreadSubagent[],
  endedAt: number,
  status: 'error' | 'suspended' = 'error',
): boolean {
  let changed = false;
  for (const subagent of subagents) {
    if (subagent.status !== 'running') continue;
    subagent.status = status;
    if (status === 'error') {
      subagent.error = {
        message: 'Run ended before the sub-agent finished',
        code: RUN_ENDED_CODE,
      };
    }
    subagent.endedAt = endedAt;
    changed = true;
  }
  return changed;
}

/** Ends every tool call still waiting for a result. True if any changed. */
function closeOpenToolCalls(msgs: ThreadMessage[], message: string): boolean {
  let changed = false;
  for (const msg of msgs) {
    for (const toolCall of msg.toolCalls ?? []) {
      if (toolCall.final) continue;
      toolCall.toolStage = 'error';
      toolCall.toolState = createErrorToolCallState(
        toolCall.function.arguments,
        message,
      );
      toolCall.final = true;
      changed = true;
    }
  }
  return changed;
}

interface ThreadStore {
  threads: Record<string, ThreadState>;

  // Actions
  hydrateFromDB: (
    taskId: string,
    messages: ThreadMessage[],
    isRunning: boolean,
    options?: {
      lastAppliedSeq?: number;
      files?: TaskFile[];
      subagents?: ThreadSubagent[];
    },
  ) => void;
  setMessages: (
    taskId: string,
    messages: ThreadMessage[],
    isRunning?: boolean,
  ) => void;
  setHydrationState: (
    taskId: string,
    hydrationState: ThreadHydrationState,
  ) => void;
  setFiles: (taskId: string, files: TaskFile[]) => void;
  upsertFile: (taskId: string, file: TaskFile) => void;
  removeFile: (taskId: string, fileId: string) => void;
  setRunning: (taskId: string, running: boolean) => void;
  touchThread: (taskId: string) => void;
  clearThread: (taskId: string) => void;
  /**
   * Apply a single streaming AG-UI event to the thread's messages, producing
   * the same end state the backend persister writes to SQLite. Unknown event
   * types are ignored so additive events on the wire don't break playback.
   */
  applyAGUIEvent: (taskId: string, event: AGUIStreamEvent) => void;
}

function emptyAccumulator(): ThreadAccumulator {
  return {
    textMessageId: null,
    reasoningMessageId: null,
    toolNames: {},
    toolParentMsgId: {},
  };
}

const MAX_CACHED_THREADS = 10;
const EMPTY_MESSAGES: ThreadMessage[] = [];
const EMPTY_FILES: TaskFile[] = [];

function createThreadState(
  messages: ThreadMessage[] = EMPTY_MESSAGES,
  isRunning = false,
  hydrationState: ThreadHydrationState = 'pending',
  files: TaskFile[] = EMPTY_FILES,
): ThreadState {
  const clonedFiles = cloneFiles(files);
  const clonedMessages = cloneMessages(messages);
  return {
    messages: clonedMessages,
    messagesIndexById: buildMessagesIndex(clonedMessages),
    subagents: [],
    files: clonedFiles,
    filesIndexById: buildFilesIndex(clonedFiles),
    isRunning,
    hydratedFromDb: hydrationState === 'hydrated',
    hydrationState,
    lastAccessedAt: Date.now(),
    accum: emptyAccumulator(),
    lastAppliedSeq: -1,
  };
}

function ensureThread(
  threads: Record<string, ThreadState>,
  taskId: string,
): ThreadState {
  const existing = threads[taskId];
  if (existing) return existing;
  const created = createThreadState();
  threads[taskId] = created;
  evictOldest(threads);
  return created;
}

function cloneMessages(messages: ThreadMessage[]): ThreadMessage[] {
  return messages.map((message) => ({
    ...message,
    toolCalls: message.toolCalls?.map((toolCall) => ({
      ...toolCall,
      function: { ...toolCall.function },
    })),
  }));
}

function buildMessagesIndex(messages: ThreadMessage[]): Record<string, number> {
  return messages.reduce<Record<string, number>>((acc, message, index) => {
    acc[message.id] = index;
    return acc;
  }, {});
}

function getMessageById(
  thread: ThreadState,
  id: string,
): ThreadMessage | undefined {
  const index = thread.messagesIndexById[id];
  return index === undefined ? undefined : thread.messages[index];
}

function pushMessage(thread: ThreadState, message: ThreadMessage): void {
  thread.messagesIndexById[message.id] = thread.messages.length;
  thread.messages.push(message);
}

function cloneFiles(files: TaskFile[]): TaskFile[] {
  return files.map((file) => ({ ...file }));
}

function buildFilesIndex(files: TaskFile[]): Record<string, number> {
  return files.reduce<Record<string, number>>((acc, file, index) => {
    acc[file.id] = index;
    return acc;
  }, {});
}

function upsertFileIntoThread(thread: ThreadState, file: TaskFile): void {
  const existingIndex = thread.filesIndexById[file.id];
  if (existingIndex === undefined) {
    thread.files.push({ ...file });
    thread.filesIndexById[file.id] = thread.files.length - 1;
    return;
  }
  thread.files[existingIndex] = { ...thread.files[existingIndex], ...file };
}

function removeFileFromThread(thread: ThreadState, fileId: string): void {
  const existingIndex = thread.filesIndexById[fileId];
  if (existingIndex === undefined) return;
  thread.files.splice(existingIndex, 1);
  thread.filesIndexById = buildFilesIndex(thread.files);
}

function isTaskFile(value: unknown): value is TaskFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TaskFile>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.path === 'string' &&
    typeof candidate.kind === 'string'
  );
}

function applyStatePatch(thread: ThreadState, patch: JsonPatchOperation): void {
  if (!patch.path.startsWith('/files')) return;

  if (patch.op === 'add') {
    if (isTaskFile(patch.value)) upsertFileIntoThread(thread, patch.value);
    return;
  }

  if (patch.op === 'replace') {
    if (isTaskFile(patch.value)) upsertFileIntoThread(thread, patch.value);
    return;
  }

  if (patch.op === 'remove') {
    const [, collection, idOrIndex] = patch.path.split('/');
    if (collection !== 'files' || !idOrIndex) return;
    const decoded = decodeURIComponent(idOrIndex);
    const index = Number.parseInt(decoded, 10);
    const fileId = Number.isNaN(index) ? decoded : thread.files[index]?.id;
    if (fileId) removeFileFromThread(thread, fileId);
  }
}

function messagesShallowEqual(a: ThreadMessage[], b: ThreadMessage[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.role !== right.role ||
      left.content !== right.content ||
      left.isError !== right.isError ||
      left.subtype !== right.subtype ||
      left.toolCallId !== right.toolCallId ||
      left.subagentRunId !== right.subagentRunId ||
      left.attachments !== right.attachments
    ) {
      return false;
    }
    const leftCalls = left.toolCalls ?? [];
    const rightCalls = right.toolCalls ?? [];
    if (leftCalls.length !== rightCalls.length) return false;
    for (let j = 0; j < leftCalls.length; j++) {
      if (
        leftCalls[j].id !== rightCalls[j].id ||
        leftCalls[j].type !== rightCalls[j].type ||
        leftCalls[j].function.name !== rightCalls[j].function.name ||
        leftCalls[j].function.arguments !== rightCalls[j].function.arguments
      ) {
        return false;
      }
    }
  }
  return true;
}

export const useThreadStore = create<ThreadStore>()(
  immer((set) => ({
    threads: {},

    hydrateFromDB: (taskId, messages, isRunning, options) =>
      set((state) => {
        const previous = state.threads[taskId];
        const files = options?.files ?? previous?.files ?? [];
        const clonedMessages = cloneMessages(messages);
        const clonedFiles = cloneFiles(files);
        const subagents = (options?.subagents ?? previous?.subagents ?? []).map(
          (subagent) => ({ ...subagent }),
        );
        // A run that is no longer live cannot have a child still running.
        if (!isRunning) closeRunningSubagents(subagents, Date.now());
        state.threads[taskId] = {
          messages: clonedMessages,
          messagesIndexById: buildMessagesIndex(clonedMessages),
          subagents,
          files: clonedFiles,
          filesIndexById: buildFilesIndex(clonedFiles),
          isRunning,
          hydratedFromDb: true,
          hydrationState: 'hydrated',
          lastAccessedAt: Date.now(),
          accum: emptyAccumulator(),
          lastAppliedSeq: options?.lastAppliedSeq ?? -1,
        };
        evictOldest(state.threads);
      }),

    setMessages: (taskId, messages, isRunning) =>
      set((state) => {
        const thread = ensureThread(state.threads, taskId);

        // A live CopilotKit mirror can lag behind a recently applied SSE
        // replay. Avoid replacing a richer thread with an older shorter
        // snapshot once seq-gated streaming has advanced the cache.
        if (
          thread.lastAppliedSeq >= 0 &&
          messages.length < thread.messages.length
        ) {
          if (isRunning !== undefined) thread.isRunning = isRunning;
          return;
        }

        if (messagesShallowEqual(thread.messages, messages)) {
          if (isRunning !== undefined) thread.isRunning = isRunning;
          return;
        }

        const clonedMessages = cloneMessages(messages);
        thread.messages = clonedMessages;
        thread.messagesIndexById = buildMessagesIndex(clonedMessages);
        if (isRunning !== undefined) thread.isRunning = isRunning;
        thread.lastAccessedAt = Date.now();
      }),

    setHydrationState: (taskId, hydrationState) =>
      set((state) => {
        const thread = ensureThread(state.threads, taskId);
        thread.hydrationState = hydrationState;
        thread.hydratedFromDb = hydrationState === 'hydrated';
        thread.lastAccessedAt = Date.now();
      }),

    setFiles: (taskId, files) =>
      set((state) => {
        const thread = ensureThread(state.threads, taskId);
        const clonedFiles = cloneFiles(files);
        thread.files = clonedFiles;
        thread.filesIndexById = buildFilesIndex(clonedFiles);
        thread.lastAccessedAt = Date.now();
      }),

    upsertFile: (taskId, file) =>
      set((state) => {
        const thread = ensureThread(state.threads, taskId);
        upsertFileIntoThread(thread, file);
        thread.lastAccessedAt = Date.now();
      }),

    removeFile: (taskId, fileId) =>
      set((state) => {
        const thread = ensureThread(state.threads, taskId);
        removeFileFromThread(thread, fileId);
        thread.lastAccessedAt = Date.now();
      }),

    setRunning: (taskId, running) =>
      set((state) => {
        const thread = ensureThread(state.threads, taskId);
        thread.isRunning = running;
        // A thread that is not running has no running child, however the
        // run ended (the provider reports it through here, not RUN_FINISHED).
        if (!running) closeRunningSubagents(thread.subagents, Date.now());
        thread.lastAccessedAt = Date.now();
      }),

    touchThread: (taskId) =>
      set((state) => {
        const thread = state.threads[taskId];
        if (thread) {
          thread.lastAccessedAt = Date.now();
        }
      }),

    clearThread: (taskId) =>
      set((state) => {
        delete state.threads[taskId];
      }),

    applyAGUIEvent: (taskId, event) =>
      set((state) => {
        const thread = ensureThread(state.threads, taskId);

        // Drop late/duplicate deltas — buffered events from the bus can
        // overlap a freshly-hydrated DB snapshot, and without this guard a
        // TEXT_MESSAGE_CONTENT would double-append to already-complete
        // message text.
        if (event.seq !== undefined && event.seq <= thread.lastAppliedSeq) {
          return;
        }
        if (
          event.seq !== undefined &&
          thread.lastAppliedSeq >= 0 &&
          event.seq > thread.lastAppliedSeq + 1
        ) {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('agui-event-gap-detected', {
                detail: {
                  taskId,
                  lastAppliedSeq: thread.lastAppliedSeq,
                  nextSeq: event.seq,
                },
              }),
            );
          }
        }

        const acc = thread.accum;
        const msgs = thread.messages;

        const findMsg = (id: string): ThreadMessage | undefined =>
          getMessageById(thread, id);
        const ensureMsg = (
          id: string,
          role: ThreadMessage['role'],
          content = '',
        ): ThreadMessage => {
          const existing = findMsg(id);
          if (existing) return existing;
          const created: ThreadMessage = { id, role, content };
          pushMessage(thread, created);
          return created;
        };
        const ensureToolCall = (
          toolCallId: string,
          toolCallName?: string,
          parentMessageId?: string,
          subagentRunId?: string,
        ): void => {
          const name = toolCallName ?? acc.toolNames[toolCallId] ?? 'tool';
          acc.toolNames[toolCallId] = name;

          // Attach to the currently streaming assistant message when
          // present — otherwise create a synthetic host so parallel calls
          // still render correctly.
          const host = acc.textMessageId
            ? (findMsg(acc.textMessageId) ??
              ensureMsg(acc.textMessageId, 'assistant'))
            : ensureMsg(
                parentMessageId ?? `assistant-${toolCallId}`,
                'assistant',
              );
          acc.toolParentMsgId[toolCallId] = host.id;
          if (subagentRunId && !host.subagentRunId) {
            host.subagentRunId = subagentRunId;
          }

          host.toolCalls = host.toolCalls ?? [];
          if (!host.toolCalls.some((tc) => tc.id === toolCallId)) {
            host.toolCalls.push({
              id: toolCallId,
              type: 'function',
              function: { name, arguments: '' },
              toolStage: 'pending',
              toolState: createInProgressToolCallState(''),
              final: false,
            });
          }
        };
        const findToolCall = (toolCallId: string) => {
          for (const msg of msgs) {
            const toolCall = msg.toolCalls?.find((tc) => tc.id === toolCallId);
            if (toolCall) return toolCall;
          }
          return undefined;
        };

        let mutated = true;

        switch (event.type) {
          case EventType.TEXT_MESSAGE_START: {
            if (!event.messageId) {
              mutated = false;
              break;
            }
            acc.textMessageId = event.messageId;
            const started = ensureMsg(
              event.messageId,
              (event.role as ThreadMessage['role']) ?? 'assistant',
            );
            if (event.subagentRunId)
              started.subagentRunId = event.subagentRunId;
            break;
          }

          case EventType.TEXT_MESSAGE_CONTENT:
          case EventType.TEXT_MESSAGE_CHUNK: {
            const id = event.messageId ?? acc.textMessageId;
            if (!id || !event.delta || typeof event.delta !== 'string') {
              mutated = false;
              break;
            }
            const msg = ensureMsg(id, 'assistant');
            msg.content = (msg.content ?? '') + event.delta;
            acc.textMessageId ??= id;
            break;
          }

          case EventType.TEXT_MESSAGE_END: {
            acc.textMessageId = null;
            // Accumulator-only change; skip re-render bookkeeping.
            mutated = false;
            break;
          }

          case EventType.REASONING_MESSAGE_START: {
            const id =
              event.messageId ?? `reasoning-${event.seq ?? randomUUID()}`;
            if (!id) {
              mutated = false;
              break;
            }
            acc.reasoningMessageId = id;
            const started = ensureMsg(id, 'reasoning');
            if (event.subagentRunId)
              started.subagentRunId = event.subagentRunId;
            break;
          }

          case EventType.REASONING_MESSAGE_CONTENT:
          case EventType.REASONING_MESSAGE_CHUNK: {
            const id = event.messageId ?? acc.reasoningMessageId;
            if (!id || !event.delta || typeof event.delta !== 'string') {
              mutated = false;
              break;
            }
            const msg = ensureMsg(id, 'reasoning');
            msg.content = (msg.content ?? '') + event.delta;
            if (event.subagentRunId) msg.subagentRunId ??= event.subagentRunId;
            acc.reasoningMessageId ??= id;
            break;
          }

          case EventType.REASONING_MESSAGE_END: {
            acc.reasoningMessageId = null;
            mutated = false;
            break;
          }

          case EventType.TOOL_CALL_START: {
            if (!event.toolCallId) {
              mutated = false;
              break;
            }
            ensureToolCall(
              event.toolCallId,
              event.toolCallName,
              event.parentMessageId,
              event.subagentRunId,
            );
            break;
          }

          case EventType.TOOL_CALL_ARGS:
          case EventType.TOOL_CALL_CHUNK: {
            if (
              !event.toolCallId ||
              (!event.delta && event.type !== EventType.TOOL_CALL_CHUNK)
            ) {
              mutated = false;
              break;
            }
            if (
              event.type === EventType.TOOL_CALL_CHUNK &&
              event.toolCallName &&
              !acc.toolParentMsgId[event.toolCallId]
            ) {
              ensureToolCall(
                event.toolCallId,
                event.toolCallName,
                event.parentMessageId,
              );
            }
            if (!event.delta || typeof event.delta !== 'string') {
              mutated = event.type === EventType.TOOL_CALL_CHUNK;
              break;
            }
            const hostId = acc.toolParentMsgId[event.toolCallId];
            if (!hostId) {
              mutated = false;
              break;
            }
            const tc = findMsg(hostId)?.toolCalls?.find(
              (t) => t.id === event.toolCallId,
            );
            if (tc) {
              tc.function.arguments += event.delta;
              tc.toolStage = 'streaming';
              tc.toolState = createInProgressToolCallState(
                tc.function.arguments,
              );
            } else mutated = false;
            break;
          }

          case EventType.TOOL_CALL_END: {
            if (!event.toolCallId) {
              mutated = false;
              break;
            }
            const toolCall = findToolCall(event.toolCallId);
            if (!toolCall) {
              mutated = false;
              break;
            }
            toolCall.toolStage = 'streaming';
            toolCall.toolState = createExecutingToolCallState(
              toolCall.function.arguments,
            );
            break;
          }

          case EventType.TOOL_CALL_RESULT: {
            if (!event.toolCallId) {
              mutated = false;
              break;
            }
            const completedTool = findToolCall(event.toolCallId);
            if (completedTool) {
              completedTool.toolStage = 'complete';
              completedTool.final = true;
              completedTool.toolState = createCompleteToolCallState(
                completedTool.function.arguments,
                typeof event.content === 'string' ? event.content : '',
              );
            }
            const resultId =
              event.messageId ?? `tool-${event.toolCallId}-result`;
            if (findMsg(resultId)) {
              mutated = false;
              break;
            }
            pushMessage(thread, {
              id: resultId,
              role: 'tool',
              toolCallId: event.toolCallId,
              content: typeof event.content === 'string' ? event.content : '',
              ...(event.subagentRunId
                ? { subagentRunId: event.subagentRunId }
                : {}),
            });
            break;
          }

          case EventType.SUBAGENT_STARTED: {
            const id = event.subagentRunId;
            if (!id || thread.subagents.some((a) => a.id === id)) {
              mutated = false;
              break;
            }
            thread.subagents.push({
              id,
              // The protocol leaves the name optional; the UI shows its
              // localized default for an empty one.
              name: event.name ?? '',
              status: 'running',
              startedAt: event.timestamp ?? Date.now(),
              ...(event.description === undefined
                ? {}
                : { description: event.description }),
              ...(event.parentSubagentRunId
                ? { parentSubagentRunId: event.parentSubagentRunId }
                : {}),
              ...(event.parentToolCallId
                ? { parentToolCallId: event.parentToolCallId }
                : {}),
            });
            break;
          }

          case EventType.SUBAGENT_FINISHED:
          case EventType.SUBAGENT_ERROR: {
            const subagent = thread.subagents.find(
              (a) => a.id === event.subagentRunId,
            );
            if (!subagent) {
              mutated = false;
              break;
            }
            subagent.endedAt = event.timestamp ?? Date.now();
            if (event.type === EventType.SUBAGENT_FINISHED) {
              // A suspended segment ended awaiting a decision: the invocation
              // may continue in a later run, so it is not a completion.
              subagent.status =
                event.outcome?.type === 'suspended' ? 'suspended' : 'completed';
              if (typeof event.result === 'string')
                subagent.result = event.result;
            } else {
              subagent.status = 'error';
              subagent.error = {
                message: event.message ?? '',
                ...(event.code ? { code: event.code } : {}),
              };
            }
            break;
          }

          case EventType.ACTIVITY_SNAPSHOT: {
            const id = event.messageId;
            const activityType = event.activityType;
            const content = event.content;
            if (
              !id ||
              (activityType !== 'plan' && activityType !== 'status') ||
              !content ||
              typeof content !== 'object' ||
              Array.isArray(content)
            ) {
              mutated = false;
              break;
            }
            const existing = findMsg(id);
            // `replace: false` means leave an existing activity untouched; it
            // never means shallow merge. A colliding conversation message is
            // not converted into an activity.
            if (existing) {
              if (
                event.replace === false ||
                existing.role !== 'activity' ||
                existing.activityType !== activityType
              ) {
                mutated = false;
                break;
              }
              existing.content = jsonClone(content);
              existing.subagentRunId ??= event.subagentRunId;
            } else {
              pushMessage(thread, {
                id,
                role: 'activity',
                activityType,
                content: jsonClone(content),
                ...(event.subagentRunId
                  ? { subagentRunId: event.subagentRunId }
                  : {}),
              });
            }
            break;
          }

          case EventType.ACTIVITY_DELTA: {
            const id = event.messageId;
            const activityType = event.activityType;
            const existing = id ? findMsg(id) : undefined;
            if (
              !id ||
              (activityType !== 'plan' && activityType !== 'status') ||
              !existing ||
              existing.role !== 'activity' ||
              existing.activityType !== activityType ||
              !existing.content ||
              typeof existing.content !== 'object'
            ) {
              mutated = false;
              break;
            }
            const patched = applyActivityPatch(existing.content, event.patch);
            if (!patched) {
              mutated = false;
              break;
            }
            existing.content = patched;
            existing.subagentRunId ??= event.subagentRunId;
            break;
          }

          case EventType.MESSAGES_SNAPSHOT: {
            if (!Array.isArray(event.messages)) {
              mutated = false;
              break;
            }
            const snapshot: ThreadMessage[] = [];
            for (const raw of event.messages) {
              if (!raw || typeof raw !== 'object') continue;
              const role = raw.role;
              const id = raw.id;
              if (typeof id !== 'string') continue;
              if (role === 'activity') {
                const activityType = raw.activityType;
                const content = raw.content;
                if (
                  (activityType !== 'plan' && activityType !== 'status') ||
                  !content ||
                  typeof content !== 'object' ||
                  Array.isArray(content)
                )
                  continue;
                snapshot.push({
                  id,
                  role: 'activity',
                  activityType,
                  content: jsonClone(content as Record<string, unknown>),
                  ...(typeof raw.subagentRunId === 'string'
                    ? { subagentRunId: raw.subagentRunId }
                    : {}),
                });
              } else if (
                role === 'user' ||
                role === 'assistant' ||
                role === 'tool' ||
                role === 'reasoning'
              ) {
                snapshot.push({
                  ...raw,
                  id,
                  role,
                  ...(typeof raw.content === 'string'
                    ? { content: raw.content }
                    : {}),
                } as ThreadMessage);
              }
            }
            const clonedMessages = cloneMessages(snapshot);
            thread.messages = clonedMessages;
            thread.messagesIndexById = buildMessagesIndex(clonedMessages);
            thread.lastAppliedSeq = event.seq ?? thread.lastAppliedSeq;
            mutated = true;
            break;
          }

          case EventType.RUN_STARTED: {
            thread.isRunning = true;
            mutated = false;
            break;
          }

          case EventType.RUN_FINISHED: {
            thread.isRunning = false;
            // A stopped run ends with RUN_FINISHED, not RUN_ERROR, but its
            // in-flight tool calls will never get a result either.
            const closedTools =
              event.outcome?.type === 'cancelled' &&
              closeOpenToolCalls(msgs, RUN_STOPPED_MESSAGE);
            const closedSubagents = closeRunningSubagents(
              thread.subagents,
              Date.now(),
              event.outcome?.type === 'interrupt' ? 'suspended' : 'error',
            );
            mutated = closedTools || closedSubagents;
            break;
          }

          case EventType.RUN_ERROR: {
            const errorId =
              event.messageId ?? `run-error-${event.seq ?? randomUUID()}`;
            const message =
              event.message ??
              (typeof event.content === 'string' ? event.content : undefined) ??
              'Unknown error';
            closeOpenToolCalls(msgs, message);
            closeRunningSubagents(thread.subagents, Date.now());
            if (!findMsg(errorId)) {
              pushMessage(thread, {
                id: errorId,
                role: 'assistant',
                content: message,
                isError: true,
                subtype: event.code ?? 'run_error',
              });
            }
            thread.isRunning = false;
            break;
          }

          case EventType.STATE_SNAPSHOT: {
            const files = event.snapshot?.files;
            if (Array.isArray(files)) {
              thread.files = files.filter(isTaskFile).map((file) => ({
                ...file,
              }));
              thread.filesIndexById = buildFilesIndex(thread.files);
              thread.lastAccessedAt = Date.now();
            }
            mutated = false;
            break;
          }

          case EventType.STATE_DELTA: {
            if (Array.isArray(event.delta)) {
              for (const patch of event.delta) {
                applyStatePatch(thread, patch);
              }
              thread.lastAccessedAt = Date.now();
            }
            mutated = false;
            break;
          }

          default:
            mutated = false;
        }

        if (event.seq !== undefined) thread.lastAppliedSeq = event.seq;
        if (mutated) thread.lastAccessedAt = Date.now();
      }),
  })),
);

/** Evict least-recently-accessed threads when cache exceeds limit. */
function evictOldest(threads: Record<string, ThreadState>): void {
  const keys = Object.keys(threads);
  if (keys.length <= MAX_CACHED_THREADS) return;

  // Sort by lastAccessedAt ascending — oldest first
  const sorted = keys
    .map((k) => ({ key: k, time: threads[k].lastAccessedAt }))
    .sort((a, b) => a.time - b.time);

  const toEvict = sorted.length - MAX_CACHED_THREADS;
  for (let i = 0; i < toEvict; i++) {
    delete threads[sorted[i].key];
  }
}

// ── Memoized selectors ──────────────────────────────────────────────────────

/** Select running task IDs — memoized by comparing actual IDs (immer breaks referential equality). */
let _cachedRunningIds: string[] = [];

export function selectRunningTaskIds(state: ThreadStore): string[] {
  const ids = Object.entries(state.threads)
    .filter(([, t]) => t.isRunning)
    .map(([id]) => id);
  // Shallow-compare with cached result to preserve referential equality
  if (
    ids.length === _cachedRunningIds.length &&
    ids.every((id, i) => id === _cachedRunningIds[i])
  ) {
    return _cachedRunningIds;
  }
  _cachedRunningIds = ids;
  return _cachedRunningIds;
}

export function useThreadMessages(taskId: string | undefined): ThreadMessage[] {
  return useThreadStore(
    (state) => state.threads[taskId ?? '']?.messages ?? EMPTY_MESSAGES,
  );
}

export function useThreadIsRunning(taskId: string | undefined): boolean {
  return useThreadStore(
    (state) => state.threads[taskId ?? '']?.isRunning ?? false,
  );
}

export function useThreadHydration(
  taskId: string | undefined,
): ThreadHydrationState {
  return useThreadStore(
    (state) => state.threads[taskId ?? '']?.hydrationState ?? 'pending',
  );
}

export function useTaskFiles(taskId: string | undefined): TaskFile[] {
  return useThreadStore(
    (state) => state.threads[taskId ?? '']?.files ?? EMPTY_FILES,
  );
}
