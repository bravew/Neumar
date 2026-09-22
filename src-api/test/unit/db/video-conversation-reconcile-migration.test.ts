import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { DATABASE_MIGRATIONS } from '@/shared/db';
import { migration as videoModeFoundation } from '@/shared/db/migrations/027_video_mode_foundation';
import { migration as videoIntentPluginSnapshot } from '@/shared/db/migrations/039_video_intent_plugin_snapshot';
import { migration as videoIntentPlanIdentity } from '@/shared/db/migrations/053_video_intent_plan_identity';
import { migration as reconcileVideoConversation } from '@/shared/db/migrations/056_reconcile_video_conversation_schema';
import { runMigrations } from '@/shared/db/migrations/runner';

/**
 * The migrations that touch `video_intent_log` after the versions the drift
 * consumed. The runner sorts by version, so 96 still runs before 108 here —
 * the ordering that made 96 abort the chain before the repair could run.
 */
const CHAIN = [
  videoIntentPluginSnapshot,
  videoIntentPlanIdentity,
  reconcileVideoConversation,
];

/**
 * A database whose versions 89 and 90 were consumed by a different release
 * line: `video_projects` exists, but none of the video conversation tables do.
 */
function driftedDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    );
    CREATE TABLE _migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO _migrations (version, description) VALUES
      (89, 'unrelated migration from another release'),
      (90, 'unrelated migration from another release');
  `);
  videoModeFoundation.up(db);
  return db;
}

function columnNames(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as Array<{
      name: string;
    }>
  ).map((column) => column.name);
}

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function appliedVersions(db: Database.Database): number[] {
  return (
    db.prepare('SELECT version FROM _migrations').all() as Array<{
      version: number;
    }>
  ).map((row) => row.version);
}

describe('video conversation schema reconciliation', () => {
  it('does not abort the chain when version 89 was consumed elsewhere', () => {
    const db = driftedDatabase();
    expect(tableNames(db)).not.toContain('video_intent_log');

    expect(() => runMigrations(db, CHAIN)).not.toThrow();

    // 96 previously threw "no such table: video_intent_log", so every later
    // migration — 108's repair included — was never reached.
    for (const migration of CHAIN) {
      expect(appliedVersions(db)).toContain(migration.version);
    }
  });

  it('recreates the tables the consumed versions should have added', () => {
    const db = driftedDatabase();
    runMigrations(db, CHAIN);

    const tables = tableNames(db);
    expect(tables).toContain('video_intent_log');
    expect(tables).toContain('video_recipes');
    expect(tables).toContain('video_host_capabilities');
    expect(tables).toContain('video_recipe_style_presets');
    expect(tables).toContain('video_session_cost');
  });

  it('re-applies the intent log columns the skipped migrations own', () => {
    const db = driftedDatabase();
    runMigrations(db, CHAIN);

    const columns = columnNames(db, 'video_intent_log');
    expect(columns).toContain('applied_plugin_json');
    expect(columns).toContain('plan_id');
    expect(columns).toContain('plan_revision');
  });

  it('seeds built-in recipes with post-rename tool names', () => {
    const db = driftedDatabase();
    runMigrations(db, CHAIN);

    const sequences = (
      db
        .prepare(
          `SELECT tool_sequence_json FROM video_recipes WHERE is_builtin = 1`,
        )
        .all() as Array<{ tool_sequence_json: string }>
    )
      .map((row) => row.tool_sequence_json)
      .join(' ');

    expect(sequences).not.toBe('');
    expect(sequences).toContain('video_describe_scene');
    expect(sequences).not.toContain('"analyze_source"');
  });

  it('is a no-op against a database that already has the video schema', () => {
    const db = driftedDatabase();
    runMigrations(db, CHAIN);
    const before = db
      .prepare('SELECT COUNT(*) AS count FROM video_recipes')
      .get() as { count: number };

    // Replay as if 108 had not been recorded — a reconcile migration must be
    // safe to re-run against an already-correct database.
    db.prepare('DELETE FROM _migrations WHERE version = ?').run(
      reconcileVideoConversation.version,
    );
    expect(() => runMigrations(db, CHAIN)).not.toThrow();

    const after = db
      .prepare('SELECT COUNT(*) AS count FROM video_recipes')
      .get() as { count: number };
    expect(after.count).toBe(before.count);
    expect(columnNames(db, 'video_intent_log')).toContain('plan_id');
  });
});

describe('full migration registry against a drifted database', () => {
  /**
   * Mirrors the real failure more closely than `driftedDatabase()` can: build a
   * correct database with the whole registry, then reshape it into the install
   * that broke — versions up to 95 recorded, the 032 tables absent, everything
   * from 96 on still pending. Every prerequisite the unrelated migrations need
   * is present, so this exercises the real chain rather than a hand-picked slice.
   */
  function realisticDriftedDatabase(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    runMigrations(db, DATABASE_MIGRATIONS);

    db.exec(`
      DROP TABLE IF EXISTS video_intent_log;
      DROP TABLE IF EXISTS video_recipes;
      DROP TABLE IF EXISTS video_host_capabilities;
      DROP TABLE IF EXISTS video_recipe_style_presets;
    `);
    db.prepare('DELETE FROM _migrations WHERE version >= 96').run();
    return db;
  }

  it('runs to completion and restores the columns the request path needs', () => {
    const db = realisticDriftedDatabase();

    expect(() => runMigrations(db, DATABASE_MIGRATIONS)).not.toThrow();

    // The two columns whose absence surfaced as request-time 500s.
    expect(columnNames(db, 'agent_runs')).toContain('mode');
    expect(columnNames(db, 'messages')).toContain('is_error');
    expect(columnNames(db, 'video_intent_log')).toContain(
      'applied_plugin_json',
    );

    const applied = appliedVersions(db);
    for (const migration of DATABASE_MIGRATIONS) {
      expect(applied).toContain(migration.version);
    }
  });
});
