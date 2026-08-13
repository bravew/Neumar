import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 81,
  description: 'Channel singleton leases',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS channel_leases (
        key        TEXT    PRIMARY KEY,
        holder     TEXT    NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_channel_leases_expires_at
        ON channel_leases(expires_at);
    `);
  },
};
