/**
 * Plan Manager — DB-backed Durable Plan Storage
 *
 * Stores plans in the orchestration_runs table so they survive app restarts.
 * Replaces the previous in-memory LRU cache implementation.
 */

import type { TaskPlan } from '@/core/agent/types';

import {
  createOrchestrationRun,
  deleteOrchestrationRun,
  getOrchestrationRun,
  getPendingOrchestrationRuns,
  updateOrchestrationRunPayload,
  updateOrchestrationRunStatus,
} from '@/shared/db/operations';
import type { OrchestrationRun } from '@/shared/db/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('PlanManager');

/**
 * Deserialize a TaskPlan from an orchestration_runs row.
 * Handles the JSON payload and date conversion.
 */
function toPlan(run: OrchestrationRun): TaskPlan {
  const parsed = JSON.parse(run.payload) as TaskPlan;
  // Ensure createdAt is a Date object
  parsed.createdAt = new Date(parsed.createdAt);
  return parsed;
}

export class PlanManager {
  /** In-memory fallback for plans that fail DB persistence (e.g., FK constraint) */
  private memoryCache = new Map<string, TaskPlan>();

  save(plan: TaskPlan, taskId?: string): void {
    // Check if this plan already exists (update vs insert)
    const existing = getOrchestrationRun(plan.id);
    if (existing) {
      // Update the payload so step status changes are persisted
      updateOrchestrationRunPayload(plan.id, JSON.stringify(plan));
      return;
    }

    // Need a task_id — plans are stored as orchestration runs tied to a task.
    // Using plan.id as fallback creates an orphaned FK if PRAGMA foreign_keys = ON.
    if (!taskId) {
      logger.warn(
        `save() called without taskId for plan ${plan.id} — using plan.id as fallback (orphaned FK risk)`,
      );
    }
    const resolvedTaskId = taskId || plan.id;

    try {
      createOrchestrationRun({
        id: plan.id,
        task_id: resolvedTaskId,
        run_type: 'plan',
        payload: JSON.stringify(plan),
      });
      logger.debug(`Saved plan: ${plan.id} (task: ${resolvedTaskId})`);
    } catch (err) {
      // FK constraint can fail if task doesn't exist yet — store in-memory fallback
      logger.warn(
        `Failed to save plan ${plan.id} to DB, using in-memory fallback:`,
        err instanceof Error ? err.message : String(err),
      );
      this.memoryCache.set(plan.id, plan);
    }
  }

  get(planId: string): TaskPlan | undefined {
    // Check DB first
    const run = getOrchestrationRun(planId);
    if (run && run.run_type === 'plan') {
      try {
        return toPlan(run);
      } catch (err) {
        logger.warn(
          `Failed to parse plan ${planId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    // Fallback to in-memory cache
    return this.memoryCache.get(planId);
  }

  delete(planId: string): boolean {
    this.memoryCache.delete(planId);
    return deleteOrchestrationRun(planId);
  }

  approve(planId: string): boolean {
    return updateOrchestrationRunStatus(planId, 'approved');
  }

  reject(planId: string): boolean {
    return updateOrchestrationRunStatus(planId, 'rejected');
  }

  clear(): void {
    // No-op — DB plans are cleaned up via task cascade or explicit delete
    logger.debug('clear() called — plans persist in database');
  }

  getMetrics() {
    const pending = getPendingOrchestrationRuns();
    return {
      totalPlans: pending.length,
      pendingCount: pending.filter((r) => r.status === 'pending').length,
      approvedCount: pending.filter((r) => r.status === 'approved').length,
    };
  }

  /**
   * Restore all pending/approved plans on startup.
   * Returns them for the caller to re-register if needed.
   */
  restorePendingPlans(): TaskPlan[] {
    const runs = getPendingOrchestrationRuns();
    const plans: TaskPlan[] = [];
    for (const run of runs) {
      if (run.run_type !== 'plan') continue;
      try {
        plans.push(toPlan(run));
      } catch (err) {
        logger.warn(
          `Skipping corrupted plan ${run.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    if (plans.length > 0) {
      logger.info(`Restored ${plans.length} pending plan(s) from database`);
    }
    return plans;
  }
}

// Singleton instance
let planManager: PlanManager | null = null;

export function getPlanManager(): PlanManager {
  if (!planManager) {
    planManager = new PlanManager();
  }
  return planManager;
}
