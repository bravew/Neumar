import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 105,
  description: 'Link video intent log turns to durable agent plans',
  up(db: Database.Database) {
    addColumnIfMissing(db, 'video_intent_log', 'plan_id', 'TEXT');
    addColumnIfMissing(db, 'video_intent_log', 'plan_revision', 'INTEGER');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_video_intent_log_plan
        ON video_intent_log(project_id, plan_id, plan_revision)
    `);
  },
};
