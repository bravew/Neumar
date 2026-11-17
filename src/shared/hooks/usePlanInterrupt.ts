import {
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import type { Interrupt, ResumeEntry } from '@ag-ui/core';

import type {
  AGUIMessage,
  AGUIToolCall,
} from '@/components/task/TaskV2MessageBubble';
import { API_BASE_URL } from '@/config';
import { getSettings } from '@/shared/db/settings';
import type { TaskPlan } from '@/shared/hooks/agent-types';

/** A plan waiting for the user, with the interrupt id that answers it. */
export interface PendingPlanDecision {
  plan: TaskPlan;
  interrupt: Interrupt;
}

interface PlanAgent {
  messages: unknown[];
  isRunning: boolean;
  runAgent: (opts: {
    forwardedProps?: Record<string, unknown>;
    resume?: ResumeEntry[];
  }) => Promise<unknown> | void;
}

interface PendingPlanResponse {
  plan?: TaskPlan | null;
  interrupt?: Interrupt | null;
}

export function usePlanInterrupt(
  taskId: string | undefined,
  agent: PlanAgent,
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
  const [ownedDecision, setOwnedDecision] = useState<{
    taskId: string | undefined;
    decision: PendingPlanDecision | null;
  }>({ taskId, decision: null });
  const pendingDecision =
    ownedDecision.taskId === taskId ? ownedDecision.decision : null;
  const setPendingDecision = useCallback(
    (update: SetStateAction<PendingPlanDecision | null>) => {
      // Ignore completions belonging to a task that is no longer displayed.
      if (taskIdRef.current !== taskId) return;
      setOwnedDecision((previous) => {
        const decision = previous.taskId === taskId ? previous.decision : null;
        return {
          taskId,
          decision: typeof update === 'function' ? update(decision) : update,
        };
      });
    },
    [taskId],
  );
  // The in-flight answer belongs to the task that sent it, so switching tasks
  // hides it without a reset, and only that answer can clear it.
  const [inFlight, setInFlight] = useState<{
    taskId: string | undefined;
    submission: symbol;
  } | null>(null);
  const submitting = inFlight !== null && inFlight.taskId === taskId;
  const submittingRef = useRef<symbol | null>(null);
  const pendingPlan = pendingDecision?.plan ?? null;

  const fetchPendingDecision = useCallback(
    async (signal?: AbortSignal): Promise<PendingPlanDecision | null> => {
      if (!taskId) return null;
      const res = await fetch(`${API_BASE_URL}/ag-ui/pending-plan/${taskId}`, {
        signal,
      });
      if (!res.ok)
        throw new Error(`Pending plan request failed: ${res.status}`);
      const data = (await res.json()) as PendingPlanResponse;
      // Both halves are required: a plan without its interrupt id cannot
      // be answered without reconstructing the server's id format.
      return data.plan && data.interrupt
        ? { plan: data.plan, interrupt: data.interrupt }
        : null;
    },
    [taskId],
  );

  const submitDecision = useCallback(
    async (entry: Omit<ResumeEntry, 'interruptId'>) => {
      const decision = pendingDecision;
      if (!decision || submittingRef.current || taskIdRef.current !== taskId)
        return;
      const submission = Symbol();
      submittingRef.current = submission;
      setInFlight({ taskId, submission });
      const a = agentRef.current;
      const wd = workDirRef.current;
      const extraDirs = additionalWorkDirsRef.current;
      try {
        await Promise.resolve(
          a.runAgent({
            resume: [
              {
                interruptId: decision.interrupt.id,
                status: entry.status,
                ...(entry.payload === undefined
                  ? {}
                  : { payload: entry.payload }),
              },
            ],
            forwardedProps: {
              taskId,
              ...(wd ? { workDir: wd } : {}),
              ...(extraDirs?.length ? { additionalWorkDirs: extraDirs } : {}),
              ...(modelConfigRef.current
                ? { modelConfig: modelConfigRef.current }
                : {}),
            },
          }),
        );
      } catch {
        // The answer may have lost a race (already decided, expired, or a
        // newer plan). Re-read the server's record so the card reflects it.
        if (taskIdRef.current !== taskId) return;
        planRejectedRef.current = false;
        try {
          const next = await fetchPendingDecision();
          setPendingDecision(next);
        } catch {
          // A failed read does not mean the pending decision disappeared.
          setPendingDecision(decision);
        }
      } finally {
        if (submittingRef.current === submission) submittingRef.current = null;
        setInFlight((current) =>
          current?.submission === submission ? null : current,
        );
      }
    },
    [
      pendingDecision,
      taskId,
      setPendingDecision,
      workDirRef,
      additionalWorkDirsRef,
      modelConfigRef,
      fetchPendingDecision,
    ],
  );

  const handleApprovePlan = useCallback(() => {
    // Keep the plan visible during execution so the user can track progress.
    void submitDecision({ status: 'resolved', payload: { approved: true } });
  }, [submitDecision]);

  const markStepsCancelled = useCallback(() => {
    setPendingDecision((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        plan: {
          ...prev.plan,
          steps: prev.plan.steps.map((step) => ({
            ...step,
            status: 'cancelled' as const,
          })),
        },
      };
    });
  }, [setPendingDecision]);

  const handleRejectPlan = useCallback(() => {
    planRejectedRef.current = true;
    markStepsCancelled();
    void submitDecision({ status: 'resolved', payload: { approved: false } });
  }, [markStepsCancelled, submitDecision]);

  const handleCancelPlan = useCallback(() => {
    planRejectedRef.current = true;
    markStepsCancelled();
    void submitDecision({ status: 'cancelled' });
  }, [markStepsCancelled, submitDecision]);

  const autoExecuteRef = useRef(false);
  const executionStartedRef = useRef(false);

  // Reset guards before the polling and auto-approval effects for the new task.
  useEffect(() => {
    autoExecuteRef.current = false;
    planRejectedRef.current = false;
    executionStartedRef.current = false;
    submittingRef.current = null;
  }, [taskId]);

  // Poll for a pending plan while none is shown. Covers both the planning
  // run's completion and a reload, where the client has no live interrupt.
  useEffect(() => {
    if (!taskId || pendingDecision || planRejectedRef.current || runError) {
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const check = () => {
      void fetchPendingDecision(ac.signal)
        .then((decision) => {
          if (!cancelled && decision) setPendingDecision(decision);
        })
        .catch(() => {
          // Retry on the next poll; cancellation and read errors are not empty state.
        });
    };
    check();
    const id = setInterval(check, 3_000);
    return () => {
      cancelled = true;
      ac.abort();
      clearInterval(id);
    };
  }, [
    taskId,
    pendingDecision,
    runError,
    fetchPendingDecision,
    setPendingDecision,
  ]);

  // Auto-execute: if planMode === 'auto', approve immediately when plan appears
  useEffect(() => {
    if (!pendingDecision) return;
    const planMode = getSettings().planMode ?? 'on';
    if (planMode === 'auto' && !autoExecuteRef.current) {
      autoExecuteRef.current = true;
      // Small delay to let the plan card render before auto-approving
      const timer = setTimeout(handleApprovePlan, 800);
      return () => clearTimeout(timer);
    }
  }, [pendingDecision, handleApprovePlan]);

  // Update plan step progress based on tool call count in messages.
  // Uses functional setState to avoid pendingDecision in deps (prevents infinite loop).
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

    setPendingDecision((prev) => {
      if (!prev) return null;
      const totalSteps = prev.plan.steps.length;
      if (totalSteps === 0) return prev;
      const progressRatio = completedTools / Math.max(totalSteps * 2, 1);
      const completedSteps = Math.min(
        Math.floor(progressRatio * totalSteps),
        totalSteps - 1,
      );
      // Check if anything actually changed to avoid creating a new object
      const newStatuses = prev.plan.steps.map((_, i) =>
        i < completedSteps
          ? 'completed'
          : i === completedSteps
            ? 'in_progress'
            : 'pending',
      );
      const unchanged = prev.plan.steps.every(
        (s, i) => s.status === newStatuses[i] || s.status === 'cancelled',
      );
      if (unchanged) return prev;
      return {
        ...prev,
        plan: {
          ...prev.plan,
          steps: prev.plan.steps.map((step, i) => ({
            ...step,
            status:
              step.status === 'cancelled'
                ? ('cancelled' as const)
                : (newStatuses[i] as 'completed' | 'in_progress' | 'pending'),
          })),
        },
      };
    });
  }, [agent.isRunning, agent.messages.length, setPendingDecision]);

  // Mark all steps completed ONLY after execution actually ran and stopped
  useEffect(() => {
    if (agent.isRunning) return;
    if (!executionStartedRef.current) return;
    executionStartedRef.current = false; // Prevent re-firing

    setPendingDecision((prev) => {
      if (!prev) return null;
      const allDone = prev.plan.steps.every(
        (s) => s.status === 'completed' || s.status === 'cancelled',
      );
      if (allDone) return prev; // Already done, return same reference
      return {
        ...prev,
        plan: {
          ...prev.plan,
          steps: prev.plan.steps.map((s) => ({
            ...s,
            status:
              s.status === 'cancelled'
                ? ('cancelled' as const)
                : ('completed' as const),
          })),
        },
      };
    });
  }, [agent.isRunning, setPendingDecision]);

  return {
    pendingPlan,
    pendingDecision,
    setPendingDecision,
    planRejectedRef,
    submitting,
    handleApprovePlan,
    handleRejectPlan,
    handleCancelPlan,
  };
}
