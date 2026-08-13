import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 92,
  description: 'Add asset materialization cache tables',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS asset_cache (
        content_hash TEXT PRIMARY KEY,
        cache_path TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        mime TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        origin_provider TEXT NOT NULL,
        origin_connection_id TEXT,
        origin_source_id TEXT,
        source_file_hint_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_asset_cache_last_used
        ON asset_cache(last_used_at);
      CREATE INDEX IF NOT EXISTS idx_asset_cache_origin
        ON asset_cache(origin_provider, origin_connection_id, origin_source_id);

      CREATE TABLE IF NOT EXISTS asset_materializations (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        active_path TEXT NOT NULL,
        content_hash TEXT,
        bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        license_snapshot_json TEXT,
        client_request_id TEXT,
        role TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_asset_materializations_scope
        ON asset_materializations(scope, scope_id);
      CREATE INDEX IF NOT EXISTS idx_asset_materializations_asset
        ON asset_materializations(asset_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_materializations_idempotency
        ON asset_materializations(scope, scope_id, asset_id, client_request_id)
        WHERE client_request_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS asset_proxies (
        content_hash TEXT NOT NULL REFERENCES asset_cache(content_hash) ON DELETE CASCADE,
        preset TEXT NOT NULL,
        proxy_path TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        duration_ms INTEGER,
        generated_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        PRIMARY KEY (content_hash, preset)
      );

      CREATE TABLE IF NOT EXISTS asset_preview_artifacts (
        content_hash TEXT NOT NULL REFERENCES asset_cache(content_hash) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        data_path TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        generated_at INTEGER NOT NULL,
        PRIMARY KEY (content_hash, kind)
      );
    `);

    db.prepare(
      `INSERT OR IGNORE INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))`,
    ).run('assets.materialize_session_budget_bytes', '5368709120');
    db.prepare(
      `INSERT OR IGNORE INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))`,
    ).run('assets.materialize_project_budget_bytes', '21474836480');
    db.prepare(
      `INSERT OR IGNORE INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))`,
    ).run('assets.cache_max_bytes', '53687091200');
    db.prepare(
      `INSERT OR IGNORE INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))`,
    ).run('assets.cache_ttl_days', '90');
    db.prepare(
      `INSERT OR IGNORE INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))`,
    ).run('assets.materialize_concurrency', '3');
    db.prepare(
      `INSERT OR IGNORE INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))`,
    ).run(
      'assets.proxy_thresholds_json',
      '{"minPixelCount":8294400,"minDurationSeconds":600,"minBytes":524288000}',
    );
    db.prepare(
      `INSERT OR IGNORE INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))`,
    ).run('assets.range_download_min_bytes', '33554432');
  },
};
