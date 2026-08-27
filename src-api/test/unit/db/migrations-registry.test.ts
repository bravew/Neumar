import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase, DATABASE_MIGRATIONS, getDatabase } from '@/shared/db';
import type { Migration } from '@/shared/db/migrations/runner';
import {
  createMessage,
  createSession,
  createTask,
} from '@/shared/db/operations';

const migrationsDir = fileURLToPath(
  new URL('../../../src/shared/db/migrations/', import.meta.url),
);
const migrationFilePattern = /^\d{3}_.+\.ts$/;
const migrationVersionPattern = /version:\s*(\d+),/;

function sortedVersions(migrations: readonly Migration[]): number[] {
  return migrations.map((migration) => migration.version).sort((a, b) => a - b);
}

function readMigrationVersions(): number[] {
  return readdirSync(migrationsDir)
    .filter((filename) => migrationFilePattern.test(filename))
    .map((filename) => {
      const source = readFileSync(join(migrationsDir, filename), 'utf8');
      const match = migrationVersionPattern.exec(source);

      if (!match) {
        throw new Error(`Missing migration version in ${filename}`);
      }

      return Number(match[1]);
    })
    .sort((a, b) => a - b);
}

describe('database migration registry', () => {
  afterEach(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    closeDatabase();
  });

  it('registers every numbered migration file exactly once', () => {
    const registeredVersions = sortedVersions(DATABASE_MIGRATIONS);
    const fileVersions = readMigrationVersions();

    expect(registeredVersions).toEqual(fileVersions);
    expect(new Set(registeredVersions).size).toBe(registeredVersions.length);
    expect(registeredVersions).toContain(93);
    expect(registeredVersions).toContain(101);
    expect(registeredVersions).toContain(103);
    expect(registeredVersions).toContain(104);
    expect(registeredVersions).toContain(106);
  });

  it('creates the task agent session column after migrations run', () => {
    const db = getDatabase();
    const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{
      name: string;
    }>;

    expect(columns.map((column) => column.name)).toContain('agent_session_id');
  });

  it('creates the durable tool-result error flag', () => {
    const db = getDatabase();
    const columns = db.prepare('PRAGMA table_info(messages)').all() as Array<{
      name: string;
    }>;

    expect(columns.map((column) => column.name)).toContain('is_error');
  });

  it('persists the tool-result error flag', () => {
    const sessionId = `session-${randomUUID()}`;
    const taskId = `task-${randomUUID()}`;
    createSession({ id: sessionId, prompt: 'Test tool error persistence' });
    createTask({
      id: taskId,
      session_id: sessionId,
      task_index: 1,
      prompt: 'Run a tool',
    });

    const message = createMessage({
      task_id: taskId,
      type: 'tool_result',
      tool_use_id: 'tool-1',
      tool_output: '{"error":"failed"}',
      is_error: true,
    });

    expect(message.is_error).toBe(1);
    getDatabase().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  });
});
