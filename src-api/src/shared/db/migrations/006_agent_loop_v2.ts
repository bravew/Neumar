// Forward-only additive migration (SQLite has no DROP COLUMN). The token
// itself is never persisted — only its hash; verify always re-checks HMAC.

import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 50,
  description:
    'Agent loop v2: risk_level + resume_token_hash on approvals, parent_run_id on messages, agent_runs table',
  up(db: Database.Database) {
    const messageColumns = db
      .prepare("PRAGMA table_info('messages')")
      .all() as { name: string }[];
    const hasMsgCol = (n: string) => messageColumns.some((c) => c.name === n);
    if (!hasMsgCol('parent_run_id')) {
      db.exec(`ALTER TABLE messages ADD COLUMN parent_run_id TEXT`);
    }
    if (!hasMsgCol('subagent_id')) {
      db.exec(`ALTER TABLE messages ADD COLUMN subagent_id TEXT`);
    }

    const approvalColumns = db
      .prepare("PRAGMA table_info('approvals')")
      .all() as { name: string }[];
    const hasApprCol = (n: string) => approvalColumns.some((c) => c.name === n);
    if (!hasApprCol('risk_level')) {
      db.exec(
        `ALTER TABLE approvals ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'medium'`,
      );
    }
    if (!hasApprCol('resume_token_hash')) {
      db.exec(`ALTER TABLE approvals ADD COLUMN resume_token_hash TEXT`);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id              TEXT PRIMARY KEY,
        task_id         TEXT NOT NULL,
        parent_run_id   TEXT,
        provider        TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'running',
        started_at      TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at     TEXT,
        cost_usd        REAL NOT NULL DEFAULT 0,
        tokens_in       INTEGER NOT NULL DEFAULT 0,
        tokens_out      INTEGER NOT NULL DEFAULT 0,
        model           TEXT,
        error           TEXT
      )
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_runs_parent ON agent_runs(parent_run_id)`,
    );
    db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_task ON agent_runs(task_id)`);
  },
};
