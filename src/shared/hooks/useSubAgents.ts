/**
 * useSubAgents — Track sub-agent lifecycle from step_started/step_finished events.
 *
 * Subscribes to the shared task event bus SSE and derives sub-agent state from
 * the SDK task lifecycle messages (task_started → task_notification).
 */

import { useEffect, useState } from 'react';

import type { SubAgentState } from '@/components/task/SubAgentPanel';

import { useTaskEventSource } from './useTaskEventSource';

export function useSubAgents(taskId: string | undefined, isRunning: boolean) {
  const [subAgents, setSubAgents] = useState<SubAgentState[]>([]);

  // Reset sub-agents when task changes
  useEffect(() => {
    setSubAgents([]);
  }, [taskId]);

  // Subscribe to task event bus via shared SSE connection
  useTaskEventSource(taskId, isRunning, (msg) => {
    if (msg.type === 'step_started' && msg.id) {
      setSubAgents((prev) => {
        if (prev.some((a) => a.id === msg.id)) return prev;
        return [
          ...prev,
          {
            id: msg.id as string,
            name: (msg.stepName as string) ?? '',
            status: 'running',
            startedAt: Date.now(),
            parentToolUseId: msg.parentToolUseId as string | undefined,
          },
        ];
      });
    }

    if (msg.type === 'step_finished' && msg.id) {
      const usage = msg.usage as
        | { input_tokens?: number; output_tokens?: number }
        | undefined;
      setSubAgents((prev) =>
        prev.map((a) =>
          a.id === msg.id
            ? {
                ...a,
                status:
                  msg.subtype === 'error' || msg.subtype === 'failure'
                    ? 'failed'
                    : 'completed',
                completedAt: Date.now(),
                durationMs: msg.duration as number | undefined,
                totalTokens:
                  (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
              }
            : a,
        ),
      );
    }
  });

  // Clear sub-agents when run ends
  useEffect(() => {
    if (!isRunning) {
      setSubAgents((prev) =>
        prev.map((a) =>
          a.status === 'running'
            ? { ...a, status: 'completed', completedAt: Date.now() }
            : a,
        ),
      );
    }
  }, [isRunning]);

  return subAgents;
}
