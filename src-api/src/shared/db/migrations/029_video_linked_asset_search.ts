import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 86,
  description: 'Add linked asset search metadata and FTS index',
  up(db: Database.Database) {
    addColumnIfMissing(db, 'linked_assets', 'caption_provider', 'TEXT');
    addColumnIfMissing(db, 'linked_assets', 'caption_model', 'TEXT');
    addColumnIfMissing(db, 'linked_assets', 'embedding_model', 'TEXT');
    addColumnIfMissing(db, 'linked_assets', 'embedding_dim', 'INTEGER');
    addColumnIfMissing(db, 'linked_assets', 'embedded_at', 'TEXT');

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS linked_assets_fts USING fts5(
        name,
        description,
        mime,
        kind,
        content='linked_assets',
        content_rowid='rowid',
        tokenize='unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS linked_assets_ai
      AFTER INSERT ON linked_assets BEGIN
        INSERT INTO linked_assets_fts(rowid, name, description, mime, kind)
        VALUES (
          new.rowid,
          new.name,
          COALESCE(new.description, ''),
          COALESCE(new.mime, ''),
          new.kind
        );
      END;

      CREATE TRIGGER IF NOT EXISTS linked_assets_ad
      AFTER DELETE ON linked_assets BEGIN
        INSERT INTO linked_assets_fts(linked_assets_fts, rowid, name, description, mime, kind)
        VALUES(
          'delete',
          old.rowid,
          old.name,
          COALESCE(old.description, ''),
          COALESCE(old.mime, ''),
          old.kind
        );
      END;

      CREATE TRIGGER IF NOT EXISTS linked_assets_au
      AFTER UPDATE ON linked_assets BEGIN
        INSERT INTO linked_assets_fts(linked_assets_fts, rowid, name, description, mime, kind)
        VALUES(
          'delete',
          old.rowid,
          old.name,
          COALESCE(old.description, ''),
          COALESCE(old.mime, ''),
          old.kind
        );
        INSERT INTO linked_assets_fts(rowid, name, description, mime, kind)
        VALUES (
          new.rowid,
          new.name,
          COALESCE(new.description, ''),
          COALESCE(new.mime, ''),
          new.kind
        );
      END;

      INSERT INTO linked_assets_fts(rowid, name, description, mime, kind)
      SELECT rowid, name, COALESCE(description, ''), COALESCE(mime, ''), kind
      FROM linked_assets
      WHERE rowid NOT IN (SELECT rowid FROM linked_assets_fts);
    `);
  },
};
