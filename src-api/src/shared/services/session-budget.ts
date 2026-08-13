/**
 * Session Budget Guard
 *
 * Lightweight per-session budget cap + agent loop detection.
 * Reads simple settings values — not a full budget policy system.
 *
 * Costs in usage_logs are stored as micro-dollars (INTEGER).
 * 1 USD = 1,000,000 micro-dollars.
 */

import crypto from 'crypto';

import { getDatabase } from '@/shared/db';
import { createActivityEvent, getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SessionBudget');

/** Micro-dollars per USD */
const MICRODOLLARS_PER_USD = 1_000_000;

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  currentCost: number; // in USD
}

export interface LoopDetectionResult {
  looping: boolean;
  callCount: number;
}

export interface SessionCostSummary {
  totalCost: number; // in USD
  tokenCount: number;
  toolCalls: number;
}

/**
 * Session Budget Guard — prevents runaway costs and agent loops.
 */
export class SessionBudgetGuard {
  private maxSessionCostUsd: number;
  private maxToolCallsPerMinute: number;
  private enabled: boolean;

  constructor() {
    this.maxSessionCostUsd = this.getNumberSetting('maxSessionCostUsd', 10);
    this.maxToolCallsPerMinute = this.getNumberSetting(
      'maxToolCallsPerMinute',
      20,
    );
    this.enabled =
      (getSetting('sessionBudgetEnabled') as string | null) !== 'false';
  }

  /**
   * Check whether the session is within budget.
   */
  checkSessionBudget(sessionId: string): BudgetCheckResult {
    if (!this.enabled) {
      return { allowed: true, currentCost: 0 };
    }

    const db = getDatabase();
    const row = db
      .prepare(
        'SELECT COALESCE(SUM(total_cost), 0) as total FROM usage_logs WHERE session_id = ?',
      )
      .get(sessionId) as { total: number };

    const currentCostUsd = row.total / MICRODOLLARS_PER_USD;

    if (currentCostUsd >= this.maxSessionCostUsd) {
      logger.warn(
        `Session ${sessionId} budget exceeded: $${currentCostUsd.toFixed(4)} >= $${this.maxSessionCostUsd}`,
      );
      return {
        allowed: false,
        reason: `Session cost limit exceeded ($${currentCostUsd.toFixed(2)} / $${this.maxSessionCostUsd})`,
        currentCost: currentCostUsd,
      };
    }

    return { allowed: true, currentCost: currentCostUsd };
  }

  /**
   * Detect agent loop (too many tool calls in a short window).
   */
  detectAgentLoop(sessionId: string): LoopDetectionResult {
    if (!this.enabled) {
      return { looping: false, callCount: 0 };
    }

    const db = getDatabase();

    const row = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM usage_logs
         WHERE session_id = ? AND call_type = 'agent'
           AND created_at >= datetime('now', '-60 seconds')`,
      )
      .get(sessionId) as { cnt: number };

    if (row.cnt > this.maxToolCallsPerMinute) {
      logger.warn(
        `Agent loop detected for session ${sessionId}: ${row.cnt} calls in 60s (limit: ${this.maxToolCallsPerMinute})`,
      );

      // Emit activity event
      try {
        createActivityEvent({
          id: crypto.randomUUID(),
          actor_type: 'system',
          event_type: 'agent.loop_detected',
          entity_type: 'task',
          entity_id: sessionId,
          metadata: JSON.stringify({
            callCount: row.cnt,
            threshold: this.maxToolCallsPerMinute,
          }),
        });
      } catch {
        // Non-critical
      }

      return { looping: true, callCount: row.cnt };
    }

    return { looping: false, callCount: row.cnt };
  }

  /**
   * Get cost summary for a session.
   */
  getSessionCostSummary(sessionId: string): SessionCostSummary {
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT
          COALESCE(SUM(total_cost), 0) as total_cost,
          COALESCE(SUM(input_tokens + output_tokens), 0) as token_count,
          COUNT(*) as tool_calls
        FROM usage_logs WHERE session_id = ?`,
      )
      .get(sessionId) as {
      total_cost: number;
      token_count: number;
      tool_calls: number;
    };

    return {
      totalCost: row.total_cost / MICRODOLLARS_PER_USD,
      tokenCount: row.token_count,
      toolCalls: row.tool_calls,
    };
  }

  /**
   * Refresh settings from DB.
   */
  refresh(): void {
    this.maxSessionCostUsd = this.getNumberSetting('maxSessionCostUsd', 10);
    this.maxToolCallsPerMinute = this.getNumberSetting(
      'maxToolCallsPerMinute',
      20,
    );
    this.enabled =
      (getSetting('sessionBudgetEnabled') as string | null) !== 'false';
  }

  private getNumberSetting(key: string, defaultValue: number): number {
    const val = getSetting(key) as string | null;
    if (val === null) return defaultValue;
    const num = Number(val);
    return isNaN(num) ? defaultValue : num;
  }
}

/** Singleton instance */
let guard: SessionBudgetGuard | null = null;

export function getSessionBudgetGuard(): SessionBudgetGuard {
  if (!guard) {
    guard = new SessionBudgetGuard();
  }
  return guard;
}
