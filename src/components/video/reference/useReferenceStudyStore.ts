import { create } from 'zustand';

import type { VideoReferenceRun } from '@/shared/types/video';

/**
 * Shared Analyze-video state between the right-hand Reference tab and the
 * left-hand chat dock.
 *
 * The two panels are siblings in the editor tree, but a reference run spans
 * both: the panel starts it and owns the system steps, while `read` and
 * `extract` are agent-owned and only the chat can finish them. This store is
 * the seam — the panel publishes run state and a handoff request, the dock
 * consumes the request and reports the reference it is working on.
 */
export interface ReferenceHandoffRequest {
  referenceId: string;
  label: string;
  focus?: string;
  /** Distinguishes repeat Analyze clicks on the same reference. */
  nonce: number;
}

interface ReferenceStudyState {
  projectId: string | null;
  /** Reference the user last acted on — forwarded to the agent as context. */
  activeReferenceId: string | null;
  runs: Record<string, VideoReferenceRun>;
  handoff: ReferenceHandoffRequest | null;
  /** Mirrors the chat dock's stream state so the panel can re-read a run the
   * agent just advanced. */
  agentStreaming: boolean;
  syncProject: (projectId: string) => void;
  setAgentStreaming: (streaming: boolean) => void;
  setActiveReference: (referenceId: string | null) => void;
  setRun: (run: VideoReferenceRun) => void;
  forgetReference: (referenceId: string) => void;
  requestHandoff: (input: Omit<ReferenceHandoffRequest, 'nonce'>) => void;
  clearHandoff: () => void;
}

const EMPTY_RUNS: Record<string, VideoReferenceRun> = {};

export const useReferenceStudyStore = create<ReferenceStudyState>(
  (set, get) => ({
    projectId: null,
    activeReferenceId: null,
    runs: EMPTY_RUNS,
    handoff: null,
    agentStreaming: false,
    syncProject: (projectId) => {
      if (get().projectId === projectId) return;
      set({
        projectId,
        activeReferenceId: null,
        runs: EMPTY_RUNS,
        handoff: null,
      });
    },
    setAgentStreaming: (agentStreaming) => set({ agentStreaming }),
    setActiveReference: (activeReferenceId) => set({ activeReferenceId }),
    setRun: (run) =>
      set((state) => ({
        runs: { ...state.runs, [run.referenceId]: run },
      })),
    forgetReference: (referenceId) =>
      set((state) => {
        const { [referenceId]: removed, ...runs } = state.runs;
        void removed;
        return {
          runs,
          activeReferenceId:
            state.activeReferenceId === referenceId
              ? null
              : state.activeReferenceId,
          handoff:
            state.handoff?.referenceId === referenceId ? null : state.handoff,
        };
      }),
    requestHandoff: (input) =>
      set((state) => ({
        activeReferenceId: input.referenceId,
        handoff: { ...input, nonce: (state.handoff?.nonce ?? 0) + 1 },
      })),
    clearHandoff: () => set({ handoff: null }),
  }),
);

/** Steps the pipeline parks for the chat agent to finish. */
export function pendingAgentSteps(run: VideoReferenceRun): string[] {
  return run.steps
    .filter(
      (step) =>
        step.owner === 'agent' &&
        step.status !== 'done' &&
        step.status !== 'cancelled',
    )
    .map((step) => step.id);
}

/**
 * True once every system-owned step has settled, so the evidence the agent
 * needs is on disk. Handing off before this point would have the agent read a
 * reference that has not been sampled yet.
 */
export function systemStepsSettled(run: VideoReferenceRun): boolean {
  return run.steps
    .filter((step) => step.owner === 'system')
    .every(
      (step) =>
        step.status === 'done' ||
        step.status === 'skipped' ||
        step.status === 'error',
    );
}

export function runIsActive(run: VideoReferenceRun | undefined): boolean {
  return run?.status === 'running' || run?.status === 'queued';
}

export function completedStepCount(run: VideoReferenceRun): number {
  return run.steps.filter(
    (step) => step.status === 'done' || step.status === 'skipped',
  ).length;
}

export function currentStep(run: VideoReferenceRun) {
  return (
    run.steps.find((step) => step.status === 'running') ??
    run.steps.find((step) => step.status === 'error') ??
    run.steps.find((step) => step.status === 'queued') ??
    null
  );
}
