import type Database from 'better-sqlite3';

import type { Migration } from './runner';

// One resume identity per task: which provider/model/workspace produced the
// stored native session id. /agent/resume compares this record before handing
// the session id to a provider runtime, so a stale or cross-provider id is
// never replayed into the wrong SDK (07-06 sync plan, checkpoint 2).
export const migration: Migration = {
  version: 46,
  description: 'Add agent resume identity table',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_resume_identities (
        task_id           TEXT PRIMARY KEY,
        provider_id       TEXT NOT NULL,
        model_id          TEXT,
        workspace_root    TEXT,
        native_session_id TEXT NOT NULL,
        created_at        TEXT NOT NULL,
        last_seen_at      TEXT NOT NULL
      )
    `);
  },
};
