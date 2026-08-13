import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

interface RateLimitState {
  active: boolean;
  resetsAt?: number; // Unix timestamp in ms
  message?: string;
}

/**
 * Subscribes to rate_limit system events via SSE when the agent is running.
 * Returns rate limit state for the RateLimitIndicator component.
 */
export function useRateLimit(
  taskId: string | undefined,
  isRunning: boolean,
): {
  rateLimitActive: boolean;
  retryAfterMs: number;
  dismissRateLimit: () => void;
} {
  const [state, setState] = useState<RateLimitState>({ active: false });

  useEffect(() => {
    if (!taskId || !isRunning) {
      // Clear rate limit when not running
      setState({ active: false });
      return;
    }

    const es = new EventSource(
      `${API_BASE_URL}/ag-ui/events/${taskId}?types=system`,
    );

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'system' && data.subtype === 'rate_limit') {
          // Parse resetsAt from message if present
          const resetsAtMatch = data.content?.match(
            /resets at (\d{1,2}:\d{2}:\d{2}\s*[AP]M)/i,
          );
          const resetsAt = resetsAtMatch
            ? new Date(
                `${new Date().toDateString()} ${resetsAtMatch[1]}`,
              ).getTime()
            : Date.now() + 60_000; // Default 60s if no reset time

          setState({
            active: true,
            resetsAt,
            message: data.content,
          });
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      // SSE reconnects automatically
    };

    return () => {
      es.close();
    };
  }, [taskId, isRunning]);

  const dismissRateLimit = useCallback(() => {
    setState({ active: false });
  }, []);

  const retryAfterMs = state.resetsAt
    ? Math.max(0, state.resetsAt - Date.now())
    : 0;

  return {
    rateLimitActive: state.active && retryAfterMs > 0,
    retryAfterMs,
    dismissRateLimit,
  };
}
