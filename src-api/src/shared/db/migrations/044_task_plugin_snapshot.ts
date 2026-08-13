import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 44,
  description: 'Record applied plugin snapshots on tasks',
  up(db: Database.Database) {
    addColumnIfMissing(db, 'tasks', 'applied_plugin_id', 'TEXT');
    addColumnIfMissing(db, 'tasks', 'applied_plugin_snapshot_json', 'TEXT');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_applied_plugin
        ON tasks(applied_plugin_id);
    `);
  },
};
