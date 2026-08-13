import { describe, expect, it } from 'vitest';

import { migration as migration016 } from '@/shared/db/migrations/016_cloud_storage_local';
import { runMigrations } from '@/shared/db/migrations/runner';

import { createTestDb } from '../../helpers/db';

describe('cloud storage local migration', () => {
  it('creates local mirror tables and indexes', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration016]);

      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
        )
        .all() as { name: string }[];
      expect(tables.map((t) => t.name)).toContain(
        'cloud_storage_connections_cache',
      );
      expect(tables.map((t) => t.name)).toContain('cloud_storage_items_cache');
      expect(tables.map((t) => t.name)).toContain('cloud_storage_content_jobs');

      const indexes = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`,
        )
        .all() as { name: string }[];
      expect(indexes.map((i) => i.name)).toContain(
        'idx_cloud_storage_items_cache_connection_provider_item',
      );
      expect(indexes.map((i) => i.name)).toContain(
        'idx_cloud_storage_content_jobs_connection_item_fingerprint',
      );
    } finally {
      cleanup();
    }
  });
});
