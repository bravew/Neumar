import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { hasColumn } from './utils';

/**
 * Marketplace sources + install provenance
 * (dev-doc/plan/07-04-plugin-system checkpoint 4).
 *
 * A marketplace source is a catalog URL plus a USER-ASSIGNED trust level —
 * trust claimed inside a catalog document is never honored. Installed plugins
 * record which source/entry they came from so updates and audits are possible.
 *
 * Seeds one row per URL previously configured through the
 * `pluginMarketplaceUrls` setting (migrate-then-delete: the setting is removed
 * afterwards), plus the Anthropic official registry that was the hardcoded
 * default.
 */
export const migration: Migration = {
  version: 45,
  description: 'Marketplace sources and plugin install provenance',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_sources (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        url              TEXT NOT NULL UNIQUE,
        trust            TEXT NOT NULL CHECK (trust IN ('official', 'restricted')),
        catalog_version  TEXT,
        plugin_count     INTEGER,
        last_refreshed_at TEXT,
        created_at       TEXT NOT NULL
      );
    `);

    for (const column of [
      'source_marketplace_id',
      'source_entry_name',
      'source_entry_version',
      'marketplace_trust',
    ]) {
      if (!hasColumn(db, 'installed_plugins', column)) {
        db.exec(`ALTER TABLE installed_plugins ADD COLUMN ${column} TEXT`);
      }
    }

    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO marketplace_sources (id, name, url, trust, created_at)
       VALUES (@id, @name, @url, 'restricted', @now)`,
    );

    const seeds = new Map<string, string>([
      [
        'claude-official',
        'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json',
      ],
    ]);

    try {
      const row = db
        .prepare(`SELECT value FROM settings WHERE key = ?`)
        .get('pluginMarketplaceUrls') as { value: string } | undefined;
      if (row?.value) {
        const parsed = JSON.parse(row.value) as unknown;
        if (Array.isArray(parsed)) {
          let n = 0;
          for (const url of parsed) {
            if (typeof url !== 'string' || [...seeds.values()].includes(url)) {
              continue;
            }
            n += 1;
            seeds.set(`custom-source-${n}`, url);
          }
        }
      }
      db.prepare(`DELETE FROM settings WHERE key = ?`).run(
        'pluginMarketplaceUrls',
      );
    } catch {
      // settings table absent in some fixture databases — seed defaults only.
    }

    for (const [id, url] of seeds) {
      insert.run({ id, name: id, url, now });
    }
  },
};
