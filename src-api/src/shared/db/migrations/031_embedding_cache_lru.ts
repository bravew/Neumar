import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 88,
  description: 'Add embedding cache access timestamps',
  up(db: Database.Database) {
    addColumnIfMissing(db, 'embedding_cache', 'accessed_at', 'TEXT');

    db.exec(`
      UPDATE embedding_cache
      SET accessed_at = COALESCE(accessed_at, created_at, datetime('now'));

      CREATE INDEX IF NOT EXISTS idx_embedding_cache_accessed_at
        ON embedding_cache(accessed_at);
    `);
  },
};
