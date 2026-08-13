import crypto from 'crypto';

import { describe, expect, it } from 'vitest';

import { getDatabase } from '@/shared/db';
import { saveSetting } from '@/shared/db/operations';
import { SessionBudgetGuard } from '@/shared/services/session-budget';

/** Micro-dollars per USD */
const MICRODOLLARS_PER_USD = 1_000_000;

function insertUsageLog(
  sessionId: string,
  totalCostMicro: number,
  callType = 'agent',
  createdAt?: string,
) {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO usage_logs (id, session_id, call_type, provider, model, total_cost, input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, 'test', 'test-model', ?, 100, 50, COALESCE(?, datetime('now')))`,
  ).run(
    crypto.randomUUID(),
    sessionId,
    callType,
    totalCostMicro,
    createdAt ?? null,
  );
}

describe('Session Budget Guard', () => {
  describe('Microdollar conversion', () => {
    it('10,000,000 microdollars = $10 USD', () => {
      expect(10_000_000 / MICRODOLLARS_PER_USD).toBe(10);
    });

    it('1,000,000 microdollars = $1 USD', () => {
      expect(1_000_000 / MICRODOLLARS_PER_USD).toBe(1);
    });
  });

  describe('Budget check', () => {
    it('allows execution when session cost below limit', () => {
      const guard = new SessionBudgetGuard();
      const sessionId = crypto.randomUUID();
      insertUsageLog(sessionId, 1_000_000); // $1

      const result = guard.checkSessionBudget(sessionId);
      expect(result.allowed).toBe(true);
      expect(result.currentCost).toBe(1);
    });

    it('blocks execution when session cost exceeds limit', () => {
      saveSetting('maxSessionCostUsd', '5');
      const guard = new SessionBudgetGuard();
      const sessionId = crypto.randomUUID();

      // Insert $6 worth
      insertUsageLog(sessionId, 3_000_000);
      insertUsageLog(sessionId, 3_000_000);

      const result = guard.checkSessionBudget(sessionId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeded');
      expect(result.currentCost).toBe(6);

      // Cleanup
      saveSetting('maxSessionCostUsd', '10');
    });

    it('returns allowed when sessionBudgetEnabled is false', () => {
      saveSetting('sessionBudgetEnabled', 'false');
      const guard = new SessionBudgetGuard();
      const sessionId = crypto.randomUUID();
      insertUsageLog(sessionId, 100_000_000); // $100

      const result = guard.checkSessionBudget(sessionId);
      expect(result.allowed).toBe(true);

      // Cleanup
      saveSetting('sessionBudgetEnabled', 'true');
    });
  });

  describe('Loop detection', () => {
    it('does not trigger below threshold', () => {
      const guard = new SessionBudgetGuard();
      const sessionId = crypto.randomUUID();

      // Insert a few recent calls
      for (let i = 0; i < 5; i++) {
        insertUsageLog(sessionId, 1000);
      }

      const result = guard.detectAgentLoop(sessionId);
      expect(result.looping).toBe(false);
      expect(result.callCount).toBe(5);
    });
  });

  describe('Cost summary', () => {
    it('returns correct totals', () => {
      const guard = new SessionBudgetGuard();
      const sessionId = crypto.randomUUID();
      insertUsageLog(sessionId, 2_000_000);
      insertUsageLog(sessionId, 3_000_000);

      const summary = guard.getSessionCostSummary(sessionId);
      expect(summary.totalCost).toBe(5);
      expect(summary.toolCalls).toBe(2);
      expect(summary.tokenCount).toBeGreaterThan(0);
    });
  });

  describe('Index verification', () => {
    it('idx_usage_logs_session_id exists', () => {
      const db = getDatabase();
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_usage_logs_session_id'",
        )
        .all() as Array<{ name: string }>;
      expect(indexes.length).toBe(1);
      expect(indexes[0].name).toBe('idx_usage_logs_session_id');
    });
  });
});
