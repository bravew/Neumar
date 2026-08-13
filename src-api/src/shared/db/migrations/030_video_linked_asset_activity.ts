import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 87,
  description: 'Add linked asset recents and favorites',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS linked_asset_activity (
        project_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0,
        last_opened_at TEXT,
        opened_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, asset_id),
        FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES linked_assets(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_linked_asset_activity_recent
        ON linked_asset_activity(project_id, last_opened_at DESC);
      CREATE INDEX IF NOT EXISTS idx_linked_asset_activity_favorite
        ON linked_asset_activity(project_id, favorite, updated_at DESC);
    `);
  },
};
