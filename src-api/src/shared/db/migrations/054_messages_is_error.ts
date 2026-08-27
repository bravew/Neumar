import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 106,
  description: 'Persist agent tool-result error state',
  up(db: Database.Database) {
    addColumnIfMissing(
      db,
      'messages',
      'is_error',
      'INTEGER NOT NULL DEFAULT 0',
    );
  },
};
