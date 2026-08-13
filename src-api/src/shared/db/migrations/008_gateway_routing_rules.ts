import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 61,
  description: 'Gateway channel health and routing rules',
  up(db: Database.Database) {
    addColumnIfMissing(
      db,
      'agent_profiles',
      'routing_hints',
      "TEXT DEFAULT '{}'",
    );

    db.exec(`
      CREATE TABLE IF NOT EXISTS gateway_channels (
        id TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 0,
        config TEXT NOT NULL DEFAULT '{}',
        status TEXT DEFAULT 'disconnected',
        last_error TEXT,
        last_connected_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS routing_rules (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT '*',
        channel_id TEXT NOT NULL DEFAULT '*',
        chat_pattern TEXT NOT NULL DEFAULT '*',
        intent TEXT NOT NULL DEFAULT '*',
        profile_id TEXT NOT NULL,
        model_override TEXT,
        priority INTEGER NOT NULL DEFAULT 100,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_routing_rules_lookup
        ON routing_rules(enabled, workspace_id, channel_id, intent, priority);
    `);
  },
};
