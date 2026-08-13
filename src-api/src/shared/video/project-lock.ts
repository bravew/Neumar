const projectLocks = new Map<string, Promise<unknown>>();

export async function withProjectLock<T>(
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = projectLocks.get(projectId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
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
