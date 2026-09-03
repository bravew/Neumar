import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 107,
  description: 'External MCP idempotency ledger',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS external_mcp_idempotency (
        surface TEXT NOT NULL,
        request_id TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (surface, request_id)
      );

      CREATE INDEX IF NOT EXISTS idx_external_mcp_idempotency_created
        ON external_mcp_idempotency(created_at DESC);
    `);
  },
};
