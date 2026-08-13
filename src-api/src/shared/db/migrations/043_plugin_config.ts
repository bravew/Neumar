import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 43,
  description: 'Persist installed plugin configuration values',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_config_values (
        plugin_id   TEXT NOT NULL,
        key         TEXT NOT NULL,
        value_json  TEXT,
        secret_name TEXT,
        sensitive   INTEGER NOT NULL DEFAULT 0,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (plugin_id, key),
        FOREIGN KEY (plugin_id) REFERENCES installed_plugins(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_plugin_config_values_plugin
        ON plugin_config_values(plugin_id);
    `);
  },
};
