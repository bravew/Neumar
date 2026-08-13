/**
 * Budget Service
 *
 * Comprehensive budget policy enforcement on top of the lightweight
 * session budget guard (session-budget.ts). Policies are per-scope
 * (global, provider, model, agent_profile, project, automation) and
 * per-period (monthly, weekly, daily).
 *
 * CRITICAL: total_cost in usage_logs is stored as micro-dollars (INTEGER).
 * 1 USD = 1,000,000 micro-dollars. Always divide by MICRODOLLARS_PER_USD.
 */

import { getDatabase } from '@/shared/db';
import {
  getEnabledBudgetPolicies,
  getBudgetSpendCache,
  invalidateBudgetSpendCache,
  upsertBudgetSpendCache,
} from '@/shared/db/operations';
import type { BudgetPolicy, BudgetScopeType } from '@/shared/db/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('BudgetService');

/** Micro-dollars per USD — matches usage_logs total_cost column */
const MICRODOLLARS_PER_USD = 1_000_000;

export type BudgetSeverity = 'none' | 'soft' | 'urgent' | 'blocked';

export interface BudgetPreflightResult {
  allowed: boolean;
  policyId?: string;
  policyName?: string;
  currentSpend: number; // in USD
  limit: number; // in USD
  percentUsed: number;
  severity: BudgetSeverity;
  message?: string;
}

export interface BudgetStatusItem {
  policy: BudgetPolicy;
  currentSpend: number; // in USD
  percentUsed: number;
  severity: BudgetSeverity;
}

// ============ Period Start Computation ============

/**
 * Compute the ISO start date/time for the current period.
 * Returns a UTC ISO string (e.g. '2026-03-01T00:00:00.000Z').
 */
export function getPeriodStart(
  periodType: BudgetPolicy['period_type'],
): string {
  const now = new Date();
  switch (periodType) {
    case 'daily': {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      return d.toISOString();
    }
    case 'weekly': {
      // Rewind to most recent Monday (UTC)
      const day = now.getUTCDay(); // 0=Sun, 1=Mon
      const diff = day === 0 ? 6 : day - 1;
      const d = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - diff,
        ),
      );
      return d.toISOString();
    }
    case 'monthly':
    default: {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return d.toISOString();
    }
  }
}

// ============ Spend Aggregation ============

/**
 * Query usage_logs for total spend within a period.
 * All values are in USD (converted from micro-dollars).
 */
export function getSpendForPeriod(
  scopeType: BudgetScopeType,
  scopeId: string | null,
  periodStart: string,
): number {
  const db = getDatabase();
  let row: { total: number };

  switch (scopeType) {
    case 'global': {
      row = db
        .prepare(
          `SELECT COALESCE(SUM(total_cost), 0) as total
           FROM usage_logs WHERE created_at >= ?`,
        )
        .get(periodStart) as { total: number };
      break;
    }
    case 'provider': {
      row = db
        .prepare(
          `SELECT COALESCE(SUM(total_cost), 0) as total
           FROM usage_logs WHERE provider = ? AND created_at >= ?`,
        )
        .get(scopeId, periodStart) as { total: number };
      break;
    }
    case 'model': {
      row = db
        .prepare(
          `SELECT COALESCE(SUM(total_cost), 0) as total
           FROM usage_logs WHERE model = ? AND created_at >= ?`,
        )
        .get(scopeId, periodStart) as { total: number };
      break;
    }
    case 'agent_profile': {
      // billing_scope stores the profile id for agent-profile-scoped calls
      row = db
        .prepare(
          `SELECT COALESCE(SUM(total_cost), 0) as total
           FROM usage_logs WHERE billing_scope = ? AND created_at >= ?`,
        )
        .get(scopeId, periodStart) as { total: number };
      break;
    }
    case 'project': {
      row = db
        .prepare(
          `SELECT COALESCE(SUM(ul.total_cost), 0) as total
           FROM usage_logs ul
           INNER JOIN tasks t ON t.id = ul.task_id
           WHERE t.project_id = ? AND ul.created_at >= ?`,
        )
        .get(scopeId, periodStart) as { total: number };
      break;
    }
    case 'automation': {
      // automation sessions tagged by session_id matching automation run sessions
      row = db
        .prepare(
          `SELECT COALESCE(SUM(total_cost), 0) as total
           FROM usage_logs WHERE session_id = ? AND created_at >= ?`,
        )
        .get(scopeId, periodStart) as { total: number };
      break;
    }
    default: {
      row = { total: 0 };
    }
  }

  // Convert micro-dollars to USD
  return row.total / MICRODOLLARS_PER_USD;
}

// ============ Preflight Check ============

function getSeverity(
  percentUsed: number,
  thresholdPct: number,
  hardStop: boolean,
): BudgetSeverity {
  if (percentUsed >= 100 && hardStop) return 'blocked';
  if (percentUsed >= 90) return 'urgent';
  if (percentUsed >= thresholdPct) return 'soft';
  return 'none';
}

/**
 * Run budget preflight for the given scope.
 * Returns the worst-severity result across all matching enabled policies.
 */
export function budgetPreflight(scope: {
  scopeType: BudgetScopeType;
  scopeId?: string;
}): BudgetPreflightResult {
  const policies = getEnabledBudgetPolicies().filter(
    (p) =>
      p.scope_type === scope.scopeType &&
      (p.scope_id === null || p.scope_id === (scope.scopeId ?? null)),
  );

  if (policies.length === 0) {
    return {
      allowed: true,
      currentSpend: 0,
      limit: 0,
      percentUsed: 0,
      severity: 'none',
    };
  }

  let worstResult: BudgetPreflightResult = {
    allowed: true,
    currentSpend: 0,
    limit: 0,
    percentUsed: 0,
    severity: 'none',
  };

  for (const policy of policies) {
    const periodStart = getPeriodStart(policy.period_type);
    let spendUsd: number;

    // Check cache first
    const cached = getBudgetSpendCache(policy.id, periodStart);
    if (cached) {
      spendUsd = cached.spend_usd;
    } else {
      // Recompute from usage_logs
      spendUsd = getSpendForPeriod(
        policy.scope_type,
        policy.scope_id,
        periodStart,
      );
      upsertBudgetSpendCache(policy.id, periodStart, spendUsd);
    }

    const percentUsed =
      policy.limit_usd > 0 ? (spendUsd / policy.limit_usd) * 100 : 0;
    const severity = getSeverity(
      percentUsed,
      policy.alert_threshold_pct,
      policy.hard_stop,
    );
    const allowed = !(severity === 'blocked');

    const result: BudgetPreflightResult = {
      allowed,
      policyId: policy.id,
      policyName: policy.name ?? undefined,
      currentSpend: spendUsd,
      limit: policy.limit_usd,
      percentUsed,
      severity,
      message:
        severity === 'blocked'
          ? `Budget exceeded: $${spendUsd.toFixed(2)} / $${policy.limit_usd.toFixed(2)} (${Math.round(percentUsed)}%)`
          : severity === 'urgent'
            ? `Budget at ${Math.round(percentUsed)}% of limit ($${policy.limit_usd.toFixed(2)})`
            : undefined,
    };

    // Track worst result (blocked > urgent > soft > none)
    const severityOrder: BudgetSeverity[] = [
      'none',
      'soft',
      'urgent',
      'blocked',
    ];
    if (
      severityOrder.indexOf(result.severity) >
      severityOrder.indexOf(worstResult.severity)
    ) {
      worstResult = result;
    }
  }

  return worstResult;
}

/**
 * Get status for all enabled policies (for dashboard display).
 */
export function getBudgetStatus(): BudgetStatusItem[] {
  const policies = getEnabledBudgetPolicies();
  return policies.map((policy) => {
    const periodStart = getPeriodStart(policy.period_type);
    let spendUsd: number;

    const cached = getBudgetSpendCache(policy.id, periodStart);
    if (cached) {
      spendUsd = cached.spend_usd;
    } else {
      spendUsd = getSpendForPeriod(
        policy.scope_type,
        policy.scope_id,
        periodStart,
      );
      upsertBudgetSpendCache(policy.id, periodStart, spendUsd);
    }

    const percentUsed =
      policy.limit_usd > 0 ? (spendUsd / policy.limit_usd) * 100 : 0;
    const severity = getSeverity(
      percentUsed,
      policy.alert_threshold_pct,
      policy.hard_stop,
    );

    return { policy, currentSpend: spendUsd, percentUsed, severity };
  });
}

/**
 * Calculate the minimum remaining budget (in USD) across all hard-stop policies.
 * Uses the spend cache for efficiency (avoids N+1 DB queries).
 * Returns `Infinity` if no hard-stop policies exist.
 */
export function getRemainingBudgetUsd(): number {
  const policies = getEnabledBudgetPolicies().filter((p) => p.hard_stop);
  if (policies.length === 0) return Infinity;

  let minRemaining = Infinity;
  for (const policy of policies) {
    const periodStart = getPeriodStart(policy.period_type);
    let spendUsd: number;

    const cached = getBudgetSpendCache(policy.id, periodStart);
    if (cached) {
      spendUsd = cached.spend_usd;
    } else {
      spendUsd = getSpendForPeriod(
        policy.scope_type,
        policy.scope_id,
        periodStart,
      );
      upsertBudgetSpendCache(policy.id, periodStart, spendUsd);
    }

    const remaining = policy.limit_usd - spendUsd;
    minRemaining = Math.min(minRemaining, remaining);
  }
  return minRemaining;
}

/**
 * Invalidate all spend caches — call this after every usage_log insert.
 */
export function invalidateAllBudgetCaches(): void {
  try {
    invalidateBudgetSpendCache();
  } catch (err) {
    // Non-critical — stale cache just means slightly delayed enforcement
    logger.warn('Failed to invalidate budget spend cache:', err);
  }
}
