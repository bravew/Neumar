import { useEffect, useRef } from 'react';

import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble';
import { API_BASE_URL } from '@/config';
import { getTask } from '@/shared/db';
import { autoGenerateTitle } from '@/shared/hooks/agent-title';
import type { TaskPlan } from '@/shared/hooks/agent-types';
import { getTaskMessages } from '@/shared/hooks/agent-utils';
import { notifyAgentEvent } from '@/shared/lib/notifications';

export function usePostRunEffects(
  taskId: string | undefined,
  agent: {
    messages: unknown[];
    isRunning: boolean;
  },
  planRejectedRef: React.RefObject<boolean>,
  setPendingPlan: React.Dispatch<React.SetStateAction<TaskPlan | null>>,
  runErrorRef?: React.RefObject<string | null>,
) {
  const agentRef = useRef(agent);
  agentRef.current = agent;

  // Post-run effects: title generation (once), notification (every run),
  // file extraction dispatch, and pending plan check.
  // Detects running → idle transition.
  const titleGeneratedRef = useRef(false);
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (agent.isRunning) {
      wasRunningRef.current = true;
      // Don't clear pendingPlan here — keep plan visible during execution
      planRejectedRef.current = false;
      return;
    }
    // Only fire on running → idle transition
    if (!wasRunningRef.current || !taskId) return;
    wasRunningRef.current = false;

    const a = agentRef.current;
    const msgs = a.messages as AGUIMessage[];

    // ── Title generation (first run only) ──
    if (!titleGeneratedRef.current) {
      titleGeneratedRef.current = true;
      const userMsg = msgs.find((m) => m.role === 'user');
      const assistantMsg = msgs.find(
        (m) => m.role === 'assistant' && m.content,
      );
      if (userMsg?.content) {
        autoGenerateTitle(
          taskId,
          userMsg.content,
          assistantMsg?.content?.slice(0, 300),
          (title) => {
            window.dispatchEvent(
              new CustomEvent('task-title-updated', {
                detail: { taskId, title },
              }),
            );
          },
        );
      }
    }

    // ── Task completion notification ──
    const taskT = getTaskMessages();
    const notificationAc = new AbortController();
    const directError = runErrorRef?.current;
    getTask(taskId)
      .then(async (task) => {
        if (!task || notificationAc.signal.aborted) return;
        const label =
          task.title ||
          task.prompt?.slice(0, 60) ||
          taskT.notificationTaskDefault;
        const lastUserIndex = msgs.map((m) => m.role).lastIndexOf('user');
        let errorMessage =
          directError ||
          msgs.slice(lastUserIndex + 1).find((m) => m.isError && m.content)
            ?.content;
        // RUN_ERROR is a terminal event, not a CopilotKit text message. Read
        // its persisted message if the live subscriber did not receive it.
        if (!errorMessage && task.status === 'error') {
          try {
            const response = await fetch(
              `${API_BASE_URL}/ag-ui/history/${taskId}`,
              {
                signal: notificationAc.signal,
              },
            );
            if (response.ok) {
              const history = (await response.json()) as {
                messages?: AGUIMessage[];
              };
              const messages = history.messages ?? [];
              const userIndex = messages.map((m) => m.role).lastIndexOf('user');
              errorMessage = messages
                .slice(userIndex + 1)
                .find((m) => m.isError && m.content)?.content;
            }
          } catch {
            // The notification still reports failure if history is unavailable.
          }
        }
        if (notificationAc.signal.aborted) return;
        const failed = task.status === 'error' || !!errorMessage;
        void notifyAgentEvent({
          runId: taskId,
          kind: failed ? 'failed' : 'succeeded',
          title: failed
            ? taskT.notificationTaskFailed
            : taskT.notificationTaskCompleted,
          body: failed ? errorMessage || taskT.agentRunFailed : label,
          link: `/task-v2/${taskId}`,
          source: 'agent-stream',
        });
      })
      .catch(() => {});

    // ── File extraction: tell artifact panel to refresh ──
    window.dispatchEvent(new CustomEvent('task-files-updated'));

    // ── Check for pending plan (planning phase just completed) ──
    const planAc = new AbortController();
    fetch(`${API_BASE_URL}/ag-ui/pending-plan/${taskId}`, {
      signal: planAc.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { plan: TaskPlan } | null) => {
        if (data?.plan) setPendingPlan(data.plan);
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
      });

    return () => {
      notificationAc.abort();
      planAc.abort();
    };
  }, [agent.isRunning, taskId, planRejectedRef, setPendingPlan, runErrorRef]);
}
