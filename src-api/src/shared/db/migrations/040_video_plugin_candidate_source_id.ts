import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 97,
  description: 'Track source plugin ids for video plugin candidates',
  up(db: Database.Database) {
    addColumnIfMissing(
      db,
      'video_plugin_candidates',
      'source_plugin_id',
      'TEXT',
    );
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_video_plugin_candidates_source_plugin
        ON video_plugin_candidates(source_plugin_id);
    `);
  },
};
