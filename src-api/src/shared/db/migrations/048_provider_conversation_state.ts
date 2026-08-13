import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 100,
  description: 'Add provider-owned conversation state for exact wire replay',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS provider_conversation_state (
        task_id          TEXT PRIMARY KEY,
        provider_id      TEXT NOT NULL,
        model_id         TEXT NOT NULL,
        workspace_root   TEXT NOT NULL,
        schema_version   INTEGER NOT NULL DEFAULT 1,
        messages_json    TEXT NOT NULL,
        estimated_tokens INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_provider_conversation_state_updated
        ON provider_conversation_state(updated_at);
    `);
  },
};
