/**
 * Holds a task whose run ended at a tool-permission decision.
 *
 * The adapter's callback is still waiting, so the agent is alive and the
 * message source stays open. The hold waits until no permission for the task is
 * open, then starts the continuation run on the same source. It never starts
 * one for a run that was stopped: an abort settles the prompt it was waiting on,
 * and that settle must not look like an answer.
 */

import { onPermissionWaitsSettled } from '@/core/agent/permission-waits';

interface Hold {
  /** Run id the answering request wants the continuation to use. */
  expectedRunId?: string;
  cancelWait: () => void;
  abandon: () => void;
}

const holds = new Map<string, Hold>();

export interface PermissionHoldInput {
  taskId: string;
  /** The held run's abort signal; once aborted the hold only abandons. */
  signal: AbortSignal;
  /** Starts the next run on the held source. */
  resume: (runId: string) => void;
  /** Releases the held source when no continuation will run. */
  abandon: () => void;
}

export function holdUntilPermissionsSettled(input: PermissionHoldInput): void {
  // A task has one live run, so a second hold would be a stale one.
  releasePermissionHold(input.taskId);
  const hold: Hold = { cancelWait: () => undefined, abandon: input.abandon };
  holds.set(input.taskId, hold);
  const end = (): void => {
    if (holds.get(input.taskId) === hold) holds.delete(input.taskId);
  };
  hold.cancelWait = onPermissionWaitsSettled(input.taskId, () => {
    end();
    if (input.signal.aborted) {
      input.abandon();
      return;
    }
    input.resume(hold.expectedRunId ?? crypto.randomUUID());
  });
}

export function hasPermissionHold(taskId: string): boolean {
  return holds.has(taskId);
}

/**
 * Names the run id the continuation will use. Call it before the answers that
 * will settle the last open prompt. Returns false when the task is not held.
 */
export function expectContinuationRunId(
  taskId: string,
  runId: string | undefined,
): boolean {
  const hold = holds.get(taskId);
  if (!hold) return false;
  hold.expectedRunId = runId;
  return true;
}

/** Ends the hold without a continuation. Returns whether one was held. */
export function releasePermissionHold(taskId: string): boolean {
  const hold = holds.get(taskId);
  if (!hold) return false;
  holds.delete(taskId);
  hold.cancelWait();
  hold.abandon();
  return true;
}
