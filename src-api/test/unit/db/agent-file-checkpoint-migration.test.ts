import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migration as attemptsMigration } from '@/shared/db/migrations/059_agent_file_checkpoint_attempts';
import { runMigrations } from '@/shared/db/migrations/runner';

function legacyDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE tasks (id TEXT PRIMARY KEY);
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      branch_id TEXT
    );
    CREATE TABLE agent_file_checkpoints (
      task_id             TEXT NOT NULL,
      message_row_id      INTEGER NOT NULL,
      user_message_id     TEXT NOT NULL,
      sdk_session_id      TEXT NOT NULL,
      cwd                 TEXT,
      PRIMARY KEY (task_id, message_row_id),
      UNIQUE (task_id, user_message_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (message_row_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    INSERT INTO tasks (id) VALUES ('task-1');
    INSERT INTO messages (id, task_id, type, branch_id)
      VALUES (7, 'task-1', 'user', 'main');
    INSERT INTO agent_file_checkpoints
      (task_id, message_row_id, user_message_id, sdk_session_id, cwd)
      VALUES ('task-1', 7, 'sdk-message-old', 'sdk-session-old', '/work');
  `);
  return db;
}

interface CheckpointRow {
  task_id: string;
  message_row_id: number;
  user_message_id: string;
  sdk_session_id: string;
  cwd: string | null;
}

function rows(db: Database.Database): CheckpointRow[] {
  return db
    .prepare(
      `SELECT task_id, message_row_id, user_message_id, sdk_session_id, cwd
       FROM agent_file_checkpoints ORDER BY id`,
    )
    .all() as CheckpointRow[];
}

describe('agent file checkpoint attempts migration', () => {
  it('keeps existing rows and allows one row per attempt', () => {
    const db = legacyDatabase();
    try {
      runMigrations(db, [attemptsMigration]);

      expect(rows(db)).toEqual([
        {
          task_id: 'task-1',
          message_row_id: 7,
          user_message_id: 'sdk-message-old',
          sdk_session_id: 'sdk-session-old',
          cwd: '/work',
        },
      ]);

      db.prepare(
        `INSERT INTO agent_file_checkpoints
           (task_id, message_row_id, user_message_id, sdk_session_id, cwd)
         VALUES ('task-1', 7, 'sdk-message-retry', 'sdk-session-retry', '/work')`,
      ).run();
      expect(rows(db).map((row) => row.sdk_session_id)).toEqual([
        'sdk-session-old',
        'sdk-session-retry',
      ]);

      expect(() =>
        db
          .prepare(
            `INSERT INTO agent_file_checkpoints
               (task_id, message_row_id, user_message_id, sdk_session_id, cwd)
             VALUES ('task-1', 7, 'sdk-message-old', 'sdk-session-dup', '/work')`,
          )
          .run(),
      ).toThrow(/UNIQUE/);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      db.close();
    }
  });

  it('rebuilds again when the schema exists but the migration is untracked', () => {
    const db = legacyDatabase();
    try {
      runMigrations(db, [attemptsMigration]);
      db.prepare(
        `INSERT INTO agent_file_checkpoints
           (task_id, message_row_id, user_message_id, sdk_session_id, cwd)
         VALUES ('task-1', 7, 'sdk-message-retry', 'sdk-session-retry', '/work')`,
      ).run();
      db.prepare('DELETE FROM _migrations WHERE version = ?').run(
        attemptsMigration.version,
      );

      runMigrations(db, [attemptsMigration]);

      expect(rows(db).map((row) => row.sdk_session_id)).toEqual([
        'sdk-session-old',
        'sdk-session-retry',
      ]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      db.close();
    }
  });
});
