import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 85,
  description: 'Add video linked source asset cache',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS linked_assets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime TEXT,
        kind TEXT NOT NULL,
        size_bytes INTEGER,
        duration_ms INTEGER,
        width INTEGER,
        height INTEGER,
        thumbnail_cache_path TEXT,
        description TEXT,
        modified_at TEXT,
        indexed_at TEXT NOT NULL,
        UNIQUE(project_id, source_id, external_id),
        FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_linked_assets_project_source
        ON linked_assets(project_id, source_id);
      CREATE INDEX IF NOT EXISTS idx_linked_assets_kind
        ON linked_assets(kind);
    `);
  },
};
