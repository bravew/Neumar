// Pure read cache. Server's agent_runs is the source of truth.

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { API_BASE_URL } from '@/config';

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface RunTreeNode {
  id: string;
  taskId: string;
  parentRunId: string | null;
  provider: string;
  model: string | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
  completeness: 'complete' | 'unfinished' | 'unknown';
  delivery: 'not_expected' | 'pending' | 'delivered' | 'blocked' | 'failed';
  retry: 'not_safe' | 'safe_once' | 'user_action';
  failureCause: string | null;
  runtimeVersion: string | null;
  attempt: number;
  sessionHandleKind: string | null;
  invalidationReason: string | null;
  mode: 'task' | 'design' | 'video';
  ownerKey: string;
  executionId: string;
  initialRunId: string;
  sourceRunId: string | null;
  runIndex: number | null;
  recoveryAction:
    | 'retry'
    | 'continue'
    | 'answer_question'
    | 'switch_runtime'
    | 'resume_after_restart'
    | null;
  children: RunTreeNode[];
}

export interface RunTreeRollup {
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  runCount: number;
  runningCount: number;
  failedCount: number;
}

export interface ExecutionOutcomeSummary {
  executionId: string;
  initialRunId: string;
  latestRunId: string;
  status: 'active' | 'awaiting_input' | 'succeeded' | 'failed' | 'cancelled';
  attemptCount: number;
  recoveryActions: Array<NonNullable<RunTreeNode['recoveryAction']>>;
}

interface TaskRunTree {
  tree: RunTreeNode[];
  rollup: RunTreeRollup;
  executions: ExecutionOutcomeSummary[];
  fetchedAt: number;
  loading: boolean;
  error: string | null;
}

interface RunTreeStore {
  byTaskId: Record<string, TaskRunTree>;
  byOwner: Record<string, TaskRunTree>;
  fetch: (taskId: string) => Promise<void>;
  fetchOwner: (mode: RunTreeNode['mode'], ownerKey: string) => Promise<void>;
  clear: (taskId: string) => void;
}

const EMPTY_ROLLUP: RunTreeRollup = {
  totalCostUsd: 0,
  totalTokensIn: 0,
  totalTokensOut: 0,
  runCount: 0,
  runningCount: 0,
  failedCount: 0,
};

const EMPTY_TASK: TaskRunTree = {
  tree: [],
  rollup: EMPTY_ROLLUP,
  executions: [],
  fetchedAt: 0,
  loading: false,
  error: null,
};

/** Skip refetch if we have data <2s old. Stops StrictMode double-mount races. */
const STALE_AFTER_MS = 2_000;

/**
 * These are GETs against the API on this machine. Anything slower than this is
 * a request that never got a socket — the browser caps concurrent connections
 * per host, and a saturated pool leaves the request queued indefinitely. Give
 * up rather than sit on a pool slot and a "Loading diagnostics…" spinner.
 */
const REQUEST_TIMEOUT_MS = 12_000;

const inFlight = new Map<string, Promise<void>>();

interface RunTreePayload {
  tree: RunTreeNode[];
  rollup: RunTreeRollup;
  executions: ExecutionOutcomeSummary[];
}

function isAbortError(err: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' &&
      err instanceof DOMException &&
      err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

/**
 * The request's lifetime belongs to the store, not to whichever component
 * happened to trigger it. `inFlight` hands the same promise to every caller,
 * so honouring one caller's AbortSignal would cancel the shared request out
 * from under the others and strand them in `loading` forever — the bounded
 * timeout is what releases the socket instead.
 */
async function fetchRunTree(url: string): Promise<RunTreePayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as RunTreePayload;
  } catch (error) {
    if (isAbortError(error)) throw new Error('Request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const useRunTreeStore = create<RunTreeStore>()(
  immer((set, get) => ({
    byTaskId: {},
    byOwner: {},

    fetch: async (taskId) => {
      const existing = get().byTaskId[taskId];
      if (existing && Date.now() - existing.fetchedAt < STALE_AFTER_MS) {
        return;
      }
      const pending = inFlight.get(taskId);
      if (pending) return pending;

      // Keep prior tree visible during refresh — avoids UI flicker.
      set((state) => {
        const prev = state.byTaskId[taskId] ?? EMPTY_TASK;
        state.byTaskId[taskId] = { ...prev, loading: true, error: null };
      });

      const run = (async () => {
        try {
          const data = await fetchRunTree(
            `${API_BASE_URL}/runs/${taskId}/tree`,
          );
          set((state) => {
            state.byTaskId[taskId] = {
              tree: data.tree,
              rollup: data.rollup,
              executions: data.executions,
              fetchedAt: Date.now(),
              loading: false,
              error: null,
            };
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set((state) => {
            const prev = state.byTaskId[taskId] ?? EMPTY_TASK;
            state.byTaskId[taskId] = {
              ...prev,
              loading: false,
              error: message,
            };
          });
        } finally {
          inFlight.delete(taskId);
        }
      })();

      inFlight.set(taskId, run);
      return run;
    },

    fetchOwner: async (mode, ownerKey) => {
      const key = `${mode}:${ownerKey}`;
      const existing = get().byOwner[key];
      if (existing && Date.now() - existing.fetchedAt < STALE_AFTER_MS) return;
      const pending = inFlight.get(key);
      if (pending) return pending;
      set((state) => {
        const prev = state.byOwner[key] ?? EMPTY_TASK;
        state.byOwner[key] = { ...prev, loading: true, error: null };
      });
      const request = (async () => {
        try {
          const data = await fetchRunTree(
            `${API_BASE_URL}/runs/owner/${mode}/${encodeURIComponent(ownerKey)}/tree`,
          );
          set((state) => {
            state.byOwner[key] = {
              ...data,
              fetchedAt: Date.now(),
              loading: false,
              error: null,
            };
          });
        } catch (error) {
          set((state) => {
            const prev = state.byOwner[key] ?? EMPTY_TASK;
            state.byOwner[key] = {
              ...prev,
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            };
          });
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, request);
      return request;
    },

    clear: (taskId) => {
      // Drop any in-flight fetch too — otherwise the next fetch() returns the
      // stale pending promise, whose late resolve would resurrect the cleared
      // entry.
      inFlight.delete(taskId);
      set((state) => {
        delete state.byTaskId[taskId];
      });
    },
  })),
);

export function selectRunTree(
  state: RunTreeStore,
  taskId: string,
): TaskRunTree | undefined {
  return state.byTaskId[taskId];
}

export function selectRunTreeRollup(
  state: RunTreeStore,
  taskId: string,
): RunTreeRollup {
  return state.byTaskId[taskId]?.rollup ?? EMPTY_ROLLUP;
}
