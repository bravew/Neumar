/**
 * useThreadSync — Direct SSE subscription for live run reconnection.
 *
 * When a task has an active run and the user navigates back to it,
 * this hook connects to /ag-ui/subscribe/:taskId to receive live events
 * and updates the Zustand thread store accordingly.
 */

import { useEffect, useRef } from 'react';

import { API_BASE_URL } from '@/config';
import { useThreadStore } from '@/shared/stores/thread-store';
import type {
  AGUIStreamEvent,
  TaskFile,
  ThreadMessage,
} from '@/shared/stores/thread-store';

interface SSEEvent extends AGUIStreamEvent {
  messages?: ThreadMessage[];
  files?: TaskFile[];
  message?: string;
  parentMessageId?: string;
}

/**
 * Subscribe to a live AG-UI SSE stream for the given taskId.
 * Connects optimistically; the backend 404 is the authoritative no-run signal.
 * Updates the Zustand thread store with incoming events.
 */
export function useThreadSync(taskId: string | undefined): void {
  const setRunning = useThreadStore((s) => s.setRunning);
  const hydrateFromDB = useThreadStore((s) => s.hydrateFromDB);
  const applyAGUIEvent = useThreadStore((s) => s.applyAGUIEvent);
  const lastSeqRef = useRef(-1);

  useEffect(() => {
    if (!taskId) return;

    const ctrl = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    lastSeqRef.current =
      useThreadStore.getState().threads[taskId]?.lastAppliedSeq ?? -1;

    const scheduleRetry = () => {
      retryTimer = setTimeout(() => void subscribe(1), 500);
    };

    const subscribe = async (attempt: number) => {
      try {
        const headers: Record<string, string> = {};
        if (lastSeqRef.current >= 0) {
          headers['Last-Event-ID'] = String(lastSeqRef.current);
        }
        const response = await fetch(
          `${API_BASE_URL}/ag-ui/subscribe/${taskId}`,
          { headers, signal: ctrl.signal },
        );
        if (!response.ok || !response.body) {
          // 404 means no active run exists — update Zustand so the UI
          // stops showing the pulsing "running" indicator.
          if (response.status === 404) {
            setRunning(taskId, false);
          } else if (attempt === 0 && !ctrl.signal.aborted) {
            scheduleRetry();
          }
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done || ctrl.signal.aborted) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6)) as SSEEvent;

              // Handle MESSAGES_SNAPSHOT — full state reset
              if (event.type === 'MESSAGES_SNAPSHOT' && event.messages) {
                const snapshotSeq =
                  event.seq !== undefined
                    ? Math.max(event.seq, lastSeqRef.current)
                    : lastSeqRef.current;
                hydrateFromDB(taskId, event.messages, true, {
                  lastAppliedSeq: snapshotSeq,
                  files: event.files,
                });
                lastSeqRef.current = snapshotSeq;
                continue;
              }

              // Deduplicate by seq (monotonic counter from AGUIEmitter)
              if (event.seq !== undefined && event.seq <= lastSeqRef.current) {
                continue;
              }
              if (event.seq !== undefined) {
                lastSeqRef.current = event.seq;
              }

              // Terminal events
              if (event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR') {
                applyAGUIEvent(taskId, event);
                if (event.type === 'RUN_ERROR' && event.message) {
                  window.dispatchEvent(
                    new CustomEvent('agui-run-error', {
                      detail: { taskId, message: event.message },
                    }),
                  );
                }
                setRunning(taskId, false);
                reader.cancel();
                return;
              }

              // Incremental events — fold into the thread-store so reconnected
              // viewers see tool calls, tool results, and streaming text live.
              // Before this, every non-snapshot/terminal event was silently
              // dropped, making the UI look frozen during active runs.
              applyAGUIEvent(taskId, event);
            } catch {
              // Ignore SSE parse errors
            }
          }
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        if (attempt === 0 && !ctrl.signal.aborted) {
          scheduleRetry();
          return;
        }
        if (import.meta.env.DEV) {
          console.warn('[useThreadSync] SSE subscription error:', error);
        }
      } finally {
        // Don't unconditionally mark as stopped — RUN_FINISHED/RUN_ERROR handlers
        // already call setRunning(false). Marking here on transient network errors
        // would incorrectly show a still-running task as stopped.
      }
    };

    void subscribe(0);

    return () => {
      ctrl.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [taskId, setRunning, hydrateFromDB, applyAGUIEvent]);
}
