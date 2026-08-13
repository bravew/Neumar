import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 78,
  description: 'DesignMode routines and scheduler state',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS design_routines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        surface TEXT NOT NULL,
        target_mode TEXT NOT NULL,
        project_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        design_system_id TEXT,
        skill_id TEXT,
        craft_refs_json TEXT NOT NULL DEFAULT '[]',
        provider_profile_id TEXT,
        schedule_json TEXT,
        next_run_at TEXT,
        last_fired_at TEXT,
        last_run_id TEXT,
        last_run_summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_design_routines_enabled_next
        ON design_routines(enabled, next_run_at);

      CREATE INDEX IF NOT EXISTS idx_design_routines_project
        ON design_routines(project_id);

      CREATE TABLE IF NOT EXISTS design_routine_runs (
        id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL,
        project_id TEXT,
        task_id TEXT,
        status TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        queued_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        duration_ms INTEGER,
        summary TEXT,
        error TEXT,
        history_json TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (routine_id) REFERENCES design_routines(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_design_routine_runs_routine
        ON design_routine_runs(routine_id, queued_at DESC);

      CREATE INDEX IF NOT EXISTS idx_design_routine_runs_project
        ON design_routine_runs(project_id);

      CREATE TABLE IF NOT EXISTS design_routine_scheduler_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
};
