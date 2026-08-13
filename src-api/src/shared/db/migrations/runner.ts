/**
 * Database Migration Runner
 *
 * Forward-only migration system for better-sqlite3. On every startup it
 * compares the registered migrations against the `_migrations` tracking
 * table and runs any that have not yet been applied, in ascending version
 * order. Each migration runs inside a transaction so a failure leaves the
 * database unchanged — the same migration will be retried on the next startup.
 *
 * ## Adding a new migration
 *
 *   1. Create `src/shared/db/migrations/NNN_description.ts` exporting a
 *      `Migration` object with a unique integer `version`.
 *   2. Import it in `src/shared/db/index.ts` and append it to the array
 *      passed to `runMigrations()`.
 *
 * Version numbers must be integers and must be strictly increasing. Gaps are
 * allowed (e.g. 1 → 5) but never re-use or reorder an existing version —
 * the runner treats `_migrations` as the authoritative record of what has
 * already been applied.
 *
 * ## Rules for writing migrations
 *
 *   - Prefer `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so
 *     the migration is safe to reason about even if it is ever re-run
 *     manually against a partially-migrated database.
 *   - Use `ALTER TABLE … ADD COLUMN` for additive schema changes; SQLite does
 *     not support dropping or renaming columns without a table rebuild.
 *   - Never modify a migration that has already been shipped — add a new one
 *     instead. The runner has no rollback support.
 */

import type Database from 'better-sqlite3';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('MigrationRunner');

/** Shape of a single migration module. */
export interface Migration {
  /** Unique, monotonically increasing integer (e.g. 1, 2, 3 …). */
  version: number;
  /** Human-readable summary stored in `_migrations` for audit purposes. */
  description: string;
  /**
   * Apply this migration to the database.
   * Called inside a transaction — throw to abort and roll back.
   */
  up: (db: Database.Database) => void;
}

/**
 * Create the `_migrations` tracking table if it does not yet exist.
 * Safe to call on every startup — `IF NOT EXISTS` makes it idempotent.
 */
function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Return the set of migration versions that have already been applied.
 * Used to skip migrations that are recorded in `_migrations`.
 */
function getAppliedVersions(db: Database.Database): Set<number> {
  const rows = db
    .prepare('SELECT version FROM _migrations ORDER BY version')
    .all() as { version: number }[];
  return new Set(rows.map((r) => r.version));
}

/**
 * Run all pending migrations against `db`.
 *
 * Migrations that are already recorded in `_migrations` are skipped.
 * Pending migrations are executed in ascending version order, each inside
 * its own transaction. If a migration throws, the transaction is rolled back
 * and the error propagates — the process will exit and the migration will be
 * retried on the next startup.
 *
 * @param db         - An open better-sqlite3 database connection.
 * @param migrations - All known migrations. Order in the array does not
 *                     matter; the runner sorts by `version` before executing.
 */
export function runMigrations(
  db: Database.Database,
  migrations: Migration[],
): void {
  ensureMigrationsTable(db);

  const applied = getAppliedVersions(db);
  // Sort defensively — callers should pass migrations in order, but we
  // guarantee execution order regardless of the array's original ordering.
  const sorted = [...migrations].sort((a, b) => a.version - b.version);

  for (const migration of sorted) {
    if (applied.has(migration.version)) {
      continue; // already applied on a previous startup
    }

    logger.info(
      `Running migration ${String(migration.version).padStart(3, '0')}: ${migration.description}`,
    );

    // Wrap both the DDL and the tracking-table INSERT in one transaction so
    // that a partial failure leaves no trace — the migration will be retried.
    const runInTransaction = db.transaction(() => {
      migration.up(db);
      db.prepare(
        'INSERT INTO _migrations (version, description) VALUES (?, ?)',
      ).run(migration.version, migration.description);
    });

    runInTransaction();
    logger.info(
      `Migration ${String(migration.version).padStart(3, '0')} applied`,
    );
  }
}
