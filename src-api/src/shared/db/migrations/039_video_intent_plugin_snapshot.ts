import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 96,
  description: 'Persist applied video plugin snapshots on intent log turns',
  up(db: Database.Database) {
    addColumnIfMissing(db, 'video_intent_log', 'applied_plugin_json', 'TEXT');
  },
};
