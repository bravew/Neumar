import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 98,
  description: 'Persist video agent dock conversation history per project',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS video_agent_history (
        project_id TEXT PRIMARY KEY,
        messages_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  },
};
