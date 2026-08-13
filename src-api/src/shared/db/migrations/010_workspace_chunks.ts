/**
 * Workspace RAG — chunked source files for `workspace_search` MCP tool.
 *
 * Mirrors the memory subsystem's hybrid retrieval (FTS5 + sqlite-vec) but
 * indexes user code rather than long-term memories. The vec_workspace
 * virtual table is created lazily by the indexer on first run, since
 * it depends on the embedding dimension and on the sqlite-vec extension
 * being loaded — both are owned by the memory service today.
 */

import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 54,
  description: 'Workspace RAG chunks + FTS index',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        symbol TEXT,
        language TEXT,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workspace_chunks_path
        ON workspace_chunks(path);

      CREATE INDEX IF NOT EXISTS idx_workspace_chunks_hash
        ON workspace_chunks(content_hash);

      CREATE VIRTUAL TABLE IF NOT EXISTS workspace_chunks_fts USING fts5(
        content,
        path,
        symbol,
        content='workspace_chunks',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS workspace_chunks_ai
      AFTER INSERT ON workspace_chunks BEGIN
        INSERT INTO workspace_chunks_fts(rowid, content, path, symbol)
        VALUES (new.rowid, new.content, new.path, COALESCE(new.symbol, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS workspace_chunks_ad
      AFTER DELETE ON workspace_chunks BEGIN
        INSERT INTO workspace_chunks_fts(workspace_chunks_fts, rowid, content, path, symbol)
        VALUES('delete', old.rowid, old.content, old.path, COALESCE(old.symbol, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS workspace_chunks_au
      AFTER UPDATE ON workspace_chunks BEGIN
        INSERT INTO workspace_chunks_fts(workspace_chunks_fts, rowid, content, path, symbol)
        VALUES('delete', old.rowid, old.content, old.path, COALESCE(old.symbol, ''));
        INSERT INTO workspace_chunks_fts(rowid, content, path, symbol)
        VALUES (new.rowid, new.content, new.path, COALESCE(new.symbol, ''));
      END;

      CREATE TABLE IF NOT EXISTS workspace_index_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  },
};
