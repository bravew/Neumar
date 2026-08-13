import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 84,
  description: 'Add video mode project and job tables',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS video_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        render_status TEXT NOT NULL DEFAULT 'idle',
        budget_cap_cents INTEGER NOT NULL DEFAULT 500,
        budget_spent_cents INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS video_provider_configs (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        provider_setting_id TEXT,
        default_cost_cents_per_sec INTEGER,
        settings_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS video_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        media_item_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        source_url TEXT,
        content_hash TEXT NOT NULL,
        analysis_status TEXT NOT NULL DEFAULT 'idle',
        provenance_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS video_source_analyses (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        result_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
        FOREIGN KEY (source_id) REFERENCES video_sources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS video_cut_plans (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        approved_at TEXT,
        applied_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
        FOREIGN KEY (source_id) REFERENCES video_sources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS video_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT,
        finished_at TEXT,
        cost_cents INTEGER NOT NULL DEFAULT 0,
        caller TEXT NOT NULL DEFAULT 'in-app',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_video_projects_updated_at
        ON video_projects(updated_at);
      CREATE INDEX IF NOT EXISTS idx_video_provider_configs_provider_id
        ON video_provider_configs(provider_id);
      CREATE INDEX IF NOT EXISTS idx_video_sources_project_id
        ON video_sources(project_id);
      CREATE INDEX IF NOT EXISTS idx_video_source_analyses_source_id
        ON video_source_analyses(source_id);
      CREATE INDEX IF NOT EXISTS idx_video_cut_plans_project_id
        ON video_cut_plans(project_id);
      CREATE INDEX IF NOT EXISTS idx_video_jobs_project_kind_status
        ON video_jobs(project_id, kind, status);
    `);
  },
};
