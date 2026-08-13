import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 75,
  description: 'Cloud storage local path mappings',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_storage_path_mappings_local (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        immich_path_prefix TEXT NOT NULL,
        local_mount_path TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        verified_at TEXT,
        verification_hash TEXT,
        last_error TEXT,
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (connection_id)
          REFERENCES cloud_storage_connections_cache(id)
          ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_storage_path_mappings_connection_prefix
        ON cloud_storage_path_mappings_local(connection_id, immich_path_prefix);

      CREATE INDEX IF NOT EXISTS idx_cloud_storage_path_mappings_connection_disabled
        ON cloud_storage_path_mappings_local(connection_id, disabled);
    `);
  },
};
