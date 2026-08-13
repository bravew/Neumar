import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 77,
  description: 'Publish leg approval columns',
  up(db: Database.Database) {
    addColumnIfMissing(
      db,
      'publish_destination_legs',
      'approval_required',
      'INTEGER NOT NULL DEFAULT 0',
    );
    addColumnIfMissing(db, 'publish_destination_legs', 'approved_by', 'TEXT');
    addColumnIfMissing(db, 'publish_destination_legs', 'approved_at', 'TEXT');
    addColumnIfMissing(
      db,
      'publish_destination_legs',
      'rejection_reason',
      'TEXT',
    );
  },
};
