import Database from 'better-sqlite3';

/**
 * Create an in-memory SQLite database for testing.
 * Returns the database instance and a cleanup function.
 */
export function createTestDb(): {
  db: Database.Database;
  cleanup: () => void;
} {
  const db = new Database(':memory:');

  const cleanup = () => {
    db.close();
  };

  return { db, cleanup };
}
