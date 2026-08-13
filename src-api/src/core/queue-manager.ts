/**
 * Queue Manager — Parallel Task Execution Controller
 *
 * Enforces `max_concurrent_tasks` from agent profiles, which was previously
 * defined everywhere but never enforced. Uses an in-memory semaphore pattern
 * (Map + Set) backed by DB for crash recovery.
 *
 * Design:
 * - In-memory tracking of running tasks per profile (single-instance desktop app)
 * - Event-driven dequeue via TaskEventBus (no polling daemon)
 * - Crash recovery on startup: marks stale `picked_up` tasks as failed
 * - Coordinates with automation engine's MAX_CONCURRENT_RUNS (both limits apply)
 */

import { getDatabase } from '@/shared/db';
import {
  enqueueTask,
  getAgentProfile,
  getQueuedTasks,
  getQueueStats,
  pickupQueuedTask,
} from '@/shared/db/operations';
import { taskEventBus } from '@/shared/services/task-event-bus';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('QueueManager');

const runningTasks = new Map<string, Set<string>>();

const DEFAULT_PROFILE_KEY = '__default__';
const DEFAULT_MAX_CONCURRENT = 1;

export const QUEUE_EVENTS = {
  TASK_COMPLETED: 'queue:task-completed',
  TASK_FAILED: 'queue:task-failed',
  TASK_DEQUEUED: 'queue:task-dequeued',
} as const;

let initialized = false;

/**
 * Initialize the queue manager on API server boot.
 * Recovers stale queue entries and rebuilds in-memory state from DB.
 */
export function initialize(): void {
  if (initialized) return;

  recoverStaleQueueEntries();
  rebuildFromDB();

  taskEventBus.on(QUEUE_EVENTS.TASK_COMPLETED, handleTaskFinished);
  taskEventBus.on(QUEUE_EVENTS.TASK_FAILED, handleTaskFinished);

  initialized = true;
  logger.info('Queue manager initialized', {
    profiles: runningTasks.size,
    totalRunning: getTotalRunningCount(),
  });
}

/**
 * Shut down the queue manager and clear in-memory state.
 */
export function shutdown(): void {
  taskEventBus.off(QUEUE_EVENTS.TASK_COMPLETED, handleTaskFinished);
  taskEventBus.off(QUEUE_EVENTS.TASK_FAILED, handleTaskFinished);
  runningTasks.clear();
  initialized = false;
  logger.info('Queue manager shut down');
}

/**
 * Check whether a profile can accept another task.
 */
export function canAcceptTask(profileId?: string | null): boolean {
  const effectiveId = profileId || DEFAULT_PROFILE_KEY;
  const maxConcurrent = getMaxConcurrent(profileId);
  const running = runningTasks.get(effectiveId)?.size ?? 0;
  return running < maxConcurrent;
}

/**
 * Attempt to execute a task immediately or enqueue it.
 *
 * @returns 'executing' if the task can start now, 'queued' if at capacity.
 */
export function tryExecuteOrQueue(
  taskId: string,
  profileId?: string | null,
  priority = 0,
): { status: 'executing' | 'queued'; queuePosition?: number } {
  if (canAcceptTask(profileId)) {
    trackRunning(profileId, taskId);
    logger.info(`Task ${taskId} executing immediately`, {
      profileId: profileId || 'default',
      running: getRunningCount(profileId),
      max: getMaxConcurrent(profileId),
    });
    return { status: 'executing' };
  }

  const effectiveProfileId = profileId || DEFAULT_PROFILE_KEY;
  enqueueTask(taskId, effectiveProfileId, priority);

  const stats = getQueueStats(effectiveProfileId);
  logger.info(`Task ${taskId} queued (position ${stats.queued})`, {
    profileId: effectiveProfileId,
    running: getRunningCount(profileId),
    max: getMaxConcurrent(profileId),
    queueDepth: stats.queued,
  });

  return { status: 'queued', queuePosition: stats.queued };
}

/**
 * Signal that a task has completed (success or failure).
 * Untrack the running task and attempt to dequeue the next one.
 */
export function onTaskComplete(
  taskId: string,
  profileId?: string | null,
  success = true,
): void {
  untrackRunning(profileId, taskId);

  // Only update queue_status — task.status is managed by the SSE message
  // pipeline (updateTaskFromMessage). Using completeQueuedTask would
  // unconditionally overwrite status, corrupting user-initiated stops.
  markQueueDone(taskId);

  logger.debug(`Task ${taskId} completed (success=${success})`, {
    profileId: profileId || 'default',
    remaining: getRunningCount(profileId),
  });

  // Emit synchronously — handleTaskFinished runs inline and may dequeue
  // the next task, mutating runningTasks before this function returns.
  const eventType = success
    ? QUEUE_EVENTS.TASK_COMPLETED
    : QUEUE_EVENTS.TASK_FAILED;
  taskEventBus.emit(eventType, { taskId, profileId });
}

/**
 * Get the current queue state for a profile.
 */
export function getQueueState(profileId?: string | null): {
  running: number;
  maxConcurrent: number;
  queued: number;
  runningTaskIds: string[];
} {
  const effectiveId = profileId || DEFAULT_PROFILE_KEY;
  const runningSet = runningTasks.get(effectiveId);
  const stats = getQueueStats(effectiveId);

  return {
    running: runningSet?.size ?? 0,
    maxConcurrent: getMaxConcurrent(profileId),
    queued: stats.queued,
    runningTaskIds: runningSet ? Array.from(runningSet) : [],
  };
}

/**
 * Get aggregate stats across all profiles.
 */
export function getGlobalStats(): {
  totalRunning: number;
  totalQueued: number;
  perProfile: Record<string, { running: number; queued: number; max: number }>;
} {
  const globalStats = getQueueStats();
  const perProfile: Record<
    string,
    { running: number; queued: number; max: number }
  > = {};

  for (const [profileId, taskSet] of runningTasks) {
    const stats =
      profileId !== DEFAULT_PROFILE_KEY
        ? getQueueStats(profileId)
        : { queued: 0 };
    perProfile[profileId] = {
      running: taskSet.size,
      queued: stats.queued,
      max: getMaxConcurrent(
        profileId === DEFAULT_PROFILE_KEY ? null : profileId,
      ),
    };
  }

  return {
    totalRunning: getTotalRunningCount(),
    totalQueued: globalStats.queued,
    perProfile,
  };
}

// ─── Internal helpers ────────────────────────────────────────────────

/**
 * Mark a task's queue_status as 'done' without touching task.status.
 * Task status transitions are handled by the SSE pipeline separately.
 */
function markQueueDone(taskId: string): void {
  try {
    const db = getDatabase();
    db.prepare(`UPDATE tasks SET queue_status = 'done' WHERE id = ?`).run(
      taskId,
    );
  } catch (err) {
    logger.warn(`Failed to mark task ${taskId} queue done:`, errorMessage(err));
  }
}

function getMaxConcurrent(profileId?: string | null): number {
  if (!profileId) return DEFAULT_MAX_CONCURRENT;
  try {
    const profile = getAgentProfile(profileId);
    return profile?.max_concurrent_tasks ?? DEFAULT_MAX_CONCURRENT;
  } catch {
    return DEFAULT_MAX_CONCURRENT;
  }
}

function trackRunning(
  profileId: string | null | undefined,
  taskId: string,
): void {
  const key = profileId || DEFAULT_PROFILE_KEY;
  let taskSet = runningTasks.get(key);
  if (!taskSet) {
    taskSet = new Set();
    runningTasks.set(key, taskSet);
  }
  taskSet.add(taskId);
}

function untrackRunning(
  profileId: string | null | undefined,
  taskId: string,
): void {
  const key = profileId || DEFAULT_PROFILE_KEY;
  const taskSet = runningTasks.get(key);
  if (taskSet) {
    taskSet.delete(taskId);
    if (taskSet.size === 0) {
      runningTasks.delete(key);
    }
  }
}

function getRunningCount(profileId?: string | null): number {
  const key = profileId || DEFAULT_PROFILE_KEY;
  return runningTasks.get(key)?.size ?? 0;
}

function getTotalRunningCount(): number {
  let total = 0;
  for (const taskSet of runningTasks.values()) {
    total += taskSet.size;
  }
  return total;
}

/**
 * Event handler: when a task finishes, try to dequeue the next task for that profile.
 */
function handleTaskFinished(event: {
  taskId: string;
  profileId?: string | null;
}): void {
  const { profileId } = event;
  dequeueNext(profileId);
}

/**
 * Dequeue the next queued task for a profile and start it.
 * Picks highest priority, then oldest (FIFO within same priority).
 */
function dequeueNext(profileId?: string | null): void {
  if (!canAcceptTask(profileId)) return;

  const effectiveId = profileId || DEFAULT_PROFILE_KEY;
  const queued = getQueuedTasks(effectiveId, 1);
  if (queued.length === 0) return;

  const nextTask = queued[0]!;
  if (!pickupQueuedTask(nextTask.id, effectiveId)) {
    logger.warn(
      `Failed to pick up queued task ${nextTask.id} — may have been claimed`,
    );
    return;
  }

  trackRunning(profileId, nextTask.id);

  logger.info(`Dequeued task ${nextTask.id} for profile ${effectiveId}`, {
    running: getRunningCount(profileId),
    max: getMaxConcurrent(profileId),
  });

  taskEventBus.emit(QUEUE_EVENTS.TASK_DEQUEUED, {
    taskId: nextTask.id,
    profileId: effectiveId,
    prompt: nextTask.prompt,
    workDir: nextTask.work_dir,
  });
}

/**
 * Crash recovery: mark tasks stuck in 'picked_up' as failed.
 * Runs once on startup, same pattern as markZombieTasks.
 */
function recoverStaleQueueEntries(): void {
  try {
    const db = getDatabase();
    const stale = db
      .prepare(
        `UPDATE tasks SET queue_status = 'done', status = 'error'
         WHERE queue_status = 'picked_up'
           AND (heartbeat_at IS NULL OR heartbeat_at < datetime('now', '-10 minutes'))
         RETURNING id`,
      )
      .all() as { id: string }[];

    if (stale.length > 0) {
      logger.info(
        `Recovered ${stale.length} stale queued task(s): ${stale.map((s) => s.id).join(', ')}`,
      );
    }
  } catch (err) {
    logger.debug('Queue recovery skipped:', errorMessage(err));
  }
}

/**
 * Rebuild in-memory running task state from DB on startup.
 * Any task in 'running' status with an assignee_profile_id is considered active.
 */
function rebuildFromDB(): void {
  try {
    const db = getDatabase();
    const running = db
      .prepare(
        `SELECT id, assignee_profile_id FROM tasks
         WHERE status = 'running'`,
      )
      .all() as { id: string; assignee_profile_id: string | null }[];

    for (const task of running) {
      trackRunning(task.assignee_profile_id, task.id);
    }

    if (running.length > 0) {
      logger.info(
        `Rebuilt state: ${running.length} running task(s) across ${runningTasks.size} profile(s)`,
      );
    }
  } catch (err) {
    logger.debug('Queue state rebuild skipped:', errorMessage(err));
  }
}
