/**
 * Phase 9 — Local feedback persistence.
 *
 * Stores user-submitted feedback locally before any external forwarding so
 * submissions are never lost when offline. Linear forwarding and remote sync
 * status is tracked via `linear_id`, `remote_status`, `sync_attempts`,
 * `last_sync_error`, and `synced_at`.
 */

import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 62,
  description: 'Local feedback persistence',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        email TEXT,
        app_name TEXT,
        app_version TEXT,
        diagnostics_json TEXT,
        linear_id TEXT,
        remote_status TEXT NOT NULL DEFAULT 'pending',
        sync_attempts INTEGER NOT NULL DEFAULT 0,
        last_sync_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        synced_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_feedback_created_at
        ON feedback(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_feedback_category
        ON feedback(category, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_feedback_remote_status
        ON feedback(remote_status, created_at DESC);
    `);
  },
};
