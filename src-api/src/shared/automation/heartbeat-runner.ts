/**
 * Heartbeat Runner
 *
 * Periodic heartbeat runner with active hours window support.
 * Conceptually different from cron: heartbeat is a periodic awareness daemon
 * that checks if anything needs attention, while cron fires precise jobs.
 *
 * SCALE NOTE — Wake Coalescing (OpenClaw pattern):
 * ─────────────────────────────────────────────────
 * OpenClaw batches multiple wake requests within a 250ms window into a single
 * heartbeat execution. This prevents redundant ticks when multiple events
 * (interval timer, manual trigger, cron event) fire near-simultaneously.
 * Implement when heartbeat trigger sources diversify beyond just interval timer.
 *
 * SCALE NOTE — HEARTBEAT.md File Protocol:
 * ─────────────────────────────────────────
 * OpenClaw/Paperclip heartbeats read a HEARTBEAT.md checklist file on each tick:
 *   "Read HEARTBEAT.md if it exists. Follow it strictly."
 * This enables per-automation checklists that can be edited live without
 * restarting the automation. Currently we use the automation.prompt field.
 * To add: accept an optional checklistPath on AutomationHeartbeatConfig,
 * read the file on each tick, and prepend its content to the prompt.
 * Skip the API call entirely if the file is empty (file gating — saves tokens).
 *
 * SCALE NOTE — Transcript Pruning:
 * ─────────────────────────────────
 * OpenClaw prunes the agent's transcript back to pre-heartbeat size on
 * HEARTBEAT_OK responses. This prevents context growth across ticks when
 * using session reuse. Implement alongside session reuse in engine.ts.
 */

import { createHash } from 'node:crypto';

import { createLogger } from '@/shared/utils/logger';

import { DEFAULT_HEARTBEAT_INTERVAL_MS } from './constants';
import type { Automation, AutomationHeartbeatConfig } from './types';

const logger = createLogger('HeartbeatRunner');

// ============================================================================
// Module-Level State
// ============================================================================

/** Active heartbeat timers keyed by automation ID */
const timers = new Map<string, NodeJS.Timeout>();

/** Cached Intl.DateTimeFormat instances keyed by timezone */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** Tick handler called when a heartbeat fires */
let onTick: ((automationId: string) => void) | null = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Start heartbeat timers for all enabled heartbeat automations.
 */
export function startHeartbeats(
  automations: Automation[],
  tickHandler: (id: string) => void,
): void {
  onTick = tickHandler;

  for (const automation of automations) {
    if (automation.trigger.type === 'heartbeat' && automation.enabled) {
      addHeartbeat(automation);
    }
  }

  logger.info('Heartbeat runner started', { count: timers.size });
}

/**
 * Stop all heartbeat timers.
 */
export function stopHeartbeats(): void {
  for (const [id, timer] of timers) {
    clearInterval(timer);
    timers.delete(id);
  }
  onTick = null;
  logger.info('Heartbeat runner stopped');
}

/**
 * Add a heartbeat timer for a single automation.
 */
export function addHeartbeat(automation: Automation): void {
  if (automation.trigger.type !== 'heartbeat') return;

  // Remove any existing timer
  removeHeartbeat(automation.id);

  const config = automation.trigger.heartbeat;
  const intervalMs = config.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

  // Stagger initial fire to prevent thundering herd when multiple
  // automations share the same interval
  const staggerMs = getStaggerOffset(automation.id, intervalMs);
  const startTimer = () => {
    const timer = setInterval(() => {
      // Check active hours before firing
      if (config.activeHours && !isWithinActiveHours(config)) {
        logger.debug('Heartbeat skipped — outside active hours', {
          automationId: automation.id,
          activeHours: config.activeHours,
        });
        return;
      }

      if (onTick) {
        try {
          onTick(automation.id);
        } catch (err) {
          logger.error('Heartbeat tick handler error:', {
            automationId: automation.id,
            error: err,
          });
        }
      }
    }, intervalMs);

    timers.set(automation.id, timer);
  };

  // Use setTimeout for staggered initial delay, then setInterval
  if (staggerMs > 0) {
    const delayTimer = setTimeout(startTimer, staggerMs);
    // Store the delay timer temporarily (will be replaced by interval timer)
    timers.set(automation.id, delayTimer as unknown as NodeJS.Timeout);
  } else {
    startTimer();
  }

  logger.debug('Heartbeat armed', {
    automationId: automation.id,
    intervalMs,
    staggerMs,
    activeHours: config.activeHours,
  });
}

/**
 * Remove a heartbeat timer for an automation.
 */
export function removeHeartbeat(automationId: string): void {
  const timer = timers.get(automationId);
  if (timer) {
    clearInterval(timer);
    timers.delete(automationId);
  }
}

/**
 * Check if the current time is within the configured active hours window.
 * Active hours format: "HH:MM-HH:MM" (24-hour format).
 *
 * @example isWithinActiveHours({ intervalMs: 0, activeHours: "09:00-17:00" })
 */
export function isWithinActiveHours(
  config: AutomationHeartbeatConfig,
): boolean {
  if (!config.activeHours) return true;

  const match = config.activeHours.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!match) {
    logger.warn('Invalid activeHours format, expected HH:MM-HH:MM', {
      activeHours: config.activeHours,
    });
    return true; // Default to active if format is wrong
  }

  const startHour = parseInt(match[1] ?? '0', 10);
  const startMin = parseInt(match[2] ?? '0', 10);
  const endHour = parseInt(match[3] ?? '0', 10);
  const endMin = parseInt(match[4] ?? '0', 10);

  // Get current time in the configured timezone (or local if not specified)
  let currentHour: number;
  let currentMin: number;
  if (config.timezone) {
    let fmt = formatterCache.get(config.timezone);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: config.timezone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      });
      formatterCache.set(config.timezone, fmt);
    }
    const parts = fmt.formatToParts(new Date());
    currentHour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    currentMin = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  } else {
    const now = new Date();
    currentHour = now.getHours();
    currentMin = now.getMinutes();
  }

  const currentMinutes = currentHour * 60 + currentMin;
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  // Handle overnight windows (e.g., 22:00-06:00)
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

// ============================================================================
// Stagger Offset
// ============================================================================

/**
 * SHA256-based stagger offset.
 * Each automation gets a deterministic offset based on its ID,
 * so automations with the same interval don't all fire simultaneously.
 */
function getStaggerOffset(automationId: string, intervalMs: number): number {
  const hash = createHash('sha256').update(automationId).digest();
  const offset = hash.readUInt32BE(0) % intervalMs;
  return offset;
}
