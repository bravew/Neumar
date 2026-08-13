import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 42,
  description: 'Add video media frame search index',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS media_frames (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_id TEXT,
        asset_id TEXT,
        at_ms INTEGER NOT NULL,
        start_ms INTEGER,
        end_ms INTEGER,
        caption TEXT NOT NULL,
        tags_json TEXT,
        thumb_base64 TEXT,
        caption_provider TEXT,
        caption_model TEXT,
        embedding_model TEXT,
        embedding_dim INTEGER,
        embedded_at TEXT,
        indexed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_media_frames_project
        ON media_frames(project_id);
      CREATE INDEX IF NOT EXISTS idx_media_frames_project_source
        ON media_frames(project_id, source_id);
      CREATE INDEX IF NOT EXISTS idx_media_frames_project_asset
        ON media_frames(project_id, asset_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS media_frames_fts USING fts5(
        caption,
        tags,
        asset_id,
        source_id,
        content='media_frames',
        content_rowid='rowid',
        tokenize='unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS media_frames_ai
      AFTER INSERT ON media_frames BEGIN
        INSERT INTO media_frames_fts(rowid, caption, tags, asset_id, source_id)
        VALUES (
          new.rowid,
          new.caption,
          COALESCE(new.tags_json, ''),
          COALESCE(new.asset_id, ''),
          COALESCE(new.source_id, '')
        );
      END;

      CREATE TRIGGER IF NOT EXISTS media_frames_ad
      AFTER DELETE ON media_frames BEGIN
        INSERT INTO media_frames_fts(media_frames_fts, rowid, caption, tags, asset_id, source_id)
        VALUES (
          'delete',
          old.rowid,
          old.caption,
          COALESCE(old.tags_json, ''),
          COALESCE(old.asset_id, ''),
          COALESCE(old.source_id, '')
        );
      END;

      CREATE TRIGGER IF NOT EXISTS media_frames_au
      AFTER UPDATE ON media_frames BEGIN
        INSERT INTO media_frames_fts(media_frames_fts, rowid, caption, tags, asset_id, source_id)
        VALUES (
          'delete',
          old.rowid,
          old.caption,
          COALESCE(old.tags_json, ''),
          COALESCE(old.asset_id, ''),
          COALESCE(old.source_id, '')
        );
        INSERT INTO media_frames_fts(rowid, caption, tags, asset_id, source_id)
        VALUES (
          new.rowid,
          new.caption,
          COALESCE(new.tags_json, ''),
          COALESCE(new.asset_id, ''),
          COALESCE(new.source_id, '')
        );
      END;
    `);
  },
};
