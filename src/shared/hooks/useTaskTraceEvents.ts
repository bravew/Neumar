import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import type {
  PersistedTraceEvent,
  TraceListResponse,
} from '@/shared/types/observability';

export interface UseTaskTraceEventsResult {
  events: PersistedTraceEvent[];
  loading: boolean;
  error: string | null;
  source: 'persisted' | 'empty';
}

// ISO-8601 timestamps sort lexicographically, so string compare is a valid
// fallback when started_at ties.
function compareEvents(a: PersistedTraceEvent, b: PersistedTraceEvent): number {
  if (a.started_at !== b.started_at) return a.started_at - b.started_at;
  if (a.created_at !== b.created_at)
    return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function insertSorted(
  list: PersistedTraceEvent[],
  event: PersistedTraceEvent,
): PersistedTraceEvent[] {
  const existing = list.findIndex((e) => e.id === event.id);
  if (existing !== -1) {
    const next = list.slice();
    next[existing] = event;
    return next;
  }
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareEvents(list[mid], event) <= 0) lo = mid + 1;
    else hi = mid;
  }
  const next = list.slice();
  next.splice(lo, 0, event);
  return next;
}

export function useTaskTraceEvents(
  taskId: string | undefined,
  isRunning: boolean,
  enabled: boolean = true,
): UseTaskTraceEventsResult {
  const [events, setEvents] = useState<PersistedTraceEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // `source` is set once after the initial fetch resolves so SSE arrivals
  // can't flip it mid-stream and force `TraceViewer` to drop the
  // message-derived path while events are still streaming in.
  const [source, setSource] = useState<'persisted' | 'empty'>('empty');

  useEffect(() => {
    setEvents([]);
    setError(null);
    setSource('empty');
    if (!enabled || !taskId) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    fetch(`${API_BASE_URL}/observability/tasks/${taskId}/trace`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as TraceListResponse;
        // Merge fetched events into whatever live events have already streamed
        // in, so the SSE-then-fetch race doesn't drop live arrivals.
        setEvents((prev) => {
          let next = prev;
          for (const event of body.events ?? [])
            next = insertSorted(next, event);
          return next;
        });
        setSource((body.events?.length ?? 0) > 0 ? 'persisted' : 'empty');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load trace');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [taskId, enabled]);

  useEffect(() => {
    if (!enabled || !taskId || !isRunning) return;
    const es = new EventSource(
      `${API_BASE_URL}/observability/tasks/${taskId}/trace/subscribe`,
    );

    const handler = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        const persisted: PersistedTraceEvent | undefined = payload?.event;
        if (!persisted || typeof persisted.id !== 'string') return;
        setEvents((prev) => insertSorted(prev, persisted));
      } catch {
        // EventSource keeps streaming on parse failures.
      }
    };

    es.addEventListener('trace.event', handler);
    return () => {
      es.removeEventListener('trace.event', handler);
      es.close();
    };
  }, [taskId, isRunning, enabled]);

  return {
    events,
    loading,
    error,
    source,
  };
}
