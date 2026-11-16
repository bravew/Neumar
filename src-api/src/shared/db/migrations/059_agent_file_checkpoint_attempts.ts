import type Database from 'better-sqlite3';

import type { Migration } from './runner';

/**
 * One checkpoint row per run attempt instead of one per user turn.
 *
 * A retry reuses the user message row but runs in its own SDK session with
 * its own user-message UUID, and its baseline still contains the failed
 * attempt's edits. The old primary key `(task_id, message_row_id)` kept only
 * one row per turn, so "rewind this turn" restored the state after the first
 * attempt instead of before the turn. The autoincrement id orders attempts
 * within a turn for newest-first rewinds.
 */
export const migration: Migration = {
  version: 111,
  description: 'Record one file checkpoint per run attempt',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE agent_file_checkpoints_attempts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id         TEXT NOT NULL,
        message_row_id  INTEGER NOT NULL,
        user_message_id TEXT NOT NULL,
        sdk_session_id  TEXT NOT NULL,
        cwd             TEXT,
        UNIQUE (task_id, user_message_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (message_row_id) REFERENCES messages(id) ON DELETE CASCADE
      );

      INSERT INTO agent_file_checkpoints_attempts
        (task_id, message_row_id, user_message_id, sdk_session_id, cwd)
      SELECT task_id, message_row_id, user_message_id, sdk_session_id, cwd
      FROM agent_file_checkpoints
      ORDER BY message_row_id;

      DROP TABLE agent_file_checkpoints;
      ALTER TABLE agent_file_checkpoints_attempts
        RENAME TO agent_file_checkpoints;

      CREATE INDEX IF NOT EXISTS idx_agent_file_checkpoints_turn
        ON agent_file_checkpoints(task_id, message_row_id, id);
    `);
  },
};
