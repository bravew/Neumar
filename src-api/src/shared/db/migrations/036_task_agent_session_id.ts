import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 93,
  description: 'Add resumable agent session ID to tasks',
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{
      name: string;
    }>;
    const hasAgentSessionId = columns.some(
      (column) => column.name === 'agent_session_id',
    );
    if (!hasAgentSessionId) {
      db.exec(`ALTER TABLE tasks ADD COLUMN agent_session_id TEXT`);
    }
  },
};
