// Reference-counted EventSource pool.
//
// Browsers cap concurrent connections at ~6 per host (HTTP/1.1), shared across
// every tab of that origin. The video editor opens several persistent SSE
// streams, and two of them historically pointed at the same `/assets/events`
// URL from different components — two sockets doing identical work. When the
// pool fills, ordinary requests (catalog search, plugin apply) can't get a
// socket and hang. Sharing one connection per URL keeps the socket budget low.

interface PoolEntry {
  source: EventSource;
  refCount: number;
}

const pool = new Map<string, PoolEntry>();

export type SharedSourceListener = (
  eventName: string,
  message: MessageEvent<string>,
) => void;

/**
 * Subscribe to a set of named SSE events on `url`, sharing a single underlying
 * EventSource with every other subscriber of the same URL. Returns an
 * unsubscribe function; the connection closes once the last subscriber leaves.
 */
export function subscribeSharedEventSource(
  url: string,
  eventNames: readonly string[],
  onEvent: SharedSourceListener,
): () => void {
  let entry = pool.get(url);
  if (!entry) {
    entry = { source: new EventSource(url), refCount: 0 };
    pool.set(url, entry);
  }
  entry.refCount += 1;
  const activeEntry = entry;

  const handlers = eventNames.map((eventName) => {
    const handler = (message: MessageEvent<string>) =>
      onEvent(eventName, message);
    activeEntry.source.addEventListener(eventName, handler);
    return { eventName, handler };
  });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const { eventName, handler } of handlers) {
      activeEntry.source.removeEventListener(eventName, handler);
    }
    activeEntry.refCount -= 1;
    if (activeEntry.refCount <= 0) {
      activeEntry.source.close();
      // Only evict if this is still the entry we own — a re-subscribe between
      // the refcount hitting zero and here would have replaced it.
      if (pool.get(url) === activeEntry) pool.delete(url);
    }
  };
}
