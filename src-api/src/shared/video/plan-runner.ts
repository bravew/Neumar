import { readVideoAgentPlan } from './agent-plan';
import {
  expectedProjectRevisionForPlan,
  readVideoExecutionLog,
  type VideoExecutionLogRecord,
} from './execution-log';
import { getProject } from './store';
import type { VideoAgentPlanStep } from './types';

export interface VideoPlanResumeState {
  status: 'ready' | 'complete' | 'paused';
  planId: string;
  planRevision: number;
  projectRevision: number;
  expectedProjectRevision: number;
  completedStepIds: string[];
  nextStep?: VideoAgentPlanStep;
  reason?: string;
  uncertainOperations: Array<{
    stepId: string;
    operation: string;
    attempt: number;
  }>;
}

export async function getVideoPlanResumeState(
  projectId: string,
): Promise<VideoPlanResumeState> {
  const project = await getProject(projectId);
  const planRead = await readVideoAgentPlan(projectId);
  const plan = planRead.plan;
  if (!plan) throw new Error('Video agent plan not found');
  if (planRead.drifted) {
    return paused(
      project.revision,
      plan,
      'agent/plan.md differs from the canonical plan',
    );
  }
  if (!['active', 'executing', 'paused', 'completed'].includes(plan.status)) {
    return paused(project.revision, plan, `plan status is ${plan.status}`);
  }
  const records = (await readVideoExecutionLog(projectId)).filter(
    (record) =>
      record.planId === plan.id && record.planRevision === plan.revision,
  );
  const completedStepIds = plan.steps
    .filter((step) => stepCompleted(step, records, project))
    .map((step) => step.id);
  // No landed step yet means nothing to conflict with; the project's current
  // revision is trivially the expected one.
  const expectedProjectRevision =
    expectedProjectRevisionForPlan(plan, records) ?? project.revision;
  const uncertainOperations = records
    .filter(
      (record) =>
        record.phase === 'started' &&
        !records.some(
          (candidate) =>
            candidate.sequence > record.sequence &&
            candidate.idempotencyKey === record.idempotencyKey &&
            candidate.phase !== 'started',
        ),
    )
    .map((record) => ({
      stepId: record.stepId,
      operation: record.operation,
      attempt: record.attempt,
    }));
  if (project.revision !== expectedProjectRevision) {
    return {
      ...paused(
        project.revision,
        plan,
        `project revision ${project.revision} does not match plan revision cursor ${expectedProjectRevision}`,
      ),
      expectedProjectRevision,
      completedStepIds,
      uncertainOperations,
    };
  }
  const completed = new Set(completedStepIds);
  const nextStep = plan.steps.find(
    (step) =>
      !completed.has(step.id) &&
      step.dependsOn.every((dependency) => completed.has(dependency)),
  );
  return {
    status: nextStep ? 'ready' : 'complete',
    planId: plan.id,
    planRevision: plan.revision,
    projectRevision: project.revision,
    expectedProjectRevision,
    completedStepIds,
    nextStep,
    uncertainOperations,
  };
}

function stepCompleted(
  step: VideoAgentPlanStep,
  records: VideoExecutionLogRecord[],
  project: Awaited<ReturnType<typeof getProject>>,
): boolean {
  const terminal = [...records]
    .reverse()
    .find(
      (record) =>
        record.stepId === step.id &&
        (record.phase === 'succeeded' || record.phase === 'skipped'),
    );
  if (!terminal) return false;
  if (step.operation === 'video_set_storyboard') {
    return (
      JSON.stringify(project.storyboard) ===
      JSON.stringify(step.inputs.storyboard)
    );
  }
  return true;
}

function paused(
  projectRevision: number,
  plan: NonNullable<Awaited<ReturnType<typeof readVideoAgentPlan>>['plan']>,
  reason: string,
): VideoPlanResumeState {
  return {
    status: 'paused',
    planId: plan.id,
    planRevision: plan.revision,
    projectRevision,
    expectedProjectRevision: projectRevision,
    completedStepIds: [],
    reason,
    uncertainOperations: [],
  };
}
