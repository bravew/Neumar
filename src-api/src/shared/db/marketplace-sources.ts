/**
 * Marketplace source DB operations
 *
 * CRUD over the `marketplace_sources` table created by migration 045. A source
 * is a catalog URL plus a user-assigned trust level; trust claimed inside a
 * catalog document is never honored.
 */

import { getDatabase } from './index';

export type MarketplaceSourceTrust = 'official' | 'restricted';

export interface MarketplaceSourceRow {
  id: string;
  name: string;
  url: string;
  trust: MarketplaceSourceTrust;
  catalog_version: string | null;
  plugin_count: number | null;
  last_refreshed_at: string | null;
  created_at: string;
}

export interface MarketplaceSource {
  id: string;
  name: string;
  url: string;
  trust: MarketplaceSourceTrust;
  catalogVersion: string | null;
  pluginCount: number | null;
  lastRefreshedAt: string | null;
  createdAt: string;
}

function rowToSource(row: MarketplaceSourceRow): MarketplaceSource {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    trust: row.trust,
    catalogVersion: row.catalog_version,
    pluginCount: row.plugin_count,
    lastRefreshedAt: row.last_refreshed_at,
    createdAt: row.created_at,
  };
}

export function listMarketplaceSources(): MarketplaceSource[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM marketplace_sources ORDER BY created_at ASC')
    .all() as MarketplaceSourceRow[];
  return rows.map(rowToSource);
}

export function getMarketplaceSource(id: string): MarketplaceSource | null {
  const row = getDatabase()
    .prepare('SELECT * FROM marketplace_sources WHERE id = ?')
    .get(id) as MarketplaceSourceRow | undefined;
  return row ? rowToSource(row) : null;
}

export function getMarketplaceSourceByUrl(
  url: string,
): MarketplaceSource | null {
  const row = getDatabase()
    .prepare('SELECT * FROM marketplace_sources WHERE url = ?')
    .get(url) as MarketplaceSourceRow | undefined;
  return row ? rowToSource(row) : null;
}

export interface InsertMarketplaceSourceInput {
  id: string;
  name: string;
  url: string;
  trust: MarketplaceSourceTrust;
  catalogVersion?: string | null;
  pluginCount?: number | null;
  lastRefreshedAt?: string | null;
}

export function insertMarketplaceSource(
  input: InsertMarketplaceSourceInput,
): MarketplaceSource {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO marketplace_sources
       (id, name, url, trust, catalog_version, plugin_count, last_refreshed_at, created_at)
     VALUES (@id, @name, @url, @trust, @catalogVersion, @pluginCount, @lastRefreshedAt, @now)`,
  ).run({
    id: input.id,
    name: input.name,
    url: input.url,
    trust: input.trust,
    catalogVersion: input.catalogVersion ?? null,
    pluginCount: input.pluginCount ?? null,
    lastRefreshedAt: input.lastRefreshedAt ?? null,
    now: new Date().toISOString(),
  });
  const created = getMarketplaceSource(input.id);
  if (!created) throw new Error('marketplace source insert failed');
  return created;
}

export function updateMarketplaceSourceRefresh(
  id: string,
  update: { catalogVersion: string | null; pluginCount: number | null },
): MarketplaceSource | null {
  getDatabase()
    .prepare(
      `UPDATE marketplace_sources
         SET catalog_version = ?, plugin_count = ?, last_refreshed_at = ?
       WHERE id = ?`,
    )
    .run(
      update.catalogVersion,
      update.pluginCount,
      new Date().toISOString(),
      id,
    );
  return getMarketplaceSource(id);
}

export function deleteMarketplaceSource(id: string): boolean {
  return (
    getDatabase()
      .prepare('DELETE FROM marketplace_sources WHERE id = ?')
      .run(id).changes > 0
  );
}
