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
