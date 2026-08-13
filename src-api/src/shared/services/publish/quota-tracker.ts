import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';

import type { QuotaSpec } from './quota-specs';

export interface QuotaCheckResult {
  ok: boolean;
  retryAt?: Date;
  reason?: string;
}

export class QuotaTracker {
  private readonly db?: Database.Database;
  private readonly now: () => Date;

  constructor(deps: { db?: Database.Database; now?: () => Date } = {}) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
  }

  canConsume(connectionId: string, specs: QuotaSpec[]): QuotaCheckResult {
    const db = this.getDb();
    for (const spec of specs) {
      if (spec.limit === undefined) continue;
      const window = activeWindow(this.now(), spec.window);
      const row = db
        .prepare(
          `SELECT value FROM publish_quota_usage
           WHERE connection_id = ? AND quota_kind = ? AND window_end = ?`,
        )
        .get(connectionId, spec.kind, window.end.toISOString()) as
        | { value: number }
        | undefined;
      if ((row?.value ?? 0) + spec.cost > spec.limit) {
        return {
          ok: false,
          retryAt: window.end,
          reason: 'quota_exhausted',
        };
      }
    }
    return { ok: true };
  }

  recordConsumption(connectionId: string, specs: QuotaSpec[]): void {
    const db = this.getDb();
    const now = this.now().toISOString();
    const tx = db.transaction(() => {
      for (const spec of specs) {
        const window = activeWindow(this.now(), spec.window);
        db.prepare(
          `INSERT INTO publish_quota_usage (
             connection_id, quota_kind, value, window_start, window_end, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(connection_id, quota_kind, window_end)
           DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at`,
        ).run(
          connectionId,
          spec.kind,
          spec.cost,
          window.start.toISOString(),
          window.end.toISOString(),
          now,
        );
      }
    });
    tx();
  }

  windowRoll(quotaKind: string): number {
    const result = this.getDb()
      .prepare(
        `DELETE FROM publish_quota_usage
         WHERE quota_kind = ? AND window_end <= ?`,
      )
      .run(quotaKind, this.now().toISOString());
    return result.changes;
  }

  private getDb(): Database.Database {
    return this.db ?? getDatabase();
  }
}

function activeWindow(
  now: Date,
  window: QuotaSpec['window'],
): { start: Date; end: Date } {
  const ms = windowMs(window);
  const startMs = Math.floor(now.getTime() / ms) * ms;
  return { start: new Date(startMs), end: new Date(startMs + ms) };
}

function windowMs(window: QuotaSpec['window']): number {
  switch (window) {
    case '1h':
      return 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
    case '24h':
      return 24 * 60 * 60 * 1000;
  }
}
