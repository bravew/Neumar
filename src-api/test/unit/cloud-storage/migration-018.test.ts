import { describe, expect, it } from 'vitest';

import { migration as migration016 } from '@/shared/db/migrations/016_cloud_storage_local';
import { migration as migration018 } from '@/shared/db/migrations/018_cloud_storage_path_mappings';
import { runMigrations } from '@/shared/db/migrations/runner';
import { PathMappingsStore } from '@/shared/integrations/cloud-storage/personal-media/lan-bridge';

import { createTestDb } from '../../helpers/db';

describe('migration 018 cloud storage path mappings', () => {
  it('creates local path mappings keyed by connection and immich prefix', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration016, migration018]);

      db.prepare(
        `INSERT INTO cloud_storage_connections_cache
          (id, provider, status, connected_at)
         VALUES ('conn-1', 'google_drive', 'active', '2026-05-04T00:00:00.000Z')`,
      ).run();

      const store = new PathMappingsStore(db);
      const mapping = store.upsert({
        id: 'mapping-1',
        connectionId: 'conn-1',
        immichPathPrefix: '/usr/src/app/external/photos/',
        localMountPath: '/Volumes/photos',
        verified: true,
        verificationHash: 'sha1:abc',
      });

      expect(mapping.verified).toBe(true);
      expect(store.list('conn-1')).toHaveLength(1);

      expect(() =>
        store.upsert({
          id: 'mapping-2',
          connectionId: 'conn-1',
          immichPathPrefix: '/usr/src/app/external/photos/',
          localMountPath: '/Volumes/photos-v2',
        }),
      ).not.toThrow();
      expect(store.list('conn-1')[0]?.localMountPath).toBe(
        '/Volumes/photos-v2',
      );

      store.markVerification('mapping-1', true, {
        verificationHash: 'sha1:def',
        now: new Date('2026-05-04T00:00:00.000Z'),
      });
      const due = store.listDueForReverification({
        maxAgeMs: 24 * 60 * 60 * 1000,
        limit: 10,
        now: new Date('2026-05-06T00:00:00.000Z'),
      });
      expect(due.map((item) => item.id)).toEqual(['mapping-1']);
    } finally {
      cleanup();
    }
  });
});
