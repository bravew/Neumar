import { describe, expect, it } from 'vitest';

import { migration as migration001 } from '@/shared/db/migrations/001_init';
import { migration as migration005 } from '@/shared/db/migrations/005_plugins';
import { migration as migration045 } from '@/shared/db/migrations/045_marketplace_sources';
import { runMigrations } from '@/shared/db/migrations/runner';

import { createTestDb } from '../../helpers/db';

describe('migration 101 marketplace sources', () => {
  it('creates the sources table, provenance columns, and default seed', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration005, migration045]);

      const columns = db
        .prepare('PRAGMA table_info(installed_plugins)')
        .all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          'source_marketplace_id',
          'source_entry_name',
          'source_entry_version',
          'marketplace_trust',
        ]),
      );

      const sources = db
        .prepare('SELECT id, trust FROM marketplace_sources')
        .all() as Array<{ id: string; trust: string }>;
      expect(sources).toEqual([{ id: 'claude-official', trust: 'restricted' }]);
    } finally {
      cleanup();
    }
  });

  it('migrates pluginMarketplaceUrls setting values and deletes the setting', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration005]);
      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
      ).run(
        'pluginMarketplaceUrls',
        JSON.stringify(['https://example.com/custom-marketplace.json']),
        new Date().toISOString(),
      );

      runMigrations(db, [migration045]);

      const urls = db
        .prepare('SELECT url, trust FROM marketplace_sources ORDER BY id')
        .all() as Array<{ url: string; trust: string }>;
      expect(urls).toEqual(
        expect.arrayContaining([
          {
            url: 'https://example.com/custom-marketplace.json',
            trust: 'restricted',
          },
        ]),
      );
      expect(urls).toHaveLength(2);

      const setting = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('pluginMarketplaceUrls');
      expect(setting).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});
