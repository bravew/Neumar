import { AsyncLocalStorage } from 'node:async_hooks';

const projectLocks = new Map<string, Promise<unknown>>();

/**
 * Project ids whose lock the current async context already holds.
 *
 * This lock is the single serialization point for a project document, which
 * means nested acquisition is normal: a route takes it, and something it calls
 * — `updateProjectDocument()`, say — takes it again for the same project. A
 * plain queue would deadlock there, because the inner acquirer waits on a
 * promise that cannot settle until the outer one returns.
 */
const heldLocks = new AsyncLocalStorage<Set<string>>();

/**
 * Serialize work on one project document, per API process.
 *
 * Not a file lock: it orders callers inside the Tauri sidecar or `pnpm dev:api`,
 * and a second process pointed at the same workspace is ordered only by the
 * revision check in `projectDocumentForWrite()`.
 */
export async function withProjectLock<T>(
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const held = heldLocks.getStore();
  // Already inside this project's critical section: run inline. Re-queueing
  // would wait on the outer holder, which is this same call stack.
  if (held?.has(projectId)) return fn();

  const nextHeld = new Set(held ?? []);
  nextHeld.add(projectId);
  const run = () => heldLocks.run(nextHeld, fn);

  const previous = projectLocks.get(projectId) ?? Promise.resolve();
  const next = previous.then(run, run);
  // The map holds a *bookkeeping* promise — it only serializes the next
  // acquirer and self-cleans the entry. It must never reject: the real
  // result/error is propagated to the caller via `next`. If we stored `next`
  // (or a `.finally` chained off it) directly, a callback that throws would
  // leave that branch without a rejection handler and surface as an unhandled
  // rejection even though the caller awaited and caught it.
  const tracked: Promise<unknown> = next.then(
    () => {},
    () => {},
  );
  // Self-clean once this lock settles, but only if no later acquirer has
  // replaced the entry. Compare against `tracked` (what we actually store) —
  // comparing against `next` here would never match and would leak the entry.
  void tracked.then(() => {
    if (projectLocks.get(projectId) === tracked) {
      projectLocks.delete(projectId);
    }
  });
  projectLocks.set(projectId, tracked);
  return next;
}
