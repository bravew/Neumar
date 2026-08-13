import crypto from 'node:crypto';

import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';

import type { Leaser, LeaseHandle } from './lease';

interface LeaseRow {
  key: string;
  holder: string;
  expires_at: number;
}

export class DbLeaser implements Leaser {
  private readonly holder: string;

  constructor(
    private readonly db: Database.Database = getDatabase(),
    holder = crypto.randomUUID(),
  ) {
    this.holder = holder;
  }

  async acquire(key: string, ttlMs: number): Promise<LeaseHandle | null> {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const acquired = this.db.transaction(() => {
      const row = this.db
        .prepare(
          'SELECT key, holder, expires_at FROM channel_leases WHERE key = ?',
        )
        .get(key) as LeaseRow | undefined;
      if (row && row.holder !== this.holder && row.expires_at > now) {
        return false;
      }
      this.db
        .prepare(
          `INSERT INTO channel_leases (key, holder, expires_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             holder = excluded.holder,
             expires_at = excluded.expires_at,
             updated_at = unixepoch()`,
        )
        .run(key, this.holder, expiresAt);
      return true;
    })();

    return acquired ? { key, holder: this.holder, ttlMs, expiresAt } : null;
  }

  async renew(handle: LeaseHandle): Promise<boolean> {
    const expiresAt = Date.now() + handle.ttlMs;
    const result = this.db
      .prepare(
        `UPDATE channel_leases
         SET expires_at = ?, updated_at = unixepoch()
         WHERE key = ? AND holder = ?`,
      )
      .run(expiresAt, handle.key, handle.holder);
    if (result.changes === 0) return false;
    handle.expiresAt = expiresAt;
    return true;
  }

  async release(handle: LeaseHandle): Promise<void> {
    this.db
      .prepare('DELETE FROM channel_leases WHERE key = ? AND holder = ?')
      .run(handle.key, handle.holder);
  }
}
