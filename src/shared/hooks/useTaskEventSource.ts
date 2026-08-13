/**
 * useTaskEventSource — Shared SSE connection for task event bus.
 *
 * Manages a single EventSource per (taskId) so that multiple consumers
 * (usePermissionRequests, useSubAgents, useRateLimit, etc.) share one
 * connection instead of each opening their own.
 *
 * Uses a module-level registry to ref-count connections. The EventSource
 * is created when the first subscriber registers and closed when the last
 * subscriber unregisters.
 */

import { useEffect, useRef } from 'react';

import { API_BASE_URL } from '@/config';

export type TaskEventHandler = (msg: Record<string, unknown>) => void;

interface SharedConnection {
  es: EventSource;
  handlers: Set<TaskEventHandler>;
}

const connections = new Map<string, SharedConnection>();

function subscribe(taskId: string, handler: TaskEventHandler): () => void {
  let conn = connections.get(taskId);
  if (!conn) {
    const es = new EventSource(`${API_BASE_URL}/agent/subscribe/${taskId}`);
    conn = { es, handlers: new Set() };
    const captured = conn;
    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        for (const h of captured.handlers) h(msg);
      } catch {
        // Ignore parse errors
      }
    };
    connections.set(taskId, conn);
  }
  conn.handlers.add(handler);

  return () => {
    const c = connections.get(taskId);
    if (!c) return;
    c.handlers.delete(handler);
    if (c.handlers.size === 0) {
      c.es.close();
      connections.delete(taskId);
    }
  };
}

export function useTaskEventSource(
  taskId: string | undefined,
  isRunning: boolean,
  onMessage: TaskEventHandler,
) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!taskId || !isRunning) return;

    // Stable wrapper so handler identity doesn't cause re-subscribes
    const stableHandler: TaskEventHandler = (msg) => handlerRef.current(msg);
    return subscribe(taskId, stableHandler);
  }, [taskId, isRunning]);
}
