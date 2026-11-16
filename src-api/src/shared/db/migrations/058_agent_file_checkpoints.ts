import type Database from 'better-sqlite3';

import type { Migration } from './runner';

/** The SDK UUID belongs to a run, not to the client message ID shown in Activity. */
export const migration: Migration = {
  version: 110,
  description: 'Map task turns to Claude file checkpoints',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_file_checkpoints (
        task_id             TEXT NOT NULL,
        message_row_id      INTEGER NOT NULL,
        user_message_id     TEXT NOT NULL,
        sdk_session_id      TEXT NOT NULL,
        cwd                 TEXT,
        PRIMARY KEY (task_id, message_row_id),
        UNIQUE (task_id, user_message_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (message_row_id) REFERENCES messages(id) ON DELETE CASCADE
      );
    `);
  },
};
