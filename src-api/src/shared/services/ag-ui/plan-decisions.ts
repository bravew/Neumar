/**
 * Plan decisions as standard AG-UI interrupts.
 *
 * The planning phase ends with a durable `orchestration_runs` row in
 * `pending`. That row is the decision: its id names the interrupt, its status
 * is the answer, and the atomic pending→approved/rejected transition is what
 * makes a duplicate resume harmless.
 */

import type { Interrupt } from '@ag-ui/core';

import type { TaskPlan } from '@/core/agent/types';

import {
  decideOrchestrationRun,
  getOrchestrationRun,
  getOrchestrationRunsByTaskId,
  getTask,
  updateOrchestrationRunPayload,
} from '@/shared/db/operations';
import type { OrchestrationRun } from '@/shared/db/types';
import { createLogger } from '@/shared/utils/logger';

import {
  decisionInterruptId,
  parseDecisionInterruptId,
  parseDecisionResponse,
  planInterrupt,
  type ResumeEntryInput,
} from './interrupts';

const logger = createLogger('AGUIPlanDecisions');

/** A plan is only offered while its task is waiting for that decision. */
export function pendingPlanRun(taskId: string): OrchestrationRun | null {
  if (getTask(taskId)?.status !== 'stopped') return null;
  const latestPlan = getOrchestrationRunsByTaskId(taskId).find(
    (run) => run.run_type === 'plan',
  );
  return latestPlan?.status === 'pending' ? latestPlan : null;
}

export function parsePlanRun(run: OrchestrationRun): TaskPlan | null {
  try {
    return JSON.parse(run.payload) as TaskPlan;
  } catch {
    logger.warn('Stored plan payload is not valid JSON', { planId: run.id });
    return null;
  }
}

/** Interrupts for the task's open plan decisions, newest first. */
export function listPlanInterrupts(taskId: string): Interrupt[] {
  const run = pendingPlanRun(taskId);
  const plan = run ? parsePlanRun(run) : null;
  return plan ? [planInterrupt(taskId, plan)] : [];
}

export function planInterruptForRun(run: OrchestrationRun): Interrupt | null {
  const plan = parsePlanRun(run);
  return plan ? planInterrupt(run.task_id, plan) : null;
}

export type PlanDecisionOutcome =
  | { kind: 'approved'; run: OrchestrationRun; plan: TaskPlan }
  | { kind: 'rejected'; run: OrchestrationRun; plan: TaskPlan }
  | { kind: 'cancelled'; run: OrchestrationRun; plan: TaskPlan }
  | { kind: 'unknown' }
  | { kind: 'stale' }
  | { kind: 'wrong_thread'; taskId: string }
  | { kind: 'already_resolved'; status: string }
  | { kind: 'invalid_response'; error: string };

/**
 * Applies one resume entry to the plan record it names. The caller passes the
 * request's task id, so an answer minted for another thread cannot approve
 * this plan.
 */
export function resolvePlanDecision(
  taskId: string,
  entry: ResumeEntryInput,
): PlanDecisionOutcome {
  const parsed = parseDecisionInterruptId(entry.interruptId);
  if (!parsed || parsed.kind !== 'plan') return { kind: 'unknown' };

  const run = getOrchestrationRun(parsed.sourceId);
  if (!run || run.run_type !== 'plan') return { kind: 'unknown' };
  if (run.task_id !== taskId) {
    return { kind: 'wrong_thread', taskId: run.task_id };
  }
  if (run.status !== 'pending') {
    return { kind: 'already_resolved', status: run.status };
  }
  if (pendingPlanRun(taskId)?.id !== run.id) return { kind: 'stale' };
  const plan = parsePlanRun(run);
  if (!plan)
    return { kind: 'invalid_response', error: 'Stored plan is unreadable' };

  if (entry.status === 'cancelled') {
    return decide(taskId, run, plan, 'rejected', 'cancelled');
  }

  const response = parseDecisionResponse('plan', entry.payload);
  if (!response.ok) {
    return { kind: 'invalid_response', error: response.error };
  }
  return decide(
    taskId,
    run,
    plan,
    response.response.approved ? 'approved' : 'rejected',
    response.response.approved ? 'approved' : 'rejected',
  );
}

function decide(
  taskId: string,
  run: OrchestrationRun,
  plan: TaskPlan,
  status: 'approved' | 'rejected',
  decision: 'approved' | 'rejected' | 'cancelled',
): PlanDecisionOutcome {
  if (!decideOrchestrationRun(run.id, 'pending', status)) {
    const current = getOrchestrationRun(run.id);
    return { kind: 'already_resolved', status: current?.status ?? 'unknown' };
  }
  // Keep the answer with the plan so history shows why execution did or did
  // not start; the row's status is the authority for resume.
  updateOrchestrationRunPayload(
    run.id,
    JSON.stringify({ ...plan, decision, decidedAt: new Date().toISOString() }),
  );
  logger.info('Plan decision applied', {
    taskId,
    planId: run.id,
    decision,
  });
  return decision === 'approved'
    ? { kind: 'approved', run, plan }
    : decision === 'cancelled'
      ? { kind: 'cancelled', run, plan }
      : { kind: 'rejected', run, plan };
}

export function planInterruptIdFor(planId: string): string {
  return decisionInterruptId('plan', planId);
}
