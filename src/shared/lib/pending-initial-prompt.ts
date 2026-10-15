/**
 * Tasks whose first prompt has been created but not yet handed to the agent
 * runtime.
 *
 * The handoff used to live in `ChatDock` component state, so closing the dock
 * or navigating to the full view before the lazy thread connected dropped it
 * and left a task row that never ran. This registry is module-level, so it
 * survives the dock unmounting, and it is keyed by task so the dock, the dock
 * thread, and the full task view all agree on which prompt is still pending.
 *
 * It is deliberately not persisted: a prompt that has not been delivered within
 * the session is recovered from `tasks.prompt` by the view that owns the task.
 * The registry only answers "did a chat this dock just created already run?".
 */
const pendingFirstPrompts = new Map<string, string>();

export function markPendingFirstPrompt(taskId: string, text: string): void {
  pendingFirstPrompts.set(taskId, text);
}

export function readPendingFirstPrompt(taskId: string): string | null {
  return pendingFirstPrompts.get(taskId) ?? null;
}

export function clearPendingFirstPrompt(taskId: string): void {
  pendingFirstPrompts.delete(taskId);
}

/** Test-only: clears the registry between test cases. */
export function resetPendingFirstPromptsForTests(): void {
  pendingFirstPrompts.clear();
}
