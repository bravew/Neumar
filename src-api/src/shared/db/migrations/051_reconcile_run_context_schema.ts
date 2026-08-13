import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

/**
 * Repairs databases where migration 101 was already recorded by another
 * release before the mode-owned run schema shipped. Migration versions are
 * global to the database, so this must be a new version rather than a change
 * to 049_run_context_lineage.
 */
export const migration: Migration = {
  version: 103,
  description: 'Reconcile mode-owned run identity schema',
  up(db: Database.Database) {
    addColumnIfMissing(
      db,
      'agent_runs',
      'mode',
      "TEXT NOT NULL DEFAULT 'task'",
    );
    addColumnIfMissing(db, 'agent_runs', 'owner_key', 'TEXT');
    addColumnIfMissing(db, 'agent_runs', 'project_id', 'TEXT');
    addColumnIfMissing(db, 'agent_runs', 'conversation_id', 'TEXT');
    addColumnIfMissing(db, 'agent_runs', 'client_request_id', 'TEXT');
    addColumnIfMissing(db, 'agent_runs', 'request_message_id', 'TEXT');
    addColumnIfMissing(db, 'agent_runs', 'execution_id', 'TEXT');
    addColumnIfMissing(db, 'agent_runs', 'initial_run_id', 'TEXT');
    addColumnIfMissing(db, 'agent_runs', 'source_run_id', 'TEXT');
    addColumnIfMissing(db, 'agent_runs', 'run_index', 'INTEGER');
    addColumnIfMissing(db, 'agent_runs', 'recovery_action', 'TEXT');
    addColumnIfMissing(
      db,
      'agent_runs',
      'delivery_reconciliation_deadline',
      'TEXT',
    );

    db.exec(`
      WITH RECURSIVE run_lineage(id, root_id) AS (
        SELECT id, id
        FROM agent_runs
        WHERE parent_run_id IS NULL
        UNION ALL
        SELECT child.id, run_lineage.root_id
        FROM agent_runs AS child
        JOIN run_lineage ON child.parent_run_id = run_lineage.id
      )
      UPDATE agent_runs
      SET mode = COALESCE(mode, 'task'),
          owner_key = COALESCE(owner_key, task_id),
          conversation_id = COALESCE(conversation_id, task_id),
          execution_id = COALESCE(
            execution_id,
            (SELECT root_id FROM run_lineage WHERE run_lineage.id = agent_runs.id),
            id
          ),
          initial_run_id = COALESCE(
            initial_run_id,
            (SELECT root_id FROM run_lineage WHERE run_lineage.id = agent_runs.id),
            id
          ),
          run_index = CASE
            WHEN parent_run_id IS NULL THEN COALESCE(run_index, 0)
            ELSE NULL
          END;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_request_identity
        ON agent_runs(mode, owner_key, client_request_id)
        WHERE client_request_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_message_identity
        ON agent_runs(mode, owner_key, request_message_id)
        WHERE request_message_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_execution_index
        ON agent_runs(execution_id, run_index)
        WHERE parent_run_id IS NULL AND run_index IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_active_execution
        ON agent_runs(execution_id)
        WHERE status = 'running' AND parent_run_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_agent_runs_mode_owner
        ON agent_runs(mode, owner_key, started_at);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_source
        ON agent_runs(source_run_id);

      CREATE TABLE IF NOT EXISTS agent_run_events (
        run_id     TEXT NOT NULL,
        seq        INTEGER NOT NULL CHECK (seq >= -1),
        event_type TEXT NOT NULL,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, seq),
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_run_events_created
        ON agent_run_events(created_at);
    `);
  },
};
