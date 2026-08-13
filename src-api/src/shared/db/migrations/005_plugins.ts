/**
 * Migration 005: Installed plugins
 *
 * Tracks plugins installed by the user (from GitHub, URL, local path, or
 * bundled). Loader v2 (`src/shared/plugins/loader.ts`) consults this table
 * to filter out disabled plugins and to record provenance.
 */

import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 40,
  description: 'Add installed_plugins table for plugin/skills marketplace',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS installed_plugins (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        version         TEXT NOT NULL,
        source          TEXT NOT NULL,
        source_ref      TEXT,
        install_path    TEXT NOT NULL,
        scope           TEXT NOT NULL,
        enabled         INTEGER NOT NULL DEFAULT 1,
        manifest_json   TEXT NOT NULL,
        sha256          TEXT,
        signature_ok    INTEGER,
        installed_at    TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_installed_plugins_scope_enabled
        ON installed_plugins(scope, enabled)
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_installed_plugins_name
        ON installed_plugins(name)
    `);
  },
};
