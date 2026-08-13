import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble';
import { API_BASE_URL } from '@/config';

export function useRunError(
  taskId: string | undefined,
  agent: {
    messages: unknown[];
    isRunning: boolean;
    abortRun: () => void;
  },
  agentRunFailedLabel: string,
) {
  const [runError, setRunError] = useState<string | null>(null);
  const agentRef = useRef(agent);
  agentRef.current = agent;

  // Listen for RUN_ERROR from the subscribe path (useThreadSync dispatches 'agui-run-error').
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ taskId: string; message: string }>)
        .detail;
      if (detail.taskId === taskId) {
        setRunError(detail.message);
        try {
          agentRef.current.abortRun();
        } catch {
          /* */
        }
      }
    };
    window.addEventListener('agui-run-error', handler);
    return () => window.removeEventListener('agui-run-error', handler);
  }, [taskId]);

  // Clear error when a new run starts or task switches
  useEffect(() => {
    if (agent.isRunning) setRunError(null);
  }, [agent.isRunning]);

  // ── Backend run-status watchdog ──
  // CopilotKit may not resolve runAgent() on RUN_ERROR, leaving isRunning=true
  // and the spinner stuck. Poll the backend to detect when the run actually
  // finished, then surface the error via the structured `isError` flag.
  const hasUserMessages = useMemo(
    () => (agent.messages as AGUIMessage[]).some((m) => m.role === 'user'),
    [agent.messages],
  );
  useEffect(() => {
    // Only poll when there's an active run with user messages — avoids
    // unnecessary requests on historical task pages.
    if (!taskId || runError || !hasUserMessages || !agent.isRunning) return;
    const ac = new AbortController();

    const poll = setInterval(async () => {
      if (ac.signal.aborted) return;
      try {
        const res = await fetch(`${API_BASE_URL}/ag-ui/history/${taskId}`, {
          signal: ac.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          isRunning?: boolean;
          messages?: Array<{
            role: string;
            content?: string;
            isError?: boolean;
            toolCalls?: unknown[];
          }>;
        };

        if (data.isRunning === false) {
          clearInterval(poll);

          // Check for structured error messages from the backend
          const errorMsg = data.messages?.find((m) => m.isError && m.content);
          // Tool-only runs (file writes, etc.) have assistant messages with
          // toolCalls but no text content — these are successful, not errors.
          const hasRealContent = data.messages?.some(
            (m) =>
              m.role === 'assistant' &&
              (m.content || m.toolCalls?.length) &&
              !m.isError,
          );

          if (errorMsg) {
            try {
              agentRef.current.abortRun();
            } catch {
              /* */
            }
            setRunError(errorMsg.content!);
          } else if (!hasRealContent) {
            try {
              agentRef.current.abortRun();
            } catch {
              /* */
            }
            setRunError(
              agentRunFailedLabel ??
                'The agent run completed without a response. Check the model configuration or try again.',
            );
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }, 2000);

    return () => {
      ac.abort();
      clearInterval(poll);
    };
  }, [taskId, runError, hasUserMessages, agent.isRunning, agentRunFailedLabel]);

  const clearRunError = useCallback(() => setRunError(null), []);

  return { runError, setRunError, clearRunError };
}
