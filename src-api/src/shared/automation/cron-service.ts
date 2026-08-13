/**
 * Cron Scheduling Service
 *
 * setTimeout-based cron scheduler with max 60s timer to prevent Node.js drift.
 * Module-level state pattern (no class).
 */

import { CronExpressionParser } from 'cron-parser';

import { createLogger } from '@/shared/utils/logger';

import {
  CRON_MAX_TIMER_MS,
  CRON_MIN_REFIRE_GAP_MS,
  ERROR_BACKOFF_SCHEDULE_MS,
} from './constants';
import type { Automation, AutomationSchedule } from './types';

const logger = createLogger('CronService');

// ============================================================================
// Module-Level State
// ============================================================================

/** Active timers keyed by automation ID */
const timers = new Map<string, NodeJS.Timeout>();

/** Last fire time per automation (for min refire gap) */
const lastFired = new Map<string, number>();

/** Claimed scheduled slots keyed by automation ID and slot epoch-ms. */
const claimedSlots = new Map<string, number>();

/** Tick handler called when a cron fires — set by startCron() */
let onTick: ((automationId: string) => void) | null = null;

/** Callback to resolve current consecutiveErrors for an automation */
let getErrors: ((automationId: string) => number) | null = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Start the cron service for all enabled cron automations.
 */
export function startCron(
  automations: Automation[],
  tickHandler: (id: string) => void,
  errorLookup?: (id: string) => number,
): void {
  onTick = tickHandler;
  getErrors = errorLookup ?? null;

  for (const automation of automations) {
    if (automation.trigger.type === 'cron' && automation.enabled) {
      armTimer(
        automation.id,
        automation.trigger.schedule,
        automation.consecutiveErrors ?? 0,
      );
    }
  }

  logger.info('Cron service started', { count: timers.size });
}

/**
 * Stop the cron service and clear all timers.
 */
export function stopCron(): void {
  for (const [id, timer] of timers) {
    clearTimeout(timer);
    timers.delete(id);
  }
  lastFired.clear();
  claimedSlots.clear();
  onTick = null;
  getErrors = null;
  logger.info('Cron service stopped');
}

/**
 * Add a timer for a single automation.
 */
export function addCron(automation: Automation): void {
  if (automation.trigger.type !== 'cron') return;
  armTimer(
    automation.id,
    automation.trigger.schedule,
    automation.consecutiveErrors ?? 0,
  );
}

/**
 * Update an existing cron timer (clear + re-arm).
 */
export function updateCron(automation: Automation): void {
  removeCron(automation.id);
  if (automation.trigger.type === 'cron' && automation.enabled) {
    addCron(automation);
  }
}

/**
 * Remove a cron timer for an automation.
 */
export function removeCron(automationId: string): void {
  const timer = timers.get(automationId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(automationId);
  }
  lastFired.delete(automationId);
  for (const key of claimedSlots.keys()) {
    if (key.startsWith(`${automationId}:`)) claimedSlots.delete(key);
  }
}

/**
 * Compute the next run date for a given schedule.
 * Applies exponential backoff if there have been consecutive errors.
 */
export function computeNextRun(
  schedule: AutomationSchedule,
  consecutiveErrors: number,
): Date | null {
  const now = new Date();

  let nextDate: Date | null = null;

  switch (schedule.kind) {
    case 'once': {
      if (!schedule.at) return null;
      const target = new Date(schedule.at);
      // Only fire if in the future
      nextDate = target > now ? target : null;
      break;
    }

    case 'interval': {
      if (!schedule.intervalMs) return null;
      nextDate = new Date(now.getTime() + schedule.intervalMs);
      break;
    }

    case 'cron': {
      if (!schedule.cronExpr) return null;
      try {
        const options = schedule.timezone
          ? { tz: schedule.timezone }
          : undefined;
        const expr = CronExpressionParser.parse(schedule.cronExpr, options);
        const next = expr.next();
        nextDate = next.toDate();
      } catch (err) {
        logger.error('Failed to parse cron expression:', {
          expr: schedule.cronExpr,
          error: err,
        });
        return null;
      }
      break;
    }
  }

  // Apply backoff for consecutive errors
  if (nextDate && consecutiveErrors > 0) {
    const backoffIndex = Math.min(
      consecutiveErrors - 1,
      ERROR_BACKOFF_SCHEDULE_MS.length - 1,
    );
    const backoffMs = ERROR_BACKOFF_SCHEDULE_MS[backoffIndex] ?? 0;
    nextDate = new Date(nextDate.getTime() + backoffMs);
  }

  return nextDate;
}

// ============================================================================
// Internal Timer Logic
// ============================================================================

/**
 * Arm a setTimeout for the given automation.
 * Uses CRON_MAX_TIMER_MS as the max delay to prevent Node.js timer drift.
 */
function armTimer(
  automationId: string,
  schedule: AutomationSchedule,
  consecutiveErrors: number,
): void {
  // Clear any existing timer
  const existing = timers.get(automationId);
  if (existing) clearTimeout(existing);

  const nextRun = computeNextRun(schedule, consecutiveErrors);
  if (!nextRun) {
    logger.debug('No next run for automation', { automationId });
    return;
  }

  const delay = nextRun.getTime() - Date.now();
  const slotAt = nextRun.getTime();

  if (delay > CRON_MAX_TIMER_MS) {
    // Too far in the future — set a wake-up timer and re-check
    const timer = setTimeout(() => {
      armTimer(automationId, schedule, consecutiveErrors);
    }, CRON_MAX_TIMER_MS);
    timers.set(automationId, timer);
    return;
  }

  if (delay <= 0) {
    // Check minimum refire gap
    const lastTime = lastFired.get(automationId) ?? 0;
    if (Date.now() - lastTime < CRON_MIN_REFIRE_GAP_MS) {
      // Too soon — schedule for after the gap
      const timer = setTimeout(() => {
        fireTick(automationId, schedule, slotAt, timer);
      }, CRON_MIN_REFIRE_GAP_MS);
      timers.set(automationId, timer);
      return;
    }

    // Fire immediately
    fireTick(automationId, schedule, slotAt);
    return;
  }

  // Schedule for the computed delay
  const timer = setTimeout(() => {
    fireTick(automationId, schedule, slotAt, timer);
  }, delay);
  timers.set(automationId, timer);
}

/**
 * Fire a cron tick and re-arm for the next occurrence.
 */
function fireTick(
  automationId: string,
  schedule: AutomationSchedule,
  slotAt: number,
  timer?: NodeJS.Timeout,
): void {
  const isCurrentTimer =
    timer === undefined || timers.get(automationId) === timer;
  if (isCurrentTimer) timers.delete(automationId);

  if (!claimCronSlot(automationId, slotAt)) {
    logger.info('Skipping duplicate cron slot', {
      automationId,
      slotAt: new Date(slotAt).toISOString(),
    });
    return;
  }

  lastFired.set(automationId, Date.now());

  if (onTick) {
    try {
      onTick(automationId);
    } catch (err) {
      logger.error('Cron tick handler error:', { automationId, error: err });
    }
  }

  // Re-arm for next occurrence (unless it's a one-shot)
  if (schedule.kind !== 'once') {
    const errors = getErrors ? getErrors(automationId) : 0;
    armTimer(automationId, schedule, errors);
  }
}

const CLAIM_RETENTION_MS = 24 * 60 * 60 * 1000;

function claimCronSlot(automationId: string, slotAt: number): boolean {
  pruneClaimedSlots();
  const key = `${automationId}:${slotAt}`;
  if (claimedSlots.has(key)) return false;
  claimedSlots.set(key, Date.now());
  return true;
}

function pruneClaimedSlots(now = Date.now()): void {
  for (const [key, claimedAt] of claimedSlots) {
    if (now - claimedAt > CLAIM_RETENTION_MS) claimedSlots.delete(key);
  }
}

export function __claimCronSlotForTests(
  automationId: string,
  slotAt: number,
): boolean {
  return claimCronSlot(automationId, slotAt);
}

export function __resetCronClaimsForTests(): void {
  claimedSlots.clear();
}
