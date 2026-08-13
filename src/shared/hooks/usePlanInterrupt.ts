import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AGUIMessage,
  AGUIToolCall,
} from '@/components/task/TaskV2MessageBubble';
import { API_BASE_URL } from '@/config';
import { getSettings } from '@/shared/db/settings';
import type { TaskPlan } from '@/shared/hooks/agent-types';

export function usePlanInterrupt(
  taskId: string | undefined,
  agent: {
    messages: unknown[];
    isRunning: boolean;
    runAgent: (opts: { forwardedProps: Record<string, unknown> }) => void;
  },
  runError: string | null,
  workDirRef: React.RefObject<string | undefined>,
  additionalWorkDirsRef: React.RefObject<string[] | undefined>,
  modelConfigRef: React.RefObject<Record<string, unknown> | undefined>,
) {
  const agentRef = useRef(agent);
  agentRef.current = agent;

  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

  const planRejectedRef = useRef(false);
  const [pendingPlan, setPendingPlan] = useState<TaskPlan | null>(null);

  const handleApprovePlan = useCallback(() => {
    if (!taskIdRef.current) return;
    // Don't clear pendingPlan — keep it visible during execution
    // so the user can track plan progress. It will be cleared on next task switch.
    const a = agentRef.current;
    const wd = workDirRef.current;
    const extraDirs = additionalWorkDirsRef.current;
    a.runAgent({
      forwardedProps: {
        command: { resume: { approved: true } },
        taskId: taskIdRef.current,
        ...(wd ? { workDir: wd } : {}),
        ...(extraDirs?.length ? { additionalWorkDirs: extraDirs } : {}),
        ...(modelConfigRef.current
          ? { modelConfig: modelConfigRef.current }
          : {}),
      },
    });
  }, [workDirRef, additionalWorkDirsRef, modelConfigRef]);

  const handleRejectPlan = useCallback(() => {
    // Keep plan visible in cancelled state (don't remove it)
    setPendingPlan((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        steps: prev.steps.map((s) => ({ ...s, status: 'cancelled' as const })),
      };
    });
    // Stop polling by marking as rejected
    planRejectedRef.current = true;
    // Mark plan as rejected in DB so the poll doesn't resurface it
    if (taskIdRef.current) {
      fetch(`${API_BASE_URL}/ag-ui/reject-plan/${taskIdRef.current}`, {
        method: 'POST',
      }).catch(() => {});
    }
  }, []);

  // Poll for pending plan every 3s while no plan is shown.
  // Catches plans from planning phase regardless of agent.isRunning timing.
  useEffect(() => {
    if (!taskId || pendingPlan || planRejectedRef.current || runError) return;
    const ac = new AbortController();
    const check = () => {
      fetch(`${API_BASE_URL}/ag-ui/pending-plan/${taskId}`, {
        signal: ac.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { plan: TaskPlan } | null) => {
          if (data?.plan) setPendingPlan(data.plan);
        })
        .catch((err) => {
          if ((err as Error).name === 'AbortError') return;
        });
    };
    // Check immediately + poll
    check();
    const id = setInterval(check, 3_000);
    return () => {
      ac.abort();
      clearInterval(id);
    };
  }, [taskId, pendingPlan, runError]);

  // Auto-execute: if planMode === 'auto', approve immediately when plan appears
  const autoExecuteRef = useRef(false);
  useEffect(() => {
    if (!pendingPlan) return;
    const planMode = getSettings().planMode ?? 'on';
    if (planMode === 'auto' && !autoExecuteRef.current) {
      autoExecuteRef.current = true;
      // Small delay to let the plan card render before auto-approving
      const timer = setTimeout(handleApprovePlan, 800);
      return () => clearTimeout(timer);
    }
  }, [pendingPlan, handleApprovePlan]);

  // Track whether execution phase has started (after plan approval)
  const executionStartedRef = useRef(false);

  // Reset guards on task switch
  useEffect(() => {
    autoExecuteRef.current = false;
    planRejectedRef.current = false;
    executionStartedRef.current = false;
  }, [taskId]);

  // Update plan step progress based on tool call count in messages.
  // Uses functional setState to avoid pendingPlan in deps (prevents infinite loop).
  useEffect(() => {
    if (!agent.isRunning) return;
    executionStartedRef.current = true;

    const msgs = agentRef.current.messages as AGUIMessage[];
    const toolCalls = msgs.flatMap(
      (m) => (m as { toolCalls?: AGUIToolCall[] }).toolCalls ?? [],
    );
    const completedTools = toolCalls.filter((tc) =>
      msgs.some(
        (m) =>
          m.role === 'tool' &&
          (m as { toolCallId?: string }).toolCallId === tc.id,
      ),
    ).length;

    setPendingPlan((prev) => {
      if (!prev) return null;
      const totalSteps = prev.steps.length;
      if (totalSteps === 0) return prev;
      const progressRatio = completedTools / Math.max(totalSteps * 2, 1);
      const completedSteps = Math.min(
        Math.floor(progressRatio * totalSteps),
        totalSteps - 1,
      );
      // Check if anything actually changed to avoid creating a new object
      const newStatuses = prev.steps.map((_, i) =>
        i < completedSteps
          ? 'completed'
          : i === completedSteps
            ? 'in_progress'
            : 'pending',
      );
      const unchanged = prev.steps.every(
        (s, i) => s.status === newStatuses[i] || s.status === 'cancelled',
      );
      if (unchanged) return prev;
      return {
        ...prev,
        steps: prev.steps.map((step, i) => ({
          ...step,
          status:
            step.status === 'cancelled'
              ? ('cancelled' as const)
              : (newStatuses[i] as 'completed' | 'in_progress' | 'pending'),
        })),
      };
    });
  }, [agent.isRunning, agent.messages.length]);

  // Mark all steps completed ONLY after execution actually ran and stopped
  useEffect(() => {
    if (agent.isRunning) return;
    if (!executionStartedRef.current) return;
    executionStartedRef.current = false; // Prevent re-firing

    setPendingPlan((prev) => {
      if (!prev) return null;
      const allDone = prev.steps.every(
        (s) => s.status === 'completed' || s.status === 'cancelled',
      );
      if (allDone) return prev; // Already done, return same reference
      return {
        ...prev,
        steps: prev.steps.map((s) => ({
          ...s,
          status:
            s.status === 'cancelled'
              ? ('cancelled' as const)
              : ('completed' as const),
        })),
      };
    });
  }, [agent.isRunning]);

  return {
    pendingPlan,
    setPendingPlan,
    planRejectedRef,
    handleApprovePlan,
    handleRejectPlan,
  };
}
