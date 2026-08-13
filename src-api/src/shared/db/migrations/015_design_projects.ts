import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 72,
  description: 'DesignMode project index',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS design_projects (
        id TEXT PRIMARY KEY,
        surface TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_design_projects_updated_at
        ON design_projects(updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_design_projects_surface
        ON design_projects(surface);
    `);
  },
};
