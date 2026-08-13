import { describe, expect, it } from 'vitest';

import { migration as migration016 } from '@/shared/db/migrations/016_cloud_storage_local';
import { runMigrations } from '@/shared/db/migrations/runner';
import type { CloudStorageAdapter } from '@/shared/integrations/cloud-storage';
import {
  CloudStorageRegistry,
  NoopProxyAdapter,
} from '@/shared/integrations/cloud-storage';

import { createTestDb } from '../../helpers/db';

describe('cloud storage registry', () => {
  it('resolves a registered adapter from the local connection cache', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration016]);
      db.prepare(
        `INSERT INTO cloud_storage_connections_cache
          (id, provider, status, connected_at)
         VALUES ('conn-1', 'google_drive', 'active', '2026-05-04T00:00:00.000Z')`,
      ).run();

      const registry = new CloudStorageRegistry({
        getDb: () => db,
        createClient: () => ({}) as never,
      });
      registry.register(
        'google_drive',
        ({ connectionId }) =>
          new NoopProxyAdapter(
            connectionId === 'conn-1' ? 'google_drive' : 'dropbox',
          ) as CloudStorageAdapter,
      );

      const adapter = registry.resolve('conn-1');
      expect(adapter.provider).toBe('google_drive');
    } finally {
      cleanup();
    }
  });

  it('fails closed for uncached connections', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration016]);
      const registry = new CloudStorageRegistry({ getDb: () => db });

      expect(() => registry.resolve('missing')).toThrow(/not cached/);
    } finally {
      cleanup();
    }
  });
});
