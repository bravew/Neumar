/**
 * Shared migration utilities.
 */

import type Database from 'better-sqlite3';

/** Check whether a table already has a given column. */
export function hasColumn(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}

/** Conditionally add a column if it doesn't exist yet. */
export function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Check whether a table exists.
 *
 * Migrations that alter a table created by an earlier migration need this
 * guard: version numbers are global to the database, so an install whose
 * version slot was consumed by a different release line can reach a later
 * migration without the earlier one's table. `PRAGMA table_info` returns an
 * empty list for a missing table, so `hasColumn` cannot distinguish the two.
 */
export function hasTable(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return Boolean(row);
}
