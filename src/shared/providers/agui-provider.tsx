import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  CopilotKit as CopilotKitProvider,
  useAgent,
} from '@copilotkit/react-core/v2';

import { API_BASE_URL } from '@/config';
import type { LibraryFile } from '@/shared/db/types';
import { libraryFileToTaskFile } from '@/shared/lib/task-files';
import { useThreadStore } from '@/shared/stores/thread-store';
import type { TaskFile, ThreadMessage } from '@/shared/stores/thread-store';

// ── Workspace state context (P1b: cost/usage display) ─────────────────────────

export interface WorkspaceUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

interface WorkspaceState {
  usage: WorkspaceUsage | null;
  workspacePath: string | null;
  taskTitle: string | null;
}

interface HistoryResponse {
  messages: ThreadMessage[];
  isRunning: boolean;
  files?: TaskFile[];
}

const WorkspaceStateContext = createContext<WorkspaceState>({
  usage: null,
  workspacePath: null,
  taskTitle: null,
});

/** Read workspace state (usage, path, title) populated from AG-UI STATE_SNAPSHOT events. */
export function useWorkspaceState(): WorkspaceState {
  return useContext(WorkspaceStateContext);
}

// ── Agent actions context — exposes setPendingImages for components inside provider ──

/** Image block format sent to the backend as a top-level `images` field. */
export interface PendingImageBlock {
  type: 'image';
  /** Data URL: `data:<mimeType>;base64,<data>` */
  image: string;
}

interface AgentActions {
  /** Call before runtime.append() to ensure images reach the backend. */
  setPendingImages: (images: PendingImageBlock[]) => void;
}

const AgentActionsContext = createContext<AgentActions | null>(null);

/** Access agent actions (image upload passthrough) from inside AgUiProvider. */
export function useAgentActions(): AgentActions | null {
  return useContext(AgentActionsContext);
}

async function fetchTaskFiles(
  threadId: string,
  signal: AbortSignal,
): Promise<TaskFile[]> {
  const res = await fetch(`${API_BASE_URL}/db/tasks/${threadId}/files`, {
    signal,
  });
  if (!res.ok) return [];
  const files = (await res.json()) as LibraryFile[];
  return files.map(libraryFileToTaskFile);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isThreadToolCall(
  value: unknown,
): value is NonNullable<ThreadMessage['toolCalls']>[number] {
  if (!isRecord(value)) return false;
  const fn = value.function;
  return (
    typeof value.id === 'string' &&
    (value.type === undefined || value.type === 'function') &&
    isRecord(fn) &&
    typeof fn.name === 'string' &&
    typeof fn.arguments === 'string'
  );
}

function isThreadMessage(value: unknown): value is ThreadMessage {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (
    value.role !== 'user' &&
    value.role !== 'assistant' &&
    value.role !== 'tool' &&
    value.role !== 'reasoning'
  ) {
    return false;
  }
  if (value.content !== undefined && typeof value.content !== 'string') {
    return false;
  }
  if (value.toolCalls !== undefined) {
    return (
      Array.isArray(value.toolCalls) && value.toolCalls.every(isThreadToolCall)
    );
  }
  return true;
}

function isTaskFile(value: unknown): value is TaskFile {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    typeof value.kind === 'string'
  );
}

function parseHistoryResponse(value: unknown): HistoryResponse | null {
  if (!isRecord(value)) return null;
  const { files, isRunning, messages } = value;
  if (typeof isRunning !== 'boolean' || !Array.isArray(messages)) return null;
  if (!messages.every(isThreadMessage)) return null;
  if (
    files !== undefined &&
    (!Array.isArray(files) || !files.every(isTaskFile))
  ) {
    return null;
  }
  return {
    messages,
    isRunning,
    files,
  };
}

// ── Inner component that reads useAgent (must be inside CopilotKitProvider) ───

function AgUiProviderInner({
  threadId,
  isNewTask,
  children,
}: {
  threadId: string;
  isNewTask?: boolean;
  children: ReactNode;
}) {
  const { agent } = useAgent();
  const hydrateFromDB = useThreadStore((s) => s.hydrateFromDB);
  const setHydrationState = useThreadStore((s) => s.setHydrationState);
  const setMessages = useThreadStore((s) => s.setMessages);
  const setRunning = useThreadStore((s) => s.setRunning);

  // On mount and thread switch: fetch full history from backend and populate Zustand cache.
  // Brand-new tasks still get an empty hydrated cache entry so re-entry is deterministic.
  useEffect(() => {
    agent.setMessages([]);

    if (isNewTask) {
      hydrateFromDB(threadId, [], false, { files: [] });
      return;
    }

    const ctrl = new AbortController();
    setHydrationState(threadId, 'pending');

    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/ag-ui/history/${threadId}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) {
          if (!ctrl.signal.aborted) {
            setHydrationState(threadId, 'error');
          }
          return;
        }
        const history = parseHistoryResponse(await res.json());
        if (!history) {
          if (!ctrl.signal.aborted) {
            setHydrationState(threadId, 'error');
          }
          return;
        }
        const files =
          history.files ?? (await fetchTaskFiles(threadId, ctrl.signal));
        if (ctrl.signal.aborted) return;

        agent.setMessages(
          history.messages as Parameters<typeof agent.setMessages>[0],
        );
        hydrateFromDB(threadId, history.messages, history.isRunning, {
          files,
        });
      } catch (error) {
        if (!ctrl.signal.aborted && (error as Error).name !== 'AbortError') {
          setHydrationState(threadId, 'error');
        }
      }
    })();

    return () => ctrl.abort();
  }, [agent, threadId, isNewTask, hydrateFromDB, setHydrationState]);

  // Mirror active CopilotKit messages into Zustand on every mutation. The
  // active agent remains authoritative while mounted; the store becomes an
  // up-to-date handoff for inactive threads and rapid task switches.
  //
  // Intentionally does NOT mirror activeAgent.isRunning: the AG-UI client
  // occasionally fails to clear it after RUN_FINISHED, which would otherwise
  // pin the UI's "Running…" indicator until a task switch. The lifecycle
  // events below are the source of truth for isRunning.
  useEffect(() => {
    const sub = agent.subscribe({
      onMessagesChanged: ({ messages }) => {
        setMessages(threadId, messages as ThreadMessage[]);
      },
      onRunStartedEvent: () => {
        setRunning(threadId, true);
      },
      onRunFinishedEvent: () => {
        setRunning(threadId, false);
      },
      onRunErrorEvent: () => {
        setRunning(threadId, false);
      },
    });
    return () => sub.unsubscribe();
  }, [agent, threadId, setMessages, setRunning]);

  // Snapshot CopilotKit messages into Zustand on unmount so the cache
  // survives the provider destruction on task switch. Without this, new
  // tasks (isNewTask=true) never populate the Zustand cache, causing an
  // empty thread flash when the user switches back.
  useEffect(() => {
    return () => {
      // Preserve the Zustand isRunning set by AG-UI lifecycle events rather
      // than re-using agent.isRunning, which can be stuck at true after a
      // missed RUN_FINISHED handoff in the CopilotKit runtime.
      const existing = useThreadStore.getState().threads[threadId]?.isRunning;
      hydrateFromDB(
        threadId,
        agent.messages as ThreadMessage[],
        existing ?? agent.isRunning,
      );
    };
  }, [agent, threadId, hydrateFromDB]);

  // Derive workspace state from agent.state (populated by STATE_SNAPSHOT).
  // Re-subscribe whenever the agent identity changes (e.g. CopilotKit reconnect).
  const [wsState, setWsState] = useState<WorkspaceState>({
    usage: null,
    workspacePath: null,
    taskTitle: null,
  });

  useEffect(() => {
    const sub = agent.subscribe({
      onStateChanged: ({ state }) => {
        const s = state as Record<string, unknown>;
        const usageRaw = s?.usage as Record<string, number> | undefined;
        const workspaceRaw = s?.workspace as Record<string, string> | undefined;
        const taskRaw = s?.task as Record<string, string> | undefined;
        if (!usageRaw && !workspaceRaw && !taskRaw) return;
        setWsState((prev) => ({
          usage: usageRaw
            ? {
                inputTokens: usageRaw.inputTokens ?? 0,
                outputTokens: usageRaw.outputTokens ?? 0,
                cost: usageRaw.cost ?? 0,
              }
            : prev.usage,
          workspacePath: workspaceRaw?.path ?? prev.workspacePath,
          taskTitle: taskRaw?.title ?? prev.taskTitle,
        }));
      },
    });
    return () => sub.unsubscribe();
  }, [agent]);

  // Image passthrough — store in ref for next runAgent call
  const agentActions = useMemo<AgentActions>(
    () => ({
      setPendingImages: (_images: PendingImageBlock[]) => {
        // CopilotKit image handling TBD — images can be passed via
        // forwardedProps in copilotkit.runAgent() when integrated
      },
    }),
    [],
  );

  return (
    <WorkspaceStateContext.Provider value={wsState}>
      <AgentActionsContext.Provider value={agentActions}>
        {children}
      </AgentActionsContext.Provider>
    </WorkspaceStateContext.Provider>
  );
}

// ── Public provider ───────────────────────────────────────────────────────

interface AgUiProviderProps {
  threadId: string;
  /** When true, skip history fetch — this is a brand-new task with no DB history. */
  isNewTask?: boolean;
  children: ReactNode;
}

/**
 * Wraps a conversation thread with CopilotKit's AG-UI runtime.
 *
 * Replaces the previous assistant-ui based AgUiProvider.
 * - CopilotKit provider connects to /copilotkit (CopilotRuntime proxy)
 * - useAgent('neuma') provides messages, state, and run control
 * - useInterrupt handles plan approval natively (in PlanInterruptCard)
 * - agent.state provides usage/workspace/task data from STATE_SNAPSHOT
 */
export function AgUiProvider({
  threadId,
  isNewTask,
  children,
}: AgUiProviderProps) {
  return (
    <CopilotKitProvider
      runtimeUrl={`${API_BASE_URL}/copilotkit`}
      threadId={threadId}
      useSingleEndpoint={false}
      showDevConsole={false}
      enableInspector={false}
      onError={(event) => {
        if (import.meta.env.DEV) {
          console.error(
            `[AgUiProvider CopilotKit ${event.type}]`,
            event.error?.message,
            event.context,
          );
        }
      }}
    >
      <AgUiProviderInner threadId={threadId} isNewTask={isNewTask}>
        {children}
      </AgUiProviderInner>
    </CopilotKitProvider>
  );
}
