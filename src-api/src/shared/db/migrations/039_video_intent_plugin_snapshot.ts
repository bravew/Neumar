import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing, hasTable } from './utils';

export const migration: Migration = {
  version: 96,
  description: 'Persist applied video plugin snapshots on intent log turns',
  up(db: Database.Database) {
    // `video_intent_log` comes from version 89. An install whose version 89
    // was consumed by a different release line never got that table, and a
    // throw here would abort every later migration in the chain. Skip instead
    // — version 108 creates the table and re-applies this column.
    if (!hasTable(db, 'video_intent_log')) return;

    addColumnIfMissing(db, 'video_intent_log', 'applied_plugin_json', 'TEXT');
  },
};
