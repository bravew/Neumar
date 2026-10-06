import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AgentSubscriber } from '@ag-ui/client';

import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble';
import { API_BASE_URL } from '@/config';

export function useRunError(
  taskId: string | undefined,
  agent: {
    messages: unknown[];
    isRunning: boolean;
    abortRun: () => void;
    subscribe?: (subscriber: AgentSubscriber) => { unsubscribe: () => void };
  },
  agentRunFailedLabel: string,
) {
  const [runError, setRunErrorState] = useState<string | null>(null);
  // Terminal callbacks can run before React renders the idle transition.
  const runErrorRef = useRef<string | null>(null);
  const setRunError = useCallback((message: string | null) => {
    runErrorRef.current = message;
    setRunErrorState(message);
  }, []);
  const agentRef = useRef(agent);
  agentRef.current = agent;

  useEffect(() => {
    const subscription = agent.subscribe?.({
      onRunStartedEvent: () => setRunError(null),
      onRunErrorEvent: ({ event }) => setRunError(event.message),
      onRunFailed: ({ error }) => {
        if (!runErrorRef.current) setRunError(error.message);
      },
    });
    return () => subscription?.unsubscribe();
  }, [agent, setRunError]);

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
  }, [taskId, setRunError]);

  useEffect(() => {
    setRunError(null);
  }, [taskId, setRunError]);

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
          taskStatus?: 'running' | 'completed' | 'error' | 'stopped';
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
          const lastUserIndex =
            data.messages?.map((m) => m.role).lastIndexOf('user') ?? -1;
          const currentRunMessages = data.messages?.slice(lastUserIndex + 1);
          const errorMsg = currentRunMessages?.find(
            (m) => m.isError && m.content,
          );
          // Tool-only runs (file writes, etc.) have assistant messages with
          // toolCalls but no text content — these are successful, not errors.
          const hasRealContent = currentRunMessages?.some(
            (m) =>
              m.role === 'assistant' &&
              (m.content || m.toolCalls?.length) &&
              !m.isError,
          );

          if (errorMsg || data.taskStatus === 'error') {
            try {
              agentRef.current.abortRun();
            } catch {
              /* */
            }
            setRunError(errorMsg?.content || agentRunFailedLabel);
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
  }, [
    taskId,
    runError,
    hasUserMessages,
    agent.isRunning,
    agentRunFailedLabel,
    setRunError,
  ]);

  const clearRunError = useCallback(() => setRunError(null), [setRunError]);

  return { runError, runErrorRef, setRunError, clearRunError };
}
