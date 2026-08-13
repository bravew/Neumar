import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 74,
  description: 'Cloud storage local cursors',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_storage_local_cursors (
        connection_id TEXT NOT NULL,
        root_id TEXT NOT NULL,
        last_change_id_seen TEXT,
        last_polled_at TEXT,
        PRIMARY KEY (connection_id, root_id),
        FOREIGN KEY (connection_id)
          REFERENCES cloud_storage_connections_cache(id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_cloud_storage_local_cursors_polled
        ON cloud_storage_local_cursors(last_polled_at);
    `);
  },
};
