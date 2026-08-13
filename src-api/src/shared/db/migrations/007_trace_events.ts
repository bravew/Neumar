import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 60,
  description:
    'Observability trace events for agent runs and eval cost rollups',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS trace_events (
        id              TEXT PRIMARY KEY,
        task_id         TEXT NOT NULL,
        session_id      TEXT,
        message_id      TEXT,
        parent_event_id TEXT,
        kind            TEXT NOT NULL,
        agent           TEXT,
        provider        TEXT,
        model           TEXT,
        profile         TEXT,
        tool            TEXT,
        status          TEXT NOT NULL,
        started_at      INTEGER NOT NULL,
        ended_at        INTEGER,
        duration_ms     INTEGER,
        input_tokens    INTEGER,
        output_tokens   INTEGER,
        cache_read      INTEGER,
        cache_creation  INTEGER,
        cost_usd        REAL,
        attrs_json      TEXT,
        error_json      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_trace_task_started
        ON trace_events(task_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_trace_kind
        ON trace_events(kind, started_at);
      CREATE INDEX IF NOT EXISTS idx_trace_provider_day
        ON trace_events(provider, model, started_at);
      CREATE INDEX IF NOT EXISTS idx_trace_message
        ON trace_events(message_id);
    `);
  },
};
