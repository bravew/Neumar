// Demand-driven ownership of the `/assets/events` SSE stream.
//
// Browsers cap concurrent connections at ~6 per host over HTTP/1.1, shared
// across every tab of the origin (see `shared/lib/shared-event-source`). Each
// open video editor used to hold an `/assets/events` socket for its whole
// lifetime, so a few idle tabs starved the pool: the POST that raises the
// native file/folder chooser sat queued in the browser, never reached the API,
// and read as a dead menu item until the 150s client timeout fired.
//
// A lease marks a session as actually doing something — an attach, a
// hydration, a proxy encode. The stream exists only while a lease is held,
// plus a grace window, because proxy/artifact events arrive well after the
// attach request that triggered them has already resolved.

/**
 * How long a settled materialization stays visible in the progress panel, and
 * therefore how long the event stream outlives the last active operation.
 */
export const ASSET_MATERIALIZATION_NOTICE_TTL_MS = 90_000;

interface LeaseEntry {
  holders: number;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

const leases = new Map<string, LeaseEntry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Mark `sessionId` as active until the returned release function is called.
 * Releasing starts the grace window rather than dropping the stream at once.
 * The release function is idempotent, so it is safe in a `finally` that may
 * also run after unmount.
 */
export function acquireAssetMaterializationLease(
  sessionId: string | undefined,
): () => void {
  if (!sessionId) return () => {};
  const existing = leases.get(sessionId);
  const entry: LeaseEntry = existing ?? { holders: 0, graceTimer: null };
  if (entry.graceTimer !== null) {
    clearTimeout(entry.graceTimer);
    entry.graceTimer = null;
  }
  entry.holders += 1;
  leases.set(sessionId, entry);
  if (!existing) notify();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (leases.get(sessionId) !== entry) return;
    entry.holders -= 1;
    if (entry.holders > 0) return;
    entry.graceTimer = setTimeout(() => {
      if (leases.get(sessionId) !== entry || entry.holders > 0) return;
      leases.delete(sessionId);
      notify();
    }, ASSET_MATERIALIZATION_NOTICE_TTL_MS);
  };
}

export function isAssetMaterializationLeaseActive(
  sessionId: string | undefined,
): boolean {
  return sessionId ? leases.has(sessionId) : false;
}

export function subscribeAssetMaterializationLeases(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
