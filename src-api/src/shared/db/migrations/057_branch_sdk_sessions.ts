import type Database from 'better-sqlite3';

import type { Migration } from './runner';

// One row per finished agent run that can seed a conversation branch: which
// Claude SDK session the run wrote, on which branch, and how that session was
// obtained. A branch's latest row is the session its next run resumes; a
// `main` row lets a new branch fork the SDK session that produced its fork
// point (issue #74). `mode = 'text'` pins a branch to the plain-text history
// path (a runtime without a fork API, or an invalidated session).
export const migration: Migration = {
  version: 109,
  description: 'Add branch SDK session mapping',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS branch_sdk_sessions (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id                TEXT NOT NULL,
        branch_id              TEXT NOT NULL DEFAULT 'main',
        run_id                 TEXT,
        provider               TEXT NOT NULL,
        mode                   TEXT NOT NULL
          CHECK (mode IN ('fresh', 'fork', 'resume', 'text')),
        sdk_session_id         TEXT,
        forked_from_session_id TEXT,
        prompt_sdk_uuid        TEXT,
        cwd                    TEXT,
        created_at             TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_branch_sdk_sessions_branch
        ON branch_sdk_sessions(task_id, branch_id, id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_sdk_sessions_run
        ON branch_sdk_sessions(run_id) WHERE run_id IS NOT NULL;
    `);
  },
};
