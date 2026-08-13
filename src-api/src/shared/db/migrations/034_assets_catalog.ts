import { createRequire } from 'node:module';

import type Database from 'better-sqlite3';

import type { Migration } from './runner';

const requireFromHere = createRequire(import.meta.url);

export const migration: Migration = {
  version: 91,
  description: 'Add centralized assets catalog',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        connection_id TEXT,
        source_id TEXT,
        client_request_id TEXT,
        kind TEXT NOT NULL,
        mime TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        duration_ms INTEGER,
        content_hash TEXT,
        perceptual_hash TEXT,
        title TEXT,
        description TEXT,
        caption TEXT,
        ocr_text TEXT,
        transcript TEXT,
        storage_path TEXT,
        thumb_path TEXT,
        preview_path TEXT,
        captured_at INTEGER,
        imported_at INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        deleted_at INTEGER,
        provenance_json TEXT,
        exif_json TEXT,
        gps_lat REAL,
        gps_lng REAL,
        index_state TEXT NOT NULL DEFAULT 'pending',
        index_error TEXT,
        UNIQUE (source, connection_id, source_id),
        UNIQUE (client_request_id)
      );

      CREATE INDEX IF NOT EXISTS idx_assets_content_hash ON assets(content_hash);
      CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
      CREATE INDEX IF NOT EXISTS idx_assets_captured_at ON assets(captured_at);
      CREATE INDEX IF NOT EXISTS idx_assets_source ON assets(source);
      CREATE INDEX IF NOT EXISTS idx_assets_connection ON assets(connection_id, source_id);
      CREATE INDEX IF NOT EXISTS idx_assets_modified_at ON assets(modified_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_local_content_hash_unique
        ON assets(content_hash)
        WHERE source = 'local_fs'
          AND source_id IS NULL
          AND content_hash IS NOT NULL
          AND deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS asset_tags (
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (asset_id, tag)
      );
      CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag);

      CREATE TABLE IF NOT EXISTS asset_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS asset_collection_items (
        collection_id TEXT NOT NULL REFERENCES asset_collections(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (collection_id, asset_id)
      );

      CREATE TABLE IF NOT EXISTS asset_attachments (
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        role TEXT,
        attached_at INTEGER NOT NULL,
        PRIMARY KEY (asset_id, scope, scope_id)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
        asset_id UNINDEXED,
        title,
        description,
        caption,
        ocr_text,
        transcript,
        tag_blob,
        tokenize = 'porter unicode61 remove_diacritics 2'
      );

      CREATE TABLE IF NOT EXISTS asset_embeddings (
        id INTEGER PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        modality TEXT NOT NULL,
        model TEXT NOT NULL,
        dim INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (asset_id, modality, model)
      );
      CREATE INDEX IF NOT EXISTS idx_asset_embeddings_asset ON asset_embeddings(asset_id);

      CREATE TABLE IF NOT EXISTS assets_embedding_config (
        modality TEXT PRIMARY KEY,
        model TEXT,
        dim INTEGER,
        updated_at INTEGER NOT NULL,
        reencode_status TEXT NOT NULL DEFAULT 'idle'
      );

      CREATE TABLE IF NOT EXISTS asset_sync_state (
        source TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        cursor TEXT,
        full_sync_at INTEGER,
        last_synced_at INTEGER,
        last_error TEXT,
        PRIMARY KEY (source, connection_id)
      );

      CREATE TABLE IF NOT EXISTS asset_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT,
        error_text TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        cancelled_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0
      );
    `);

    const vecAvailable = createAssetsVecTable(db);
    const now = Date.now();

    // `assets.catalog_enabled` is intentionally NOT seeded: the flag is opt-out,
    // so an absent setting means enabled (see getFeatureFlag in assets/flags.ts).
    // Only an explicit user/admin write of 'false' disables the catalog.
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))`,
    ).run('assets.vec_available', vecAvailable ? 'true' : 'false');

    db.prepare(
      `INSERT OR IGNORE INTO assets_embedding_config
       (modality, model, dim, updated_at, reencode_status)
       VALUES (?, ?, ?, ?, 'idle')`,
    ).run('text', 'gte-multilingual-base', 768, now);
    db.prepare(
      `INSERT OR IGNORE INTO assets_embedding_config
       (modality, model, dim, updated_at, reencode_status)
       VALUES (?, NULL, NULL, ?, 'idle')`,
    ).run('image', now);
  },
};

function createAssetsVecTable(db: Database.Database): boolean {
  try {
    const sqliteVec = requireFromHere('sqlite-vec') as {
      load: (database: Database.Database) => void;
    };
    sqliteVec.load(db);
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS assets_vec_768 USING vec0(
        embedding float[768],
        modality TEXT,
        model TEXT
      );
    `);
    return true;
  } catch {
    return false;
  }
}
