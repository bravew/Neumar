import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migration as migration025 } from '@/shared/db/migrations/025_agent_questions';
import { runMigrations } from '@/shared/db/migrations/runner';

describe('agent questions migration', () => {
  it('creates the persisted question table and pending indexes', () => {
    const db = new Database(':memory:');
    runMigrations(db, [migration025]);

    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_questions'",
      )
      .get();
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agent_questions'",
      )
      .all() as Array<{ name: string }>;

    expect(table).toBeTruthy();
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        'idx_agent_questions_session_pending',
        'idx_agent_questions_task_pending',
        'idx_agent_questions_tool_pending',
      ]),
    );
    db.close();
  });
});
