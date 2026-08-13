/**
 * Automation Events Hook
 *
 * Connects to the backend SSE endpoint for real-time automation events.
 * Provides a stream of events (run completions, failures, lifecycle changes)
 * that components can subscribe to for toast notifications and UI updates.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';

// ============================================================================
// Types
// ============================================================================

export interface AutomationEvent {
  event: string;
  automationId?: string;
  runId?: string;
  data?: {
    name?: string;
    status?: string;
    result?: string;
    error?: string;
    durationMs?: number;
    cost?: number;
    reason?: string;
    message?: string;
    origin?: string;
  };
  timestamp: string;
}

export type AutomationEventHandler = (event: AutomationEvent) => void;

/** SSE event types to subscribe to */
const EVENT_TYPES = [
  'run:completed',
  'run:failed',
  'run:cancelled',
  'run:delivery_suppressed',
  'run:condition_not_met',
  'automation:expired',
  'automation:budget_exhausted',
  'automation:max_runs_reached',
  'automation:consecutive_failures',
];

// ============================================================================
// Hook
// ============================================================================

/**
 * Subscribe to real-time automation events via SSE.
 *
 * Returns the latest event and a list of recent events (for notification display).
 * Automatically reconnects on disconnect with exponential backoff.
 */
export function useAutomationEvents(onEvent?: AutomationEventHandler): {
  connected: boolean;
  recentEvents: AutomationEvent[];
  clearEvents: () => void;
} {
  const [connected, setConnected] = useState(false);
  const [recentEvents, setRecentEvents] = useState<AutomationEvent[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const handleEventRef = useRef<((e: MessageEvent) => void) | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reconnectDelayRef = useRef(1000);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  /** Remove all named event listeners and close the EventSource */
  const cleanup = useCallback(
    (es: EventSource, handler: (e: MessageEvent) => void) => {
      for (const eventType of EVENT_TYPES) {
        es.removeEventListener(eventType, handler);
      }
      es.close();
    },
    [],
  );

  const connect = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current && handleEventRef.current) {
      cleanup(eventSourceRef.current, handleEventRef.current);
    }

    const es = new EventSource(`${API_BASE_URL}/automation/events`);
    eventSourceRef.current = es;

    // Shared handler for all event types — stored in ref for cleanup
    const handleEvent = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as AutomationEvent;
        setRecentEvents((prev) => [parsed, ...prev].slice(0, 20));
        onEventRef.current?.(parsed);
      } catch {
        // Ignore malformed events
      }
    };
    handleEventRef.current = handleEvent;

    es.onopen = () => {
      setConnected(true);
      reconnectDelayRef.current = 1000;
    };

    es.onerror = () => {
      setConnected(false);
      cleanup(es, handleEvent);
      eventSourceRef.current = null;
      handleEventRef.current = null;

      // Reconnect with exponential backoff (max 30s)
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, 30_000);
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    for (const eventType of EVENT_TYPES) {
      es.addEventListener(eventType, handleEvent);
    }
  }, [cleanup]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current && handleEventRef.current) {
        cleanup(eventSourceRef.current, handleEventRef.current);
        eventSourceRef.current = null;
        handleEventRef.current = null;
      }
    };
  }, [connect, cleanup]);

  const clearEvents = useCallback(() => {
    setRecentEvents([]);
  }, []);

  return { connected, recentEvents, clearEvents };
}
