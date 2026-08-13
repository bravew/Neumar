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
    getTask(taskId)
      .then((task) => {
        if (!task) return;
        const label =
          task.title ||
          task.prompt?.slice(0, 60) ||
          taskT.notificationTaskDefault;
        const failed = task.status === 'error';
        void notifyAgentEvent({
          runId: taskId,
          kind: failed ? 'failed' : 'succeeded',
          title: failed
            ? taskT.notificationTaskFailed
            : taskT.notificationTaskCompleted,
          body: label,
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
      planAc.abort();
    };
  }, [agent.isRunning, taskId, planRejectedRef, setPendingPlan]);
}
