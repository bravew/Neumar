import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing, hasTable } from './utils';

export const migration: Migration = {
  version: 105,
  description: 'Link video intent log turns to durable agent plans',
  up(db: Database.Database) {
    // See 039: skip rather than abort the chain when version 89 never ran on
    // this database. Version 108 re-applies these columns and the index.
    if (!hasTable(db, 'video_intent_log')) return;

    addColumnIfMissing(db, 'video_intent_log', 'plan_id', 'TEXT');
    addColumnIfMissing(db, 'video_intent_log', 'plan_revision', 'INTEGER');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_video_intent_log_plan
        ON video_intent_log(project_id, plan_id, plan_revision)
    `);
  },
};
