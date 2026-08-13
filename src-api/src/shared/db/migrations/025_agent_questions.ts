import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 82,
  description: 'Persist agent human-in-the-loop questions',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_questions (
        id             TEXT PRIMARY KEY NOT NULL,
        session_id     TEXT NOT NULL,
        task_id        TEXT,
        tool_use_id    TEXT,
        questions_json TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'answered', 'cancelled', 'expired')),
        answer_json    TEXT,
        asked_at       TEXT NOT NULL DEFAULT (datetime('now')),
        answered_at    TEXT,
        expires_at     TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agent_questions_session_pending
        ON agent_questions(session_id, status, asked_at);

      CREATE INDEX IF NOT EXISTS idx_agent_questions_task_pending
        ON agent_questions(task_id, status, asked_at);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_questions_tool_pending
        ON agent_questions(task_id, tool_use_id)
        WHERE task_id IS NOT NULL
          AND tool_use_id IS NOT NULL
          AND status = 'pending';
    `);
  },
};
