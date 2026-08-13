import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '@/shared/db';
import {
  getMarketplaceSource,
  getMarketplaceSourceByUrl,
} from '@/shared/db/marketplace-sources';
import { invalidateRegistryCache } from '@/shared/plugins/marketplace';
import {
  addMarketplaceSource,
  ensureDefaultMarketplaceSource,
  MarketplaceSourceError,
  refreshMarketplaceSource,
  removeMarketplaceSource,
  resolveCatalogEntry,
} from '@/shared/plugins/sources';

const addedSourceIds: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const id of addedSourceIds.splice(0)) {
    removeMarketplaceSource(id);
  }
  closeDatabase();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

/** Serve a JSON catalog on a random loopback port. */
async function serveCatalog(
  catalog: unknown,
): Promise<{ url: string; setCatalog: (next: unknown) => void }> {
  let current = catalog;
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(current));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const url = `http://127.0.0.1:${address.port}/marketplace.json`;
  invalidateRegistryCache(url);
  return {
    url,
    setCatalog: (next) => {
      current = next;
      invalidateRegistryCache(url);
    },
  };
}

function demoCatalog(pluginCount: number, extra?: Record<string, unknown>) {
  return {
    name: `demo-src-${Math.random().toString(36).slice(2, 8)}`,
    metadata: { version: '1.2.3' },
    ...extra,
    plugins: Array.from({ length: pluginCount }, (_, i) => ({
      name: `plugin-${i}`,
      description: 'demo plugin',
      version: '1.0.0',
      source: `./plugins/plugin-${i}`,
    })),
  };
}

describe('marketplace sources', () => {
  it('rejects private, metadata, and non-https URLs', async () => {
    const cases = [
      'https://10.0.0.8/marketplace.json',
      'https://192.168.1.4/marketplace.json',
      'https://169.254.169.254/latest/meta-data',
      'https://metadata.google.internal/marketplace.json',
      'http://example.com/marketplace.json',
      'file:///etc/passwd',
    ];
    for (const url of cases) {
      await expect(
        addMarketplaceSource({ url, trust: 'restricted' }),
      ).rejects.toThrow(MarketplaceSourceError);
    }
  });

  it('adds a source with user-assigned trust, ignoring catalog trust claims', async () => {
    // The catalog claims official trust; the stored row must keep the
    // user-assigned 'restricted'.
    const { url } = await serveCatalog(demoCatalog(3, { trust: 'official' }));
    const source = await addMarketplaceSource({ url, trust: 'restricted' });
    addedSourceIds.push(source.id);

    expect(source.trust).toBe('restricted');
    expect(source.pluginCount).toBe(3);
    expect(source.catalogVersion).toBe('1.2.3');
    expect(getMarketplaceSource(source.id)?.trust).toBe('restricted');
  });

  it('rejects adding the same URL twice', async () => {
    const { url } = await serveCatalog(demoCatalog(1));
    const source = await addMarketplaceSource({ url, trust: 'restricted' });
    addedSourceIds.push(source.id);
    await expect(
      addMarketplaceSource({ url, trust: 'official' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refresh updates plugin count and catalog version', async () => {
    const { url, setCatalog } = await serveCatalog(demoCatalog(2));
    const source = await addMarketplaceSource({ url, trust: 'official' });
    addedSourceIds.push(source.id);

    setCatalog({ ...demoCatalog(5), metadata: { version: '2.0.0' } });
    const refreshed = await refreshMarketplaceSource(source.id);
    expect(refreshed.pluginCount).toBe(5);
    expect(refreshed.catalogVersion).toBe('2.0.0');
    expect(refreshed.fetchError).toBeUndefined();
  });

  it('resolves catalog entries with provenance from the source row', async () => {
    const { url } = await serveCatalog(demoCatalog(2));
    const source = await addMarketplaceSource({ url, trust: 'official' });
    addedSourceIds.push(source.id);

    const resolved = await resolveCatalogEntry(source.id, 'plugin-1');
    expect(resolved.source.trust).toBe('official');
    expect(resolved.entry.version).toBe('1.0.0');

    await expect(resolveCatalogEntry(source.id, 'nope')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      resolveCatalogEntry('missing-source', 'plugin-1'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('seeds the default official source only when the env URL is set', () => {
    const url =
      'https://neumar.app/api/v1/marketplace/official/marketplace.json';
    const prev = process.env.NEUMA_OFFICIAL_MARKETPLACE_URL;

    delete process.env.NEUMA_OFFICIAL_MARKETPLACE_URL;
    ensureDefaultMarketplaceSource();
    expect(getMarketplaceSourceByUrl(url)).toBeNull();

    process.env.NEUMA_OFFICIAL_MARKETPLACE_URL = url;
    try {
      ensureDefaultMarketplaceSource();
      const seeded = getMarketplaceSourceByUrl(url);
      expect(seeded?.trust).toBe('official');
      addedSourceIds.push(seeded!.id);
      // Idempotent: a second call does not throw or duplicate.
      ensureDefaultMarketplaceSource();
    } finally {
      if (prev === undefined) delete process.env.NEUMA_OFFICIAL_MARKETPLACE_URL;
      else process.env.NEUMA_OFFICIAL_MARKETPLACE_URL = prev;
    }
  });

  it('removes sources', async () => {
    const { url } = await serveCatalog(demoCatalog(1));
    const source = await addMarketplaceSource({ url, trust: 'restricted' });
    expect(removeMarketplaceSource(source.id)).toBe(true);
    expect(getMarketplaceSource(source.id)).toBeNull();
    expect(removeMarketplaceSource(source.id)).toBe(false);
  });
});
