/**
 * useSubAgents — the sub-agents of a task, for the supervision panel.
 *
 * Real sub-agent invocations come from the thread store, which the AG-UI
 * SUBAGENT_* events and the saved history both feed, so they survive a reload
 * and carry their result, error, and nesting. Step events from the shared task
 * event bus still cover other SDK tasks (background shells, workflows) that
 * have no invocation of their own; an invocation wins when both name one id.
 */

import { useEffect, useMemo, useState } from 'react';

import type { SubAgentState } from '@/components/task/SubAgentPanel';
import { useThreadStore } from '@/shared/stores/thread-store';
import type { ThreadSubagent } from '@/shared/stores/thread-store';

import { useTaskEventSource } from './useTaskEventSource';

/** Stop code the server records when the user cancels a sub-agent. */
const STOPPED_CODE = 'stopped';

const NO_SUBAGENTS: ThreadSubagent[] = [];

export function toSubAgentState(agent: ThreadSubagent): SubAgentState {
  const startedAt = agent.startedAt ?? agent.endedAt ?? Date.now();
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    status:
      agent.status === 'error'
        ? agent.error?.code === STOPPED_CODE
          ? 'cancelled'
          : 'failed'
        : agent.status,
    startedAt,
    completedAt: agent.endedAt,
    parentToolUseId: agent.parentToolCallId,
    parentSubagentRunId: agent.parentSubagentRunId,
    result: agent.result,
    errorMessage: agent.error?.message,
  };
}

/** Invocations first, then step-only tasks the store does not know. */
export function mergeSubAgents(
  recorded: ThreadSubagent[],
  steps: SubAgentState[],
): SubAgentState[] {
  const known = new Set(recorded.map((a) => a.id));
  return [
    ...recorded.map(toSubAgentState),
    ...steps.filter((a) => !known.has(a.id)),
  ];
}

export function useSubAgents(taskId: string | undefined, isRunning: boolean) {
  const [steps, setSteps] = useState<SubAgentState[]>([]);
  const recorded = useThreadStore((s) =>
    taskId ? (s.threads[taskId]?.subagents ?? NO_SUBAGENTS) : NO_SUBAGENTS,
  );

  // Reset sub-agents when task changes
  useEffect(() => {
    setSteps([]);
  }, [taskId]);

  // Subscribe to task event bus via shared SSE connection
  useTaskEventSource(taskId, isRunning, (msg) => {
    if (msg.type === 'step_started' && msg.id) {
      setSteps((prev) => {
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
      setSteps((prev) =>
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
      setSteps((prev) =>
        prev.map((a) =>
          a.status === 'running'
            ? { ...a, status: 'completed', completedAt: Date.now() }
            : a,
        ),
      );
    }
  }, [isRunning]);

  return useMemo(() => mergeSubAgents(recorded, steps), [recorded, steps]);
}
