import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as sqliteVec from 'sqlite-vec';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeDatabase,
  Database,
  DATABASE_MIGRATIONS,
  getDatabase,
} from '@/shared/db';
import { runMigrations } from '@/shared/db/migrations/runner';
import { addColumnIfMissing } from '@/shared/db/migrations/utils';

const migrationsDir = fileURLToPath(
  new URL('../../../src/shared/db/migrations/', import.meta.url),
);
const sortedMigrations = [...DATABASE_MIGRATIONS].sort(
  (a, b) => a.version - b.version,
);
// Every migration that adds columns or rebuilds a table. Missing video intent
// tables are supported release-line drift; other missing prerequisites are corruption.
const alterCallers = [
  { version: 28, table: 'agent_profiles' },
  { version: 29, table: 'channel_config' },
  { version: 30, table: 'files' },
  { version: 44, table: 'tasks' },
  { version: 45, table: 'installed_plugins' },
  { version: 50, table: 'messages' },
  { version: 61, table: 'agent_profiles' },
  { version: 70, table: 'webui_sessions' },
  { version: 71, table: 'channel_config' },
  { version: 77, table: 'publish_destination_legs' },
  { version: 83, table: 'publish_jobs' },
  { version: 86, table: 'linked_assets' },
  { version: 88, table: 'embedding_cache' },
  { version: 93, table: 'tasks' },
  { version: 94, table: 'video_projects' },
  { version: 95, table: 'installed_plugins' },
  { version: 96, table: 'video_intent_log', repairable: true },
  { version: 97, table: 'video_plugin_candidates' },
  { version: 99, table: 'agent_runs' },
  { version: 101, table: 'agent_runs' },
  { version: 102, table: 'trace_events' },
  { version: 103, table: 'agent_runs' },
  { version: 104, table: 'agent_runs' },
  { version: 105, table: 'video_intent_log', repairable: true },
  { version: 106, table: 'messages' },
  { version: 108, table: 'video_intent_log', repairable: true },
];

function schema(database: Database.Database) {
  sqliteVec.load(database);
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return tables.map(({ name }) => ({
    name,
    columns: database
      .prepare(
        'SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?) ORDER BY name',
      )
      .all(name),
    indexes: database
      .prepare(
        'SELECT name, "unique", partial FROM pragma_index_list(?) ORDER BY name',
      )
      .all(name),
  }));
}

function versions(database: Database.Database) {
  return database
    .prepare('SELECT version FROM _migrations ORDER BY version')
    .all();
}

let appDir: string;
const connections: Database.Database[] = [];
function memoryDatabase() {
  const database = new Database(':memory:');
  connections.push(database);
  return database;
}

beforeEach(() => {
  closeDatabase();
  appDir = mkdtempSync(join(tmpdir(), 'neumar-migration-drift-'));
  vi.stubEnv('NEUMAR_APP_DATA_DIR', appDir);
});
afterEach(async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  closeDatabase();
  for (const database of connections.splice(0)) database.close();
  vi.unstubAllEnvs();
  rmSync(appDir, { recursive: true, force: true });
});

describe('full migration registry upgrade histories', () => {
  it('audits every migration with an ALTER caller', () => {
    const audited = readdirSync(migrationsDir)
      .filter((file) => /^\d{3}_.*\.ts$/.test(file))
      .flatMap((file) => {
        const source = readFileSync(join(migrationsDir, file), 'utf8');
        if (!/addColumnIfMissing\(|ALTER TABLE/.test(source)) return [];
        const match = /version:\s*(\d+),/.exec(source);
        if (!match) throw new Error(`Missing version in ${file}`);
        return [Number(match[1])];
      })
      .sort((a, b) => a - b);
    expect(alterCallers.map(({ version }) => version)).toEqual(audited);
  });

  it('initializes a fresh database and reopens a current one without changing schema or user data', () => {
    const database = getDatabase();
    const expectedSchema = schema(database);
    const expectedVersions = versions(database);
    expect(expectedVersions).toEqual(
      sortedMigrations.map(({ version }) => ({ version })),
    );
    database
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run('migration-sentinel', 'keep');
    closeDatabase();
    const reopened = getDatabase();
    expect(schema(reopened)).toEqual(expectedSchema);
    expect(versions(reopened)).toEqual(expectedVersions);
    expect(
      reopened
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('migration-sentinel'),
    ).toEqual({ value: 'keep' });
    expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it.each(alterCallers)(
    'finishes the entire registry when migration $version has schema but no tracking record',
    ({ version }) => {
      const database = memoryDatabase();
      const prefix = sortedMigrations.filter(
        (migration) => migration.version <= version,
      );
      runMigrations(database, prefix);
      database
        .prepare('DELETE FROM _migrations WHERE version = ?')
        .run(version);
      database
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
        .run('migration-sentinel', 'keep');
      runMigrations(database, DATABASE_MIGRATIONS);
      expect(schema(database)).toEqual(schema(getDatabase()));
      expect(versions(database)).toEqual(versions(getDatabase()));
      expect(
        database
          .prepare('SELECT value FROM settings WHERE key = ?')
          .get('migration-sentinel'),
      ).toEqual({ value: 'keep' });
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
    },
  );

  it.each(alterCallers)(
    'handles the missing prerequisite for migration $version according to its policy',
    ({ version, table, repairable }) => {
      const database = memoryDatabase();
      runMigrations(
        database,
        sortedMigrations.filter((migration) => migration.version < version),
      );
      database.exec(`DROP TABLE ${table}`);
      if (repairable) {
        runMigrations(database, DATABASE_MIGRATIONS);
        expect(schema(database)).toEqual(schema(getDatabase()));
        expect(versions(database)).toEqual(versions(getDatabase()));
      } else {
        const before = versions(database);
        expect(() => runMigrations(database, DATABASE_MIGRATIONS)).toThrow(
          new RegExp(table),
        );
        expect(versions(database)).toEqual(before);
      }
    },
  );
});

describe('migration failure publication boundary', () => {
  it('distinguishes a missing required table from a missing column', () => {
    const database = memoryDatabase();
    expect(() =>
      addColumnIfMissing(database, 'missing_tasks', 'mode', 'TEXT'),
    ).toThrow(
      'Cannot add column missing_tasks.mode: required table missing_tasks does not exist',
    );
  });

  it('refuses a current database missing a required column on every initialization attempt', () => {
    getDatabase().exec('ALTER TABLE messages DROP COLUMN is_error');
    closeDatabase();
    expect(() => getDatabase()).toThrow(
      /missing required column\(s\): messages.is_error/,
    );
    expect(() => getDatabase()).toThrow(
      /missing required column\(s\): messages.is_error/,
    );
    const repaired = new Database(join(appDir, 'database.db'));
    try {
      repaired.exec(
        'ALTER TABLE messages ADD COLUMN is_error INTEGER NOT NULL DEFAULT 0',
      );
    } finally {
      repaired.close();
    }
    expect(() => getDatabase()).not.toThrow();
  });

  it('rejects a damaged SQLite file and retries after the file is repaired', () => {
    const dbPath = join(appDir, 'database.db');
    writeFileSync(dbPath, 'damaged database bytes');
    expect(() => getDatabase()).toThrow(/not a database/i);
    expect(() => getDatabase()).toThrow(/not a database/i);
    rmSync(dbPath);
    expect(() => getDatabase()).not.toThrow();
  });
});
