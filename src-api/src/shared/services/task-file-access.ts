/**
 * The daemon owns task execution. Synchronous acquisition makes run startup and
 * rewind mutually exclusive across HTTP, MCP, channels, and scheduled runs.
 * Durable run reservations are checked separately before acquiring a rewind.
 */
const rewindingTasks = new Set<string>();
const runningTasks = new Map<string, number>();

export class TaskFileAccessConflictError extends Error {}

export function isTaskRewinding(taskId: string): boolean {
  return rewindingTasks.has(taskId);
}

export function acquireTaskRun(taskId?: string): Disposable {
  if (!taskId) return { [Symbol.dispose]() {} };
  if (rewindingTasks.has(taskId)) {
    throw new TaskFileAccessConflictError('Task files are being rewound');
  }
  runningTasks.set(taskId, (runningTasks.get(taskId) ?? 0) + 1);
  return {
    [Symbol.dispose]() {
      const count = runningTasks.get(taskId);
      if (count === 1) runningTasks.delete(taskId);
      else if (count !== undefined) runningTasks.set(taskId, count - 1);
    },
  };
}

export function acquireTaskRewind(taskId: string): Disposable {
  if (rewindingTasks.has(taskId) || runningTasks.has(taskId)) {
    throw new TaskFileAccessConflictError('Task files are in use');
  }
  rewindingTasks.add(taskId);
  return {
    [Symbol.dispose]() {
      rewindingTasks.delete(taskId);
    },
  };
}
