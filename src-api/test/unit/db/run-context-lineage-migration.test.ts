import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migration as agentRunsMigration } from '@/shared/db/migrations/006_agent_loop_v2';
import { migration as runtimeStateMigration } from '@/shared/db/migrations/047_runtime_state';
import { migration as runContextMigration } from '@/shared/db/migrations/049_run_context_lineage';
import { migration as reconcileRunContextMigration } from '@/shared/db/migrations/051_reconcile_run_context_schema';
import { migration as reconcileLegacyRuntimeMigration } from '@/shared/db/migrations/052_reconcile_legacy_runtime_schema';
import { runMigrations } from '@/shared/db/migrations/runner';

function migratedDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL
    );
    CREATE TABLE approvals (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE agent_resume_identities (
      task_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL
    );
  `);
  agentRunsMigration.up(db);
  runtimeStateMigration.up(db);
  return db;
}

describe('run context and lineage migration', () => {
  it('repairs a database where version 101 was already consumed', () => {
    const db = migratedDatabase();
    db.exec(`
      CREATE TABLE _migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO _migrations (version, description)
      VALUES (101, 'unrelated migration from another release');
    `);

    runMigrations(db, [
      runContextMigration,
      reconcileRunContextMigration,
      reconcileLegacyRuntimeMigration,
    ]);

    const columns = db.prepare('PRAGMA table_info(agent_runs)').all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toContain('mode');
    expect(columns.map((column) => column.name)).toContain('runtime_version');
    expect(
      db
        .prepare('PRAGMA table_info(agent_resume_identities)')
        .all()
        .map((column) => (column as { name: string }).name),
    ).toContain('runtime_id');
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provider_conversation_state'",
        )
        .get(),
    ).toEqual({ name: 'provider_conversation_state' });
    expect(
      db.prepare('SELECT version FROM _migrations WHERE version = 103').get(),
    ).toEqual({ version: 103 });
    expect(
      db.prepare('SELECT version FROM _migrations WHERE version = 104').get(),
    ).toEqual({ version: 104 });
  });

  it('backfills legacy root and descendant lineage without inventing recovery rows', () => {
    const db = migratedDatabase();
    db.prepare(
      `INSERT INTO agent_runs (id, task_id, parent_run_id, provider)
       VALUES (?, ?, ?, ?)`,
    ).run('root-run', 'task-1', null, 'claude');
    db.prepare(
      `INSERT INTO agent_runs (id, task_id, parent_run_id, provider)
       VALUES (?, ?, ?, ?)`,
    ).run('child-run', 'task-1', 'root-run', 'claude');

    runContextMigration.up(db);

    const rows = db
      .prepare(
        `SELECT id, mode, owner_key, execution_id, initial_run_id,
                source_run_id, run_index, recovery_action
         FROM agent_runs ORDER BY id`,
      )
      .all();
    expect(rows).toEqual([
      {
        id: 'child-run',
        mode: 'task',
        owner_key: 'task-1',
        execution_id: 'root-run',
        initial_run_id: 'root-run',
        source_run_id: null,
        run_index: null,
        recovery_action: null,
      },
      {
        id: 'root-run',
        mode: 'task',
        owner_key: 'task-1',
        execution_id: 'root-run',
        initial_run_id: 'root-run',
        source_run_id: null,
        run_index: 0,
        recovery_action: null,
      },
    ]);
  });

  it('enforces scoped request, message, active-root, and run-index uniqueness', () => {
    const db = migratedDatabase();
    runContextMigration.up(db);

    const indexes = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND tbl_name = 'agent_runs'`,
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_agent_runs_request_identity',
        'idx_agent_runs_message_identity',
        'idx_agent_runs_execution_index',
        'idx_agent_runs_active_execution',
        'idx_agent_runs_mode_owner',
        'idx_agent_runs_source',
      ]),
    );

    const insert = db.prepare(
      `INSERT INTO agent_runs (
         id, task_id, provider, mode, owner_key, client_request_id,
         request_message_id, execution_id, initial_run_id, run_index
       ) VALUES (?, ?, 'claude', 'design', ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      'run-1',
      'design-a',
      'design-a',
      'request-1',
      'message-1',
      'run-1',
      'run-1',
      0,
    );

    expect(() =>
      insert.run(
        'run-2',
        'design-a',
        'design-a',
        'request-1',
        'message-2',
        'run-2',
        'run-2',
        0,
      ),
    ).toThrow();
    expect(() =>
      insert.run(
        'run-3',
        'design-a',
        'design-a',
        'request-3',
        'message-1',
        'run-3',
        'run-3',
        0,
      ),
    ).toThrow();

    insert.run(
      'run-other-owner',
      'design-b',
      'design-b',
      'request-1',
      'message-1',
      'run-other-owner',
      'run-other-owner',
      0,
    );

    db.prepare(
      "UPDATE agent_runs SET status = 'failed' WHERE id = 'run-1'",
    ).run();
    expect(() =>
      insert.run(
        'run-4',
        'design-a',
        'design-a',
        'request-4',
        'message-4',
        'run-1',
        'run-1',
        0,
      ),
    ).toThrow();
  });

  it('stores one exact event for each run sequence', () => {
    const db = migratedDatabase();
    runContextMigration.up(db);
    db.prepare(
      `INSERT INTO agent_runs (
         id, task_id, provider, mode, owner_key, execution_id,
         initial_run_id, run_index
       ) VALUES ('run-1', 'task-1', 'claude', 'task', 'task-1',
                 'run-1', 'run-1', 0)`,
    ).run();
    const insert = db.prepare(
      `INSERT INTO agent_run_events
         (run_id, seq, event_type, event_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run('run-1', -1, 'neuma.user_message', '{"text":"hello"}', 'now');

    expect(() =>
      insert.run(
        'run-1',
        -1,
        'neuma.user_message',
        '{"text":"different"}',
        'later',
      ),
    ).toThrow();
    expect(
      db
        .prepare('SELECT event_json FROM agent_run_events WHERE run_id = ?')
        .get('run-1'),
    ).toEqual({ event_json: '{"text":"hello"}' });
  });
});
