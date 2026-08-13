import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 79,
  description: 'Design critique metrics rollups',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS design_critique_metrics (
        run_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        rollout_phase TEXT NOT NULL,
        outcome TEXT NOT NULL,
        panelist_count INTEGER NOT NULL,
        must_fix_count INTEGER NOT NULL,
        total_score REAL NOT NULL,
        duration_ms INTEGER NOT NULL,
        conformance_ok INTEGER NOT NULL,
        degraded_panelist_count INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_critique_metrics_started_at
        ON design_critique_metrics (started_at);
      CREATE INDEX IF NOT EXISTS idx_critique_metrics_outcome_started
        ON design_critique_metrics (outcome, started_at);
    `);
  },
};
