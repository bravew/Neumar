import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

/**
 * Repairs installs whose global migration versions were consumed by a
 * different release before runtime-state and provider conversation migrations
 * shipped in this line.
 */
export const migration: Migration = {
  version: 104,
  description: 'Reconcile legacy runtime and conversation schema',
  up(db: Database.Database) {
    for (const [column, definition] of [
      ['completeness', "TEXT NOT NULL DEFAULT 'unknown'"],
      ['delivery', "TEXT NOT NULL DEFAULT 'not_expected'"],
      ['retry', "TEXT NOT NULL DEFAULT 'not_safe'"],
      ['failure_cause', 'TEXT'],
      ['runtime_version', 'TEXT'],
      ['attempt', 'INTEGER NOT NULL DEFAULT 0'],
      ['session_handle_kind', 'TEXT'],
      ['invalidation_reason', 'TEXT'],
    ] as const) {
      addColumnIfMissing(db, 'agent_runs', column, definition);
    }

    for (const [column, definition] of [
      ['project_id', 'TEXT'],
      ['runtime_id', 'TEXT'],
      ['handle_kind', "TEXT NOT NULL DEFAULT 'opaque-id'"],
      ['last_message_id', 'TEXT'],
      ['schema_version', 'INTEGER NOT NULL DEFAULT 1'],
    ] as const) {
      addColumnIfMissing(db, 'agent_resume_identities', column, definition);
    }
    db.exec(`
      UPDATE agent_resume_identities
      SET runtime_id = COALESCE(runtime_id, provider_id)
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS provider_conversation_state (
        task_id          TEXT PRIMARY KEY,
        provider_id      TEXT NOT NULL,
        model_id         TEXT NOT NULL,
        workspace_root   TEXT NOT NULL,
        schema_version   INTEGER NOT NULL DEFAULT 1,
        messages_json    TEXT NOT NULL,
        estimated_tokens INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_provider_conversation_state_updated
        ON provider_conversation_state(updated_at);
    `);
  },
};
