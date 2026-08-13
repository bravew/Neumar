import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 80,
  description: 'Connector tool approval overrides',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS connector_tool_overrides (
        account_id   TEXT    NOT NULL,
        connector_id TEXT    NOT NULL,
        tool_name    TEXT    NOT NULL,
        approval     TEXT    NOT NULL CHECK (approval IN ('auto','confirm','disabled')),
        updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (account_id, connector_id, tool_name)
      );

      CREATE INDEX IF NOT EXISTS connector_tool_overrides_by_connector
        ON connector_tool_overrides(connector_id);
    `);
  },
};
