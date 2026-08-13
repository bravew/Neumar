import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { ComposioCatalogCache } from '@/shared/connectors/providers/composio/catalog-cache';
import {
  apiKeyTail,
  MemoryComposioConfigStore,
} from '@/shared/connectors/providers/composio/config';
import { CONNECTOR_SEED_CATALOG } from '@/shared/connectors/seed';

describe('Composio config store', () => {
  it('round-trips api key and public tail', () => {
    const store = new MemoryComposioConfigStore();
    expect(store.getApiKey()).toBeNull();

    store.setApiKey('  cmp_1234567890  ');
    expect(store.getApiKey()).toBe('cmp_1234567890');
    expect(apiKeyTail(store.getApiKey())).toBe('7890');

    store.setApiKey(null);
    expect(store.getApiKey()).toBeNull();
    expect(apiKeyTail(store.getApiKey())).toBe('');
  });

  it('keeps auth configs and connected accounts scoped independently', () => {
    const store = new MemoryComposioConfigStore();
    store.setAuthConfigId('github', 'auth_github');
    store.setConnectedAccount('desktop:local', 'github', {
      id: 'ca_desktop',
      label: '@desktop',
      connectedAt: '2026-05-16T00:00:00.000Z',
    });
    store.setConnectedAccount('channel:slack:bot-a:user-1', 'github', {
      id: 'ca_slack',
      label: '@slack',
      connectedAt: '2026-05-16T00:01:00.000Z',
    });

    expect(store.getAuthConfigIds()).toEqual({ github: 'auth_github' });
    expect(store.getConnectedAccountIds()).toMatchObject({
      'desktop:local': { github: { id: 'ca_desktop' } },
      'channel:slack:bot-a:user-1': { github: { id: 'ca_slack' } },
    });

    store.removeConnectedAccount('github', 'desktop:local');
    expect(store.getConnectedAccountIds()).not.toHaveProperty('desktop:local');
    expect(store.getConnectedAccountIds()).toHaveProperty(
      'channel:slack:bot-a:user-1',
    );
  });

  it('writes and reads the catalog cache atomically', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'neuma-composio-cache-'));
    const cache = new ComposioCatalogCache(path.join(dir, 'catalog.json'));

    try {
      const written = await cache.write(CONNECTOR_SEED_CATALOG);
      const read = await cache.read();

      expect(read).toEqual(written);
      expect(read?.definitions).toHaveLength(8);
      expect(cache.isFresh(written, Date.parse(written.fetchedAt))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
