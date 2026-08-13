import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 99,
  description:
    'Add canonical run verdict and generalized session binding fields',
  up(db: Database.Database) {
    addColumnIfMissing(
      db,
      'agent_runs',
      'completeness',
      "TEXT NOT NULL DEFAULT 'unknown'",
    );
    addColumnIfMissing(
      db,
      'agent_runs',
      'delivery',
      "TEXT NOT NULL DEFAULT 'not_expected'",
    );
    addColumnIfMissing(
      db,
      'agent_runs',
      'retry',
      "TEXT NOT NULL DEFAULT 'not_safe'",
    );
    addColumnIfMissing(db, 'agent_runs', 'failure_cause', 'TEXT');
    addColumnIfMissing(db, 'agent_runs', 'runtime_version', 'TEXT');
    addColumnIfMissing(
      db,
      'agent_runs',
      'attempt',
      'INTEGER NOT NULL DEFAULT 0',
    );
    addColumnIfMissing(db, 'agent_runs', 'session_handle_kind', 'TEXT');
    addColumnIfMissing(db, 'agent_runs', 'invalidation_reason', 'TEXT');

    addColumnIfMissing(db, 'agent_resume_identities', 'project_id', 'TEXT');
    addColumnIfMissing(db, 'agent_resume_identities', 'runtime_id', 'TEXT');
    addColumnIfMissing(
      db,
      'agent_resume_identities',
      'handle_kind',
      "TEXT NOT NULL DEFAULT 'opaque-id'",
    );
    addColumnIfMissing(
      db,
      'agent_resume_identities',
      'last_message_id',
      'TEXT',
    );
    addColumnIfMissing(
      db,
      'agent_resume_identities',
      'schema_version',
      'INTEGER NOT NULL DEFAULT 1',
    );
    db.exec(`
      UPDATE agent_resume_identities
      SET runtime_id = COALESCE(runtime_id, provider_id)
    `);
  },
};
