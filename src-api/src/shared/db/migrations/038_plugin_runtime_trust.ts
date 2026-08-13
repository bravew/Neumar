import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 95,
  description: 'Add plugin runtime trust and video candidates',
  up(db: Database.Database) {
    addColumnIfMissing(
      db,
      'installed_plugins',
      'trust_tier',
      "TEXT NOT NULL DEFAULT 'local'",
    );
    addColumnIfMissing(db, 'installed_plugins', 'manifest_digest', 'TEXT');
    addColumnIfMissing(db, 'installed_plugins', 'last_reviewed_digest', 'TEXT');

    db.exec(`
      CREATE TABLE IF NOT EXISTS video_plugin_candidates (
        id                    TEXT PRIMARY KEY,
        plugin_id             TEXT REFERENCES installed_plugins(id) ON DELETE SET NULL,
        source_plugin_id      TEXT,
        project_id            TEXT NOT NULL,
        session_id            TEXT,
        title                 TEXT NOT NULL,
        description           TEXT NOT NULL,
        confidence            REAL NOT NULL DEFAULT 0,
        status                TEXT NOT NULL
          CHECK (status IN ('active', 'dismissed', 'saved')),
        applied_snapshot_json TEXT NOT NULL,
        manifest_digest       TEXT,
        draft_manifest_path   TEXT,
        saved_plugin_id       TEXT REFERENCES installed_plugins(id) ON DELETE SET NULL,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_video_plugin_candidates_project_status
        ON video_plugin_candidates(project_id, status);

      CREATE INDEX IF NOT EXISTS idx_video_plugin_candidates_plugin
        ON video_plugin_candidates(plugin_id);

      CREATE INDEX IF NOT EXISTS idx_video_plugin_candidates_source_plugin
        ON video_plugin_candidates(source_plugin_id);
    `);
  },
};
