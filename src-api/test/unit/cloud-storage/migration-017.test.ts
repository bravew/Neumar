import { describe, expect, it } from 'vitest';

import { migration as migration016 } from '@/shared/db/migrations/016_cloud_storage_local';
import { migration as migration017 } from '@/shared/db/migrations/017_cloud_storage_local_cursors';
import { runMigrations } from '@/shared/db/migrations/runner';

import { createTestDb } from '../../helpers/db';

describe('migration 017 cloud storage local cursors', () => {
  it('creates local cursor state keyed by connection and root', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration016, migration017]);

      db.prepare(
        `INSERT INTO cloud_storage_connections_cache
          (id, provider, status, connected_at)
         VALUES ('conn-1', 'google_drive', 'active', '2026-05-04T00:00:00.000Z')`,
      ).run();
      db.prepare(
        `INSERT INTO cloud_storage_local_cursors
          (connection_id, root_id, last_change_id_seen, last_polled_at)
         VALUES ('conn-1', 'root-1', 'change-1', '2026-05-04T00:00:00.000Z')`,
      ).run();

      const row = db
        .prepare(
          `SELECT last_change_id_seen FROM cloud_storage_local_cursors
           WHERE connection_id = 'conn-1' AND root_id = 'root-1'`,
        )
        .get() as { last_change_id_seen: string };

      expect(row.last_change_id_seen).toBe('change-1');
    } finally {
      cleanup();
    }
  });
});
