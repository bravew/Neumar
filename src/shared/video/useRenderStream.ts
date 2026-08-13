import { useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';

// Phase 6 M4 — resumable render-progress stream.
//
// Opens an EventSource to `/video/projects/:id/render/subscribe`. The browser's
// native EventSource auto-reconnects on a dropped connection and replays the
// `Last-Event-ID` header; the server resumes from `seq > lastEventId`, so a
// flaky connection never loses or double-counts progress. We close the stream
// ourselves on a terminal event to stop the auto-reconnect loop.

export type RenderStreamStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled';

interface RenderStreamEvent {
  type: 'progress' | 'done' | 'error' | 'idle';
  status?: RenderStreamStatus;
  progress?: number;
  message?: string;
  outputPath?: string;
  updatedAt?: string;
}

export interface RenderStreamState {
  /** True while the EventSource is open. */
  connected: boolean;
  /** Latest status reported by the stream, or null before the first event. */
  status: RenderStreamStatus | null;
  progress: number | null;
  message: string | null;
  /** Highest sequence number seen — exposed for tests / debugging. */
  lastSeq: number | null;
}

const INITIAL: RenderStreamState = {
  connected: false,
  status: null,
  progress: null,
  message: null,
  lastSeq: null,
};

function isTerminal(type: RenderStreamEvent['type']): boolean {
  return type === 'done' || type === 'error' || type === 'idle';
}

/**
 * Subscribe to a project's live render progress. Pass `enabled: false` to tear
 * the stream down (e.g. when no render is in flight).
 */
export function useRenderStream(
  projectId: string | null,
  enabled = true,
): RenderStreamState {
  const [state, setState] = useState<RenderStreamState>(INITIAL);
  // Keep the live EventSource out of render state so terminal-close in the
  // message handler doesn't fight React's lifecycle.
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Reset unconditionally so switching between two active projects never
    // shows the previous project's progress until the first event arrives.
    setState(INITIAL);
    if (!projectId || !enabled) return;

    const url = `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/render/subscribe`;
    const es = new EventSource(url);
    sourceRef.current = es;

    es.onopen = () => {
      setState((prev) => ({ ...prev, connected: true }));
    };

    es.onmessage = (ev) => {
      let event: RenderStreamEvent;
      try {
        event = JSON.parse(ev.data) as RenderStreamEvent;
      } catch {
        return;
      }
      const seq = ev.lastEventId ? Number.parseInt(ev.lastEventId, 10) : null;
      setState((prev) => ({
        connected: true,
        status: event.status ?? prev.status,
        progress: event.progress ?? prev.progress,
        message: event.message ?? prev.message,
        lastSeq: Number.isFinite(seq) ? seq : prev.lastSeq,
      }));
      // Terminal event — close so the browser doesn't auto-reconnect.
      if (isTerminal(event.type)) {
        es.close();
        sourceRef.current = null;
        setState((prev) => ({ ...prev, connected: false }));
      }
    };

    es.onerror = () => {
      // Network blip: native EventSource reconnects with Last-Event-ID.
      setState((prev) => ({ ...prev, connected: false }));
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [projectId, enabled]);

  return state;
}
