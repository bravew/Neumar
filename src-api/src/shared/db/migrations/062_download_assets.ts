import type Database from 'better-sqlite3';

import type { Migration } from './runner';

/**
 * Remember which finished download files a task may play back.
 *
 * A row names one saved item by task, run, tool call, batch and item, plus the
 * destination grant that authorized the write. It stores the file's basename
 * and identity (`dev`/`ino`, as text because they can exceed 2^53), never a
 * host path: the folder is re-resolved from the grant on every request, so a
 * revoked or moved grant stops playback instead of being cached.
 */
export const migration: Migration = {
  version: 114,
  description: 'Record playable media downloads by task and asset id',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS download_assets (
        asset_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        grant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        dev TEXT NOT NULL,
        ino TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_download_assets_item
      ON download_assets (task_id, run_id, tool_call_id, batch_id, item_id)
    `);
  },
};
