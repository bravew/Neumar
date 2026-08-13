import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 53,
  description: 'Recall audit — per-turn provenance for injected memories',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS recall_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        method TEXT NOT NULL DEFAULT 'hybrid',
        query TEXT,
        recalled_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_recall_audit_session
        ON recall_audit(session_id, recalled_at DESC);

      CREATE INDEX IF NOT EXISTS idx_recall_audit_memory
        ON recall_audit(memory_id);
    `);
  },
};
