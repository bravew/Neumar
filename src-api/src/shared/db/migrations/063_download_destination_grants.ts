import type Database from 'better-sqlite3';

import type { Migration } from './runner';

/**
 * Bind a video download to one destination the user chose for it.
 *
 * A row is created when the agent asks where to save a batch, and it is the
 * only thing that authorizes the write: the runner re-checks the directory,
 * device and inode here before it publishes a file. `started` makes the resume
 * single-use, so a repeated or concurrent answer cannot start a second batch.
 * The row keeps the model-facing input (URLs, height cap) so the continuation
 * does not have to trust a transcript.
 */
export const migration: Migration = {
  version: 115,
  description: 'Bind each download batch to one user-chosen destination grant',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS download_destination_grants (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        question_id TEXT,
        directory TEXT NOT NULL,
        device TEXT NOT NULL,
        inode TEXT NOT NULL,
        options_json TEXT NOT NULL,
        input_json TEXT NOT NULL,
        started INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_download_grants_batch
      ON download_destination_grants (task_id, run_id, tool_call_id, batch_id)
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_download_grants_question
      ON download_destination_grants (question_id)
      WHERE question_id IS NOT NULL
    `);
  },
};
