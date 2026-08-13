import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 73,
  description: 'Cloud storage local mirror cache',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_storage_connections_cache (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        account_email TEXT,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        capabilities_json TEXT,
        connected_at TEXT NOT NULL,
        last_synced_with_site_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_cloud_storage_connections_cache_provider_status
        ON cloud_storage_connections_cache(provider, status);

      CREATE TABLE IF NOT EXISTS cloud_storage_items_cache (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        root_id TEXT,
        provider_item_id TEXT NOT NULL,
        parent_provider_id TEXT,
        name TEXT,
        mime_type TEXT,
        item_type TEXT NOT NULL,
        size_bytes INTEGER,
        web_url TEXT,
        etag TEXT,
        revision TEXT,
        content_hash TEXT,
        modified_at TEXT,
        deleted_at TEXT,
        metadata_json TEXT,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY (connection_id)
          REFERENCES cloud_storage_connections_cache(id)
          ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_storage_items_cache_connection_provider_item
        ON cloud_storage_items_cache(connection_id, provider_item_id);

      CREATE INDEX IF NOT EXISTS idx_cloud_storage_items_cache_root_parent
        ON cloud_storage_items_cache(root_id, parent_provider_id);

      CREATE INDEX IF NOT EXISTS idx_cloud_storage_items_cache_connection_deleted
        ON cloud_storage_items_cache(connection_id, deleted_at);

      CREATE TABLE IF NOT EXISTS cloud_storage_content_jobs (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        provider_item_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        materialized_path TEXT,
        content_fingerprint TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (connection_id)
          REFERENCES cloud_storage_connections_cache(id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_cloud_storage_content_jobs_status_updated
        ON cloud_storage_content_jobs(status, updated_at);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_storage_content_jobs_connection_item_fingerprint
        ON cloud_storage_content_jobs(connection_id, provider_item_id, content_fingerprint);
    `);
  },
};
