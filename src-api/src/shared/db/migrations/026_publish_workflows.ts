import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { hasColumn } from './utils';

export const migration: Migration = {
  version: 83,
  description: 'Add versioned publish workflow metadata',
  up(db: Database.Database) {
    if (!hasColumn(db, 'publish_jobs', 'workflow_version')) {
      db.exec(`
        ALTER TABLE publish_jobs
          ADD COLUMN workflow_version TEXT NOT NULL DEFAULT '1.0.0';
      `);
    }

    if (!hasColumn(db, 'publish_jobs', 'workflow_state_json')) {
      db.exec(`
        ALTER TABLE publish_jobs
          ADD COLUMN workflow_state_json TEXT NOT NULL DEFAULT '{}';
      `);
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_publish_jobs_workflow_version
        ON publish_jobs(workflow_version);
    `);
  },
};
