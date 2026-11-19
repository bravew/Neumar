/**
 * Permission prompts an adapter is blocked on, per task.
 *
 * A prompt is open from the moment its request is published until the adapter
 * settles it: answered, denied, expired, or aborted. A run uses this to decide
 * whether it can pause at a decision boundary, and to continue once no
 * decision for its task is open.
 */

import { createLogger } from '@/shared/utils/logger';

import type { OpenPermissionPrompt } from './tool-permission-registry';

const logger = createLogger('PermissionWaits');

const openByRequestId = new Map<string, OpenPermissionPrompt>();
const listenersByTask = new Map<string, Set<() => void>>();

function notify(taskId: string): void {
  const listeners = listenersByTask.get(taskId);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      logger.error('Permission wait listener failed', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Opens a wait for one prompt. Returns the settle function, which is
 * idempotent and must be called exactly when the adapter stops waiting.
 */
export function openPermissionWait(open: OpenPermissionPrompt): () => void {
  const requestId = open.prompt.id;
  openByRequestId.set(requestId, open);
  notify(open.taskId);
  return () => {
    if (openByRequestId.get(requestId) !== open) return;
    openByRequestId.delete(requestId);
    notify(open.taskId);
  };
}

/** Prompts for a task that the adapter is still blocked on. */
export function listOpenPermissionWaits(
  taskId: string,
): OpenPermissionPrompt[] {
  return [...openByRequestId.values()].filter((open) => open.taskId === taskId);
}

export function hasOpenPermissionWait(taskId: string): boolean {
  for (const open of openByRequestId.values()) {
    if (open.taskId === taskId) return true;
  }
  return false;
}

/**
 * The open wait for one request id, if the adapter is still blocked on it.
 * An expired prompt is reported as absent: the adapter denies it unanswered,
 * so a late answer must not approve it.
 */
export function findOpenPermissionWait(
  requestId: string,
): OpenPermissionPrompt | undefined {
  const open = openByRequestId.get(requestId);
  if (!open) return undefined;
  if (open.expiresAt !== null && open.expiresAt <= Date.now()) return undefined;
  return open;
}

/**
 * Calls `listener` whenever a prompt for the task opens or settles. Returns
 * the unsubscribe function.
 */
export function subscribePermissionWaits(
  taskId: string,
  listener: () => void,
): () => void {
  let listeners = listenersByTask.get(taskId);
  if (!listeners) {
    listeners = new Set();
    listenersByTask.set(taskId, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = listenersByTask.get(taskId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listenersByTask.delete(taskId);
  };
}

/**
 * Calls `onSettled` once no prompt for the task is open: immediately when none
 * is. Returns a cancel function that prevents the call.
 */
export function onPermissionWaitsSettled(
  taskId: string,
  onSettled: () => void,
): () => void {
  if (!hasOpenPermissionWait(taskId)) {
    onSettled();
    return () => undefined;
  }
  let active = true;
  const cancel = (): void => {
    if (!active) return;
    active = false;
    unsubscribe();
  };
  const unsubscribe = subscribePermissionWaits(taskId, () => {
    if (!active || hasOpenPermissionWait(taskId)) return;
    cancel();
    onSettled();
  });
  return cancel;
}

/** Test-only: forget every open wait and listener. */
export function resetPermissionWaitsForTest(): void {
  openByRequestId.clear();
  listenersByTask.clear();
}
