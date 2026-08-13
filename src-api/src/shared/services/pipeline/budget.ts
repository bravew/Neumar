/**
 * Pipeline Budget Tracker
 *
 * Tracks cumulative cost across all pipeline runs per day.
 * Persisted to disk for restart resilience. Enforces per-ticket and per-day limits.
 *
 * Design:
 * - One JSON file per calendar day: pipeline-budget-YYYY-MM-DD.json
 * - Module-level cache for hot-path reads (no disk I/O for budget checks during pipeline)
 * - Stale files older than 7 days are cleaned up on load
 */

import fs from 'fs/promises';
import { join } from 'path';

import { getAppDir } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('PipelineBudget');

// ============================================================================
// Types
// ============================================================================

interface TicketSpend {
  issueId: string;
  issueIdentifier: string;
  costUsd: number;
  updatedAt: string;
}

interface DailyBudget {
  date: string;
  totalCostUsd: number;
  tickets: TicketSpend[];
}

// ============================================================================
// Module-level cache
// ============================================================================

let cachedBudget: DailyBudget | null = null;
let inflightLoad: Promise<DailyBudget> | null = null;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function budgetFilePath(date: string): string {
  return join(getAppDir(), `pipeline-budget-${date}.json`);
}

// ============================================================================
// Persistence
// ============================================================================

async function loadDailyBudget(date: string): Promise<DailyBudget> {
  try {
    const data = await fs.readFile(budgetFilePath(date), 'utf-8');
    return JSON.parse(data);
  } catch {
    return { date, totalCostUsd: 0, tickets: [] };
  }
}

async function saveDailyBudget(budget: DailyBudget): Promise<void> {
  await fs.mkdir(getAppDir(), { recursive: true });
  await fs.writeFile(
    budgetFilePath(budget.date),
    JSON.stringify(budget, null, 2),
  );
}

/** Remove budget files older than 7 days */
async function cleanupStaleBudgets(): Promise<void> {
  try {
    const appDir = getAppDir();
    const files = await fs.readdir(appDir);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    const cutoff = cutoffDate.toISOString().slice(0, 10);

    for (const file of files) {
      const match = file.match(/^pipeline-budget-(\d{4}-\d{2}-\d{2})\.json$/);
      if (match && match[1]! < cutoff) {
        await fs.unlink(join(appDir, file));
        logger.info(`Cleaned up stale budget file: ${file}`);
      }
    }
  } catch {
    // Non-critical — ignore cleanup failures
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get today's budget state. Loads from disk on first call, then caches.
 */
export async function getDailyBudget(): Promise<DailyBudget> {
  const today = todayKey();
  if (cachedBudget && cachedBudget.date === today) {
    return cachedBudget;
  }

  // Deduplicate concurrent initial loads to prevent TOCTOU overwrites
  if (inflightLoad) return inflightLoad;

  inflightLoad = (async () => {
    cachedBudget = await loadDailyBudget(today);
    // Cleanup stale files on first load of the day
    void cleanupStaleBudgets();
    return cachedBudget;
  })().finally(() => {
    inflightLoad = null;
  });

  return inflightLoad;
}

/**
 * Record cost for a ticket. Accumulates per-ticket and daily totals.
 */
export async function recordTicketCost(
  issueId: string,
  issueIdentifier: string,
  costUsd: number,
): Promise<void> {
  if (costUsd <= 0) return;

  const budget = await getDailyBudget();

  const existing = budget.tickets.find((t) => t.issueId === issueId);
  if (existing) {
    existing.costUsd += costUsd;
    existing.updatedAt = new Date().toISOString();
  } else {
    budget.tickets.push({
      issueId,
      issueIdentifier,
      costUsd,
      updatedAt: new Date().toISOString(),
    });
  }

  budget.totalCostUsd += costUsd;
  cachedBudget = budget;

  await saveDailyBudget(budget).catch((err) => {
    logger.warn('Failed to persist budget:', err);
  });
}

/**
 * Get cumulative cost for a specific ticket today.
 */
export async function getTicketCost(issueId: string): Promise<number> {
  const budget = await getDailyBudget();
  return budget.tickets.find((t) => t.issueId === issueId)?.costUsd ?? 0;
}

/**
 * Check if a new pipeline run is within budget.
 * Returns { allowed, reason } — reason is set when denied.
 */
export async function checkBudget(
  issueId: string,
  maxPerTicket: number,
  maxPerDay: number,
): Promise<{ allowed: boolean; reason?: string }> {
  const budget = await getDailyBudget();

  // Daily limit check
  if (budget.totalCostUsd >= maxPerDay) {
    return {
      allowed: false,
      reason: `Daily budget exhausted: $${budget.totalCostUsd.toFixed(2)} / $${maxPerDay} max`,
    };
  }

  // Per-ticket limit check
  const ticketCost =
    budget.tickets.find((t) => t.issueId === issueId)?.costUsd ?? 0;
  if (ticketCost >= maxPerTicket) {
    return {
      allowed: false,
      reason: `Ticket budget exhausted: $${ticketCost.toFixed(2)} / $${maxPerTicket} max`,
    };
  }

  return { allowed: true };
}

/**
 * Get a summary of today's spending for status/monitoring endpoints.
 */
export async function getBudgetSummary(): Promise<{
  date: string;
  totalCostUsd: number;
  ticketCount: number;
  tickets: { issueIdentifier: string; costUsd: number }[];
}> {
  const budget = await getDailyBudget();
  return {
    date: budget.date,
    totalCostUsd: budget.totalCostUsd,
    ticketCount: budget.tickets.length,
    tickets: budget.tickets.map((t) => ({
      issueIdentifier: t.issueIdentifier,
      costUsd: t.costUsd,
    })),
  };
}
