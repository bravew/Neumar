/**
 * Automation Lifecycle Manager
 *
 * Handles:
 * - Expiry enforcement (ISO datetime)
 * - Max-runs enforcement
 * - Cost budget enforcement (per-automation + global daily/monthly)
 * - Consecutive failure auto-disable
 * - Graceful shutdown (persist nextRunAt, flush store on SIGTERM)
 * - Missed-fire detection and recovery on startup
 *
 * Uses drift-corrected setTimeout instead of setInterval to handle
 * machine sleep/wake correctly.
 *
 * SCALE NOTE — Per-Channel Cost Budgets:
 * ───────────────────────────────────────
 * Currently cost budgets are per-automation and global (all channels pooled).
 * For multi-tenant scenarios, add per-channel daily/monthly budgets:
 * - Track cost by originChannel.platform in the cost ledger
 * - Enforce per-channel caps independently (e.g., Discord budget vs Telegram budget)
 * - Expose per-channel cost reports in the API
 *
 * SCALE NOTE — Cloud Scheduler Tier:
 * ──────────────────────────────────
 * The current design is desktop-only (automations stop when app closes).
 * For always-on scheduling, add a "Cloud Scheduler" tier:
 * - Persist schedules to a remote backend (Anthropic API, custom server)
 * - Use RemoteTrigger (Claude Code SDK) for cloud-hosted execution
 * - Keep local engine as fallback for offline/low-latency use
 * - See CronCreate's `durable: true` option for a similar pattern
 */

import { createLogger } from '@/shared/utils/logger';

import {
  DEFAULT_GLOBAL_DAILY_COST,
  DEFAULT_GLOBAL_MONTHLY_COST,
  LIFECYCLE_CHECK_INTERVAL_MS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_COST_LEDGER_DAILY_ENTRIES,
  MAX_COST_LEDGER_MONTHLY_ENTRIES,
  MISSED_FIRE_STAGGER_MS,
  MISSED_FIRE_THRESHOLD_MS,
  SHUTDOWN_GRACE_PERIOD_MS,
} from './constants';
import { stopCron } from './cron-service';
import { deliverSystemNotification } from './delivery';
import { renderTemplate } from './delivery-locale';
import { stopHeartbeats } from './heartbeat-runner';
import { emit } from './hooks';
import { flushStore, saveStore } from './store';
import type { Automation, AutomationStoreData } from './types';

const logger = createLogger('AutomationLifecycle');

// ============================================================================
// Module-Level State
// ============================================================================

let lifecycleTimer: ReturnType<typeof setTimeout> | null = null;
let expectedNextTick = 0;
let isRunning = false;

// Reference to engine store — set via init()
let storeRef: AutomationStoreData | null = null;

// Callbacks into engine for disable/enqueue (avoid circular imports)
let disableAutomation: ((id: string) => Promise<void>) | null = null;
let _enqueueRun: ((automationId: string, triggeredBy: string) => void) | null =
  null;
let getActiveRunIds: (() => string[]) | null = null;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the lifecycle manager with references to the engine state.
 * Must be called before start().
 */
export function initLifecycle(opts: {
  store: AutomationStoreData;
  onDisable: (id: string) => Promise<void>;
  onEnqueue: (automationId: string, triggeredBy: string) => void;
  onGetActiveRunIds: () => string[];
}): void {
  storeRef = opts.store;
  disableAutomation = opts.onDisable;
  _enqueueRun = opts.onEnqueue;
  getActiveRunIds = opts.onGetActiveRunIds;
}

/**
 * Update the store reference (e.g., after reload).
 */
export function updateStoreRef(store: AutomationStoreData): void {
  storeRef = store;
}

// ============================================================================
// Lifecycle Check Loop (Drift-Corrected)
// ============================================================================

/**
 * Start the periodic lifecycle check.
 * Uses drift-corrected setTimeout to handle machine sleep correctly.
 */
export function startLifecycleManager(): void {
  if (isRunning) return;
  isRunning = true;
  expectedNextTick = Date.now() + LIFECYCLE_CHECK_INTERVAL_MS;
  scheduleNext();
  logger.info('Lifecycle manager started');
}

/**
 * Stop the lifecycle check loop.
 */
export function stopLifecycleManager(): void {
  isRunning = false;
  if (lifecycleTimer) {
    clearTimeout(lifecycleTimer);
    lifecycleTimer = null;
  }
  logger.info('Lifecycle manager stopped');
}

function scheduleNext(): void {
  if (!isRunning) return;

  const drift = Date.now() - expectedNextTick;
  const delay = Math.max(0, LIFECYCLE_CHECK_INTERVAL_MS - drift);

  lifecycleTimer = setTimeout(() => {
    expectedNextTick = Date.now() + LIFECYCLE_CHECK_INTERVAL_MS;
    void checkLifecycle();
    scheduleNext();
  }, delay);
}

// ============================================================================
// Lifecycle Checks
// ============================================================================

async function checkLifecycle(): Promise<void> {
  if (!storeRef) return;

  const now = Date.now();

  for (const automation of storeRef.automations) {
    if (!automation.enabled) continue;

    // 1. Expiry check
    if (automation.expiresAt) {
      const expiresAtMs = new Date(automation.expiresAt).getTime();
      if (now >= expiresAtMs) {
        await handleExpiry(automation);
        continue;
      }
    }

    // 2. Max-runs check
    if (
      automation.maxRuns != null &&
      automation.runCount >= automation.maxRuns
    ) {
      await handleMaxRunsReached(automation);
      continue;
    }

    // 3. Cost budget check (per-automation)
    if (
      automation.costBudget != null &&
      automation.totalCost >= automation.costBudget
    ) {
      await handleBudgetExhausted(automation);
      continue;
    }

    // 4. Consecutive failures check
    if ((automation.consecutiveErrors ?? 0) >= MAX_CONSECUTIVE_FAILURES) {
      await handleConsecutiveFailures(automation);
      continue;
    }
  }

  // 5. Global daily/monthly cost check
  await checkGlobalBudget();
}

async function handleExpiry(automation: Automation): Promise<void> {
  logger.info('Automation expired', {
    id: automation.id,
    name: automation.name,
  });

  if (disableAutomation) {
    await disableAutomation(automation.id);
  }

  const days = Math.ceil(
    (Date.now() - new Date(automation.createdAt).getTime()) /
      (24 * 60 * 60 * 1000),
  );
  const message = renderTemplate(automation.locale, 'expired', {
    name: automation.name,
    runCount: automation.runCount,
    days,
    totalCost: `$${automation.totalCost.toFixed(2)}`,
  });

  void deliverSystemNotification(automation, message, 'automation:expired');
  void emit('automation:expired', {
    automationId: automation.id,
    data: { reason: 'expiry', message },
  });
}

async function handleMaxRunsReached(automation: Automation): Promise<void> {
  logger.info('Max runs reached', {
    id: automation.id,
    name: automation.name,
    runCount: automation.runCount,
    maxRuns: automation.maxRuns,
  });

  if (disableAutomation) {
    await disableAutomation(automation.id);
  }

  const message = renderTemplate(automation.locale, 'maxRuns.reached', {
    name: automation.name,
    maxRuns: automation.maxRuns ?? 0,
  });

  void deliverSystemNotification(
    automation,
    message,
    'automation:max_runs_reached',
  );
  void emit('automation:max_runs_reached', {
    automationId: automation.id,
  });
}

async function handleBudgetExhausted(automation: Automation): Promise<void> {
  logger.info('Cost budget exhausted', {
    id: automation.id,
    name: automation.name,
    totalCost: automation.totalCost,
    budget: automation.costBudget,
  });

  if (disableAutomation) {
    await disableAutomation(automation.id);
  }

  const message = renderTemplate(automation.locale, 'budget.exhausted', {
    name: automation.name,
    budget: `$${(automation.costBudget ?? 0).toFixed(2)}`,
    spent: `$${automation.totalCost.toFixed(2)}`,
  });

  void deliverSystemNotification(
    automation,
    message,
    'automation:budget_exhausted',
  );
  void emit('automation:budget_exhausted', {
    automationId: automation.id,
  });
}

async function handleConsecutiveFailures(
  automation: Automation,
): Promise<void> {
  logger.warn('Consecutive failures threshold reached', {
    id: automation.id,
    name: automation.name,
    errors: automation.consecutiveErrors,
  });

  if (disableAutomation) {
    await disableAutomation(automation.id);
  }

  const message = renderTemplate(automation.locale, 'error.consecutive', {
    name: automation.name,
    count: automation.consecutiveErrors ?? 0,
    error: 'See run history for details',
  });

  void deliverSystemNotification(
    automation,
    message,
    'automation:consecutive_failures',
  );
  void emit('automation:consecutive_failures', {
    automationId: automation.id,
  });
}

// ============================================================================
// Global Budget
// ============================================================================

async function checkGlobalBudget(): Promise<void> {
  if (!storeRef) return;

  const config = storeRef.config;
  const maxDaily = config?.maxGlobalDailyCost ?? DEFAULT_GLOBAL_DAILY_COST;
  const maxMonthly =
    config?.maxGlobalMonthlyCost ?? DEFAULT_GLOBAL_MONTHLY_COST;
  const ledger = storeRef.costLedger ?? { daily: [], monthly: [] };

  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = new Date().toISOString().slice(0, 7);

  const dailyCost = ledger.daily.find((e) => e.date === today)?.cost ?? 0;
  const monthlyCost =
    ledger.monthly.find((e) => e.month === thisMonth)?.cost ?? 0;

  if (dailyCost >= maxDaily || monthlyCost >= maxMonthly) {
    // Disable all enabled automations
    for (const automation of storeRef.automations) {
      if (automation.enabled && disableAutomation) {
        await disableAutomation(automation.id);
      }
    }

    const budget =
      dailyCost >= maxDaily ? `$${maxDaily}/day` : `$${maxMonthly}/month`;
    logger.warn('Global automation budget reached', { budget });

    void emit('automation:global_budget_exhausted', {
      data: { dailyCost, monthlyCost, maxDaily, maxMonthly },
    });
  }
}

// ============================================================================
// Cost Tracking
// ============================================================================

/**
 * Record cost from a completed run.
 * Updates per-automation and global cost ledger.
 */
export function recordRunCost(
  automation: Automation,
  cost: number,
  store: AutomationStoreData,
): void {
  // Per-automation
  automation.runCount++;
  automation.totalCost += cost;

  // Global ledger
  if (!store.costLedger) {
    store.costLedger = { daily: [], monthly: [] };
  }

  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = new Date().toISOString().slice(0, 7);

  // Update daily entry
  let dailyEntry = store.costLedger.daily.find((e) => e.date === today);
  if (!dailyEntry) {
    dailyEntry = { date: today, cost: 0 };
    store.costLedger.daily.push(dailyEntry);
  }
  dailyEntry.cost += cost;

  // Update monthly entry
  let monthlyEntry = store.costLedger.monthly.find(
    (e) => e.month === thisMonth,
  );
  if (!monthlyEntry) {
    monthlyEntry = { month: thisMonth, cost: 0 };
    store.costLedger.monthly.push(monthlyEntry);
  }
  monthlyEntry.cost += cost;

  // Prune old entries
  pruneCostLedger(store);

  saveStore(store);
}

function pruneCostLedger(store: AutomationStoreData): void {
  if (!store.costLedger) return;

  // Keep only recent daily entries
  if (store.costLedger.daily.length > MAX_COST_LEDGER_DAILY_ENTRIES) {
    store.costLedger.daily = store.costLedger.daily
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, MAX_COST_LEDGER_DAILY_ENTRIES);
  }

  // Keep only recent monthly entries
  if (store.costLedger.monthly.length > MAX_COST_LEDGER_MONTHLY_ENTRIES) {
    store.costLedger.monthly = store.costLedger.monthly
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, MAX_COST_LEDGER_MONTHLY_ENTRIES);
  }
}

// ============================================================================
// Missed-Fire Recovery
// ============================================================================

/**
 * On engine startup, check each enabled automation for missed fires.
 * Recovers based on the automation's missedFirePolicy.
 */
export function recoverMissedFires(
  automations: Automation[],
  enqueue: (automationId: string, triggeredBy: string) => void,
): void {
  const now = Date.now();
  let staggerIndex = 0;

  for (const automation of automations) {
    if (!automation.enabled || !automation.nextRunAt) continue;

    const nextRunMs = new Date(automation.nextRunAt).getTime();
    if (now <= nextRunMs) continue; // Not missed

    const missedByMs = now - nextRunMs;
    const policy = automation.missedFirePolicy ?? 'fire_once';

    logger.info('Detected missed fire', {
      id: automation.id,
      name: automation.name,
      missedBy: `${Math.round(missedByMs / 1000)}s`,
      policy,
    });

    switch (policy) {
      case 'fire_immediately': {
        // Always fire, staggered to prevent thundering herd
        const delay = staggerIndex * MISSED_FIRE_STAGGER_MS;
        setTimeout(() => {
          enqueue(automation.id, 'missed_fire');
        }, delay);
        staggerIndex++;
        break;
      }

      case 'fire_once': {
        // Fire once if missed by less than threshold
        if (missedByMs < MISSED_FIRE_THRESHOLD_MS) {
          const delay = staggerIndex * MISSED_FIRE_STAGGER_MS;
          setTimeout(() => {
            enqueue(automation.id, 'missed_fire');
          }, delay);
          staggerIndex++;
        } else {
          logger.info('Missed fire too stale, skipping', {
            id: automation.id,
            missedBy: `${Math.round(missedByMs / 60000)}m`,
            threshold: `${MISSED_FIRE_THRESHOLD_MS / 60000}m`,
          });
        }
        break;
      }

      case 'skip': {
        logger.info('Skipping missed fire per policy', {
          id: automation.id,
        });
        break;
      }
    }

    void emit('automation:missed_fire_recovered', {
      automationId: automation.id,
      data: { missedByMs, policy },
    });
  }

  if (staggerIndex > 0) {
    logger.info(`Recovering ${staggerIndex} missed fires`);
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

/**
 * Graceful shutdown sequence.
 *
 * 1. Stop lifecycle manager
 * 2. Stop all cron timers and heartbeats
 * 3. Wait for in-progress runs to complete (up to grace period)
 * 4. Persist final state (nextRunAt for each automation)
 * 5. Flush store to disk immediately
 */
export async function shutdownAutomationEngine(
  store: AutomationStoreData,
  activeRunIds: string[],
  abortAll: () => void,
): Promise<void> {
  logger.info('Graceful shutdown initiated', {
    activeRuns: activeRunIds.length,
  });

  // 1. Stop lifecycle manager
  stopLifecycleManager();

  // 2. Stop scheduling
  stopCron();
  stopHeartbeats();

  // 3. Wait for in-progress runs (up to grace period)
  if (activeRunIds.length > 0) {
    const deadline = Date.now() + SHUTDOWN_GRACE_PERIOD_MS;
    while (Date.now() < deadline) {
      const current = getActiveRunIds?.() ?? [];
      if (current.length === 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    // Abort any remaining runs
    const remaining = getActiveRunIds?.() ?? [];
    if (remaining.length > 0) {
      logger.warn(`Aborting ${remaining.length} runs after grace period`);
      abortAll();
    }
  }

  // 4. Flush store to disk immediately
  await flushStore(store);
  logger.info('Graceful shutdown complete');
}

/**
 * Persist nextRunAt for all cron/heartbeat automations.
 * Called before shutdown to enable missed-fire detection on next startup.
 */
export function persistNextRunTimes(
  automations: Automation[],
  computeNextRun: (automation: Automation) => string | undefined,
): void {
  for (const automation of automations) {
    if (!automation.enabled) continue;
    const nextRun = computeNextRun(automation);
    if (nextRun) {
      automation.nextRunAt = nextRun;
    }
  }
}
