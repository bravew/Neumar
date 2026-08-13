import { createHash } from 'crypto';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

import { migration as migration001 } from '@/shared/db/migrations/001_init';
import { migration as migration016 } from '@/shared/db/migrations/016_cloud_storage_local';
import { migration as migration018 } from '@/shared/db/migrations/018_cloud_storage_path_mappings';
import { runMigrations } from '@/shared/db/migrations/runner';
import type {
  CloudFile,
  CloudStorageAdapter,
} from '@/shared/integrations/cloud-storage';
import { CloudStorageError } from '@/shared/integrations/cloud-storage';
import { PathMappingsStore } from '@/shared/integrations/cloud-storage/personal-media/lan-bridge';
import { LocalPersonalMediaStore } from '@/shared/integrations/cloud-storage/personal-media/local-personal-media-store';

import { createTestDb } from '../../helpers/db';
import { jsonReq } from '../../helpers/request-factory';

describe('Cloud Storage API path mappings', () => {
  it('proxies connection creation to the site API', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const postJson = vi.fn(async () => ({ item: { id: 'conn-1' } }));
    const routes = createCloudStorageRoutes({
      createClient: () => ({ postJson }) as never,
    });
    const body = {
      provider: 'openverse',
      kind: 'stock-catalog',
      credential: {
        apiKey: 'openverse-key',
      },
    };

    const res = await routes.request(jsonReq('/connections', body));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ item: { id: 'conn-1' } });
    expect(postJson).toHaveBeenCalledWith(
      '/api/cloud-storage/connections',
      body,
    );
  });

  it('tests self-hosted Immich connections from the desktop side', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const fetchFn = vi.fn(async () => {
      return new Response(JSON.stringify({ version: '1.132.0' }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const routes = createCloudStorageRoutes({
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const res = await routes.request(
      jsonReq('/connections/test', {
        provider: 'immich',
        baseUrl: 'http://192.168.1.20:2283',
        apiKey: 'immich-key',
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      provider: 'immich',
      status: 200,
      serverInfo: { version: '1.132.0', serverVersion: '1.132.0' },
      lanReachable: true,
    });
    const [url, init] = fetchFn.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('http://192.168.1.20:2283/api/server/ping');
    expect(init.headers).toEqual({ 'x-api-key': 'immich-key' });
    expect(init.redirect).toBe('manual');
  });

  it('creates and lists self-hosted Immich connections locally', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration016]);
      const postJson = vi.fn();
      const getJson = vi.fn(async () => {
        throw new CloudStorageError('not_found', 'Site route missing');
      });
      const routes = createCloudStorageRoutes({
        createClient: () => ({ getJson, postJson }) as never,
        createLocalPersonalMediaStore: () => new LocalPersonalMediaStore(db),
      });

      const createRes = await routes.request(
        jsonReq('/connections', {
          provider: 'immich',
          kind: 'personal-media',
          displayName: 'Home Immich',
          credential: {
            baseUrl: 'https://album.rietech.ca',
            apiKey: 'immich-key',
            serverVersion: '2.7.5',
          },
        }),
      );

      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as {
        item: { id: string; provider: string; displayName: string };
      };
      expect(created.item).toMatchObject({
        provider: 'immich',
        displayName: 'Home Immich',
      });
      expect(created.item.id).toMatch(/^local_immich_/);
      expect(postJson).not.toHaveBeenCalled();

      const detailRes = await routes.request(`/connections/${created.item.id}`);
      expect(detailRes.status).toBe(200);
      const details = await detailRes.json();
      expect(details).toMatchObject({
        item: {
          id: created.item.id,
          credential: {
            baseUrl: 'https://album.rietech.ca',
            serverVersion: '2.7.5',
          },
        },
      });
      expect(JSON.stringify(details)).not.toContain('immich-key');

      const updateRes = await routes.request(
        jsonReq(
          `/connections/${created.item.id}`,
          {
            displayName: 'Updated Immich',
            credential: {
              apiKey: 'new-immich-key',
              serverVersion: '2.8.0',
            },
          },
          'PATCH',
        ),
      );
      expect(updateRes.status).toBe(200);
      expect(await updateRes.json()).toMatchObject({
        item: {
          id: created.item.id,
          provider: 'immich',
          displayName: 'Updated Immich',
        },
      });
      const updatedCredential = new LocalPersonalMediaStore(db).getCredential(
        created.item.id,
      );
      expect(updatedCredential).toMatchObject({
        baseUrl: 'https://album.rietech.ca',
        apiKey: 'new-immich-key',
        serverVersion: '2.8.0',
        displayName: 'Updated Immich',
      });

      const listRes = await routes.request('/connections');
      expect(listRes.status).toBe(200);
      expect(await listRes.json()).toMatchObject({
        featureEnabled: true,
        wakeupMode: 'longpoll',
        items: [
          expect.objectContaining({
            id: created.item.id,
            displayName: 'Updated Immich',
          }),
        ],
      });

      const deleteRes = await routes.request(
        `/connections/${created.item.id}`,
        {
          method: 'DELETE',
        },
      );
      expect(deleteRes.status).toBe(200);
      expect(await deleteRes.json()).toEqual({ ok: true });
      expect(
        (
          (await (await routes.request('/connections')).json()) as {
            items: unknown[];
          }
        ).items,
      ).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it('returns a 400 for malformed local connection update JSON', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const patchJson = vi.fn();
    const routes = createCloudStorageRoutes({
      createClient: () => ({ patchJson }) as never,
    });

    const res = await routes.request('/connections/local_immich_1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{"displayName":',
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
    expect(patchJson).not.toHaveBeenCalled();
  });

  it('toggles and syncs Immich asset indexing from connector settings', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration016]);
      const store = new LocalPersonalMediaStore(db);
      const connection = store.create({
        provider: 'immich',
        kind: 'personal-media',
        displayName: 'home album',
        credential: {
          baseUrl: 'https://album.rietech.ca',
          apiKey: 'immich-key',
        },
      });
      let enabled = false;
      const setAssetCatalogIndexing = vi.fn(
        (_source: 'immich', _connectionId: string, nextEnabled: boolean) => {
          enabled = nextEnabled;
        },
      );
      const syncAssetCatalogConnection = vi.fn(async () => ({
        source: 'immich' as const,
        connectionId: connection.id,
        mode: 'full' as const,
        scanned: 2,
        created: 2,
        updated: 0,
        deleted: 0,
        state: {
          source: 'immich' as const,
          connectionId: connection.id,
          cursor: '2026-06-01T00:00:00.000Z',
          fullSyncAt: 1780272000000,
          lastSyncedAt: 1780272000000,
          lastError: null,
        },
      }));
      const routes = createCloudStorageRoutes({
        createLocalPersonalMediaStore: () => store,
        getAssetCatalogStatus: () => ({
          enabled,
          fullSyncAt: enabled ? 1780272000000 : null,
          lastSyncedAt: enabled ? 1780272000000 : null,
          lastError: null,
        }),
        setAssetCatalogIndexing,
        syncAssetCatalogConnection,
      });

      const toggleRes = await routes.request(
        jsonReq(
          `/connections/${connection.id}/assets-index`,
          { enabled: true },
          'PATCH',
        ),
      );

      expect(toggleRes.status).toBe(200);
      expect(await toggleRes.json()).toMatchObject({
        item: {
          id: connection.id,
          assetsCatalog: {
            enabled: true,
          },
        },
      });
      expect(setAssetCatalogIndexing).toHaveBeenCalledWith(
        'immich',
        connection.id,
        true,
      );

      const syncRes = await routes.request(
        jsonReq(
          `/connections/${connection.id}/assets-sync`,
          { mode: 'full' },
          'POST',
        ),
      );

      expect(syncRes.status).toBe(200);
      expect(await syncRes.json()).toMatchObject({
        result: {
          source: 'immich',
          connectionId: connection.id,
          scanned: 2,
          created: 2,
        },
        item: {
          assetsCatalog: {
            enabled: true,
            lastSyncedAt: 1780272000000,
          },
        },
      });
      expect(syncAssetCatalogConnection).toHaveBeenCalledWith({
        source: 'immich',
        connectionId: connection.id,
        mode: 'full',
        limit: undefined,
      });
    } finally {
      cleanup();
    }
  });

  it('blocks metadata hosts when testing self-hosted media connections', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const fetchFn = vi.fn();
    const routes = createCloudStorageRoutes({
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const res = await routes.request(
      jsonReq('/connections/test', {
        provider: 'immich',
        baseUrl: 'http://169.254.169.254/latest',
        apiKey: 'immich-key',
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      provider: 'immich',
      errorCode: 'metadata_host_blocked',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('proxies multipart uploads to the site connection route', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const putForm = vi.fn(async () => ({ id: 'asset-1' }));
    const routes = createCloudStorageRoutes({
      createClient: () => ({ putForm }) as never,
    });
    const form = new FormData();
    form.set('name', 'image.jpg');
    form.set('file', new Blob(['hello'], { type: 'image/jpeg' }));

    const res = await routes.request('/connections/conn-1/items', {
      method: 'PUT',
      body: form,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'asset-1' });
    expect(putForm).toHaveBeenCalledWith(
      '/api/cloud-storage/connections/conn-1/items',
      expect.any(FormData),
    );
  });

  it('serves personal media item operations through a local adapter', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const file = cloudFile({ id: 'asset-1', name: 'clip.mp4' });
    const adapter = createLocalAdapter({
      listChildren: vi.fn(async (input) => {
        expect(input).toMatchObject({
          parentId: 'album:trip',
          limit: 20,
        });
        return { items: [file], hasMore: false };
      }),
      search: vi.fn(async (input) => {
        expect(input).toMatchObject({
          query: 'sunset',
          mediaKind: 'video',
          licenseFilter: ['cc0', 'cc-by'],
        });
        return { items: [file], hasMore: false };
      }),
      download: vi.fn(async (providerItemId) => {
        expect(providerItemId).toBe('asset-1');
        return new Response('local-bytes', {
          headers: { 'content-type': 'image/jpeg' },
        });
      }),
      getThumbnail: vi.fn(async (providerItemId) => {
        expect(providerItemId).toBe('asset-1');
        return new Response('thumb', {
          headers: { 'content-type': 'image/webp' },
        });
      }),
      upload: vi.fn(async (input) => {
        expect(input.name).toBe('new.jpg');
        expect(input.parentId).toBe('album:trip');
        expect(input.mimeType).toBe('image/jpeg');
        expect(input.metadata).toEqual({ source: 'test' });
        await expect(new Response(input.content).text()).resolves.toBe('new');
        return cloudFile({ id: 'asset-2', name: input.name });
      }),
    });
    const routes = createCloudStorageRoutes({
      resolveLocalAdapter: () => adapter,
    });

    const listRes = await routes.request(
      '/connections/conn-1/items?parentId=album%3Atrip&limit=20',
    );
    expect(await listRes.json()).toMatchObject({
      items: [expect.objectContaining({ id: 'asset-1' })],
    });

    const searchRes = await routes.request(
      '/connections/conn-1/search?q=sunset&media_kind=video&license_filter=cc0&license_filter=cc-by',
    );
    expect(await searchRes.json()).toMatchObject({
      items: [expect.objectContaining({ id: 'asset-1' })],
    });

    const contentRes = await routes.request(
      '/connections/conn-1/items/asset-1/content',
    );
    expect(await contentRes.text()).toBe('local-bytes');

    const thumbnailRes = await routes.request(
      '/connections/conn-1/items/asset-1/thumbnail',
    );
    expect(thumbnailRes.headers.get('content-type')).toBe('image/webp');
    expect(await thumbnailRes.text()).toBe('thumb');

    const form = new FormData();
    form.set('name', 'new.jpg');
    form.set('parentId', 'album:trip');
    form.set('mimeType', 'image/jpeg');
    form.set('metadata', JSON.stringify({ source: 'test' }));
    form.set('file', new Blob(['new'], { type: 'image/jpeg' }));
    const uploadRes = await routes.request('/connections/conn-1/items', {
      method: 'PUT',
      body: form,
    });
    expect(await uploadRes.json()).toMatchObject({
      id: 'asset-2',
      name: 'new.jpg',
    });
  });

  it('resolves Immich publish URLs to proxied media endpoints', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const { db, cleanup } = createTestDb();
    const assetId = 'd0f0b5bf-8eed-4999-945c-81c1e85dd640';
    try {
      runMigrations(db, [migration001, migration016]);
      const store = new LocalPersonalMediaStore(db);
      const connection = store.create({
        provider: 'immich',
        kind: 'personal-media',
        displayName: 'home album',
        credential: {
          baseUrl: 'https://album.rietech.ca',
          apiKey: 'immich-key',
        },
      });
      const adapter = createLocalAdapter({
        getMetadata: vi.fn(async (providerItemId) =>
          cloudFile({
            id: providerItemId,
            name: 'clip.mp4',
            mimeType: 'video/mp4',
            webUrl: `https://album.rietech.ca/photos/${assetId}`,
          }),
        ),
      });
      const routes = createCloudStorageRoutes({
        createLocalPersonalMediaStore: () => store,
        resolveLocalAdapter: (connectionId) =>
          connectionId === connection.id ? adapter : null,
      });

      const res = await routes.request(
        `/immich/published-preview?url=${encodeURIComponent(
          `https://album.rietech.ca/photos/${assetId}`,
        )}`,
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        item: {
          connectionId: connection.id,
          assetId,
          name: 'clip.mp4',
          mimeType: 'video/mp4',
          mediaType: 'video',
          webUrl: `https://album.rietech.ca/photos/${assetId}`,
          thumbnailUrl: `/cloud-storage/connections/${connection.id}/items/${assetId}/thumbnail`,
          contentUrl: `/cloud-storage/connections/${connection.id}/items/${assetId}/content`,
        },
      });
      expect(adapter.getMetadata).toHaveBeenCalledWith(assetId);
    } finally {
      cleanup();
    }
  });

  it('returns timeline buckets when adapter supports them', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const adapter = createLocalAdapter({
      getTimelineBuckets: vi.fn(async (input) => {
        expect(input).toEqual({ size: 'month' });
        return {
          size: 'month',
          buckets: [
            { bucket: '2025-04', count: 12 },
            { bucket: '2024-11', count: 5 },
          ],
        };
      }),
    });
    const routes = createCloudStorageRoutes({
      resolveLocalAdapter: () => adapter,
    });

    const res = await routes.request(
      '/connections/conn-1/timeline/buckets?size=month',
    );
    expect(await res.json()).toEqual({
      size: 'month',
      supported: true,
      buckets: [
        { bucket: '2025-04', count: 12 },
        { bucket: '2024-11', count: 5 },
      ],
    });
  });

  it('reports unsupported when adapter has no getTimelineBuckets', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const adapter = createLocalAdapter({});
    const routes = createCloudStorageRoutes({
      resolveLocalAdapter: () => adapter,
    });

    const res = await routes.request('/connections/conn-1/timeline/buckets');
    expect(await res.json()).toEqual({
      size: 'month',
      buckets: [],
      supported: false,
    });
  });

  it('creates, lists, resolves, and deletes LAN bridge path mappings', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const { db, cleanup } = createTestDb();
    const mountPath = await makeTempMount();
    await writeFile(path.join(mountPath, 'image.jpg'), 'hello');

    try {
      runMigrations(db, [migration016, migration018]);
      db.prepare(
        `INSERT INTO cloud_storage_connections_cache
          (id, provider, status, connected_at)
         VALUES ('conn-1', 'google_drive', 'active', '2026-05-04T00:00:00.000Z')`,
      ).run();

      const routes = createCloudStorageRoutes({
        createPathMappingsStore: () => new PathMappingsStore(db),
      });
      const verifyCandidateRes = await routes.request(
        jsonReq('/connections/conn-1/path-mappings/resolve-test', {
          id: 'asset-1',
          originalPath: '/usr/src/app/external/photos/image.jpg',
          fileSizeBytes: 5,
          checksum: sha1('hello'),
          immichPathPrefix: '/usr/src/app/external/photos/',
          localMountPath: mountPath,
        }),
      );
      expect(await verifyCandidateRes.json()).toMatchObject({
        verified: true,
        verificationHash: sha1('hello'),
        resolution: { kind: 'local', sizeBytes: 5 },
      });

      const createRes = await routes.request(
        jsonReq('/connections/conn-1/path-mappings', {
          id: 'mapping-1',
          immichPathPrefix: '/usr/src/app/external/photos/',
          localMountPath: mountPath,
          verified: true,
        }),
      );
      expect(createRes.status).toBe(201);

      const listRes = await routes.request('/connections/conn-1/path-mappings');
      const listBody = (await listRes.json()) as {
        items: Array<{ id: string; verified: boolean }>;
      };
      expect(listBody.items).toEqual([
        expect.objectContaining({ id: 'mapping-1', verified: true }),
      ]);

      const resolveRes = await routes.request(
        jsonReq('/connections/conn-1/path-mappings/resolve-test', {
          id: 'asset-1',
          originalPath: '/usr/src/app/external/photos/image.jpg',
          fileSizeBytes: 5,
        }),
      );
      expect(await resolveRes.json()).toMatchObject({
        kind: 'local',
        mappingId: 'mapping-1',
        sizeBytes: 5,
      });

      const deleteRes = await routes.request(
        '/connections/conn-1/path-mappings/mapping-1',
        { method: 'DELETE' },
      );
      expect(deleteRes.status).toBe(200);
      expect(
        (
          (await (
            await routes.request('/connections/conn-1/path-mappings')
          ).json()) as { items: unknown[] }
        ).items,
      ).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it('discovers local network mounts and Tailscale status for LAN bridge setup', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const routes = createCloudStorageRoutes({
      detectTailscale: async () => ({
        available: true,
        selfDnsName: 'desktop.tailnet.ts.net',
      }),
      discoverNetworkMounts: async () => [
        {
          path: '/Volumes/photos',
          label: 'photos',
          fsType: 'smbfs',
          source: '//nas/photos',
        },
      ],
    });

    const res = await routes.request(
      '/connections/conn-1/path-mappings/discovery',
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mounts: [
        {
          path: '/Volumes/photos',
          label: 'photos',
          fsType: 'smbfs',
          source: '//nas/photos',
        },
      ],
      tailscale: {
        available: true,
        selfDnsName: 'desktop.tailnet.ts.net',
      },
    });
  });

  it('rejects invalid mapping bodies', async () => {
    const { createCloudStorageRoutes } =
      await import('@/app/api/cloud-storage');
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration016, migration018]);
      const routes = createCloudStorageRoutes({
        createPathMappingsStore: () => new PathMappingsStore(db),
      });

      const res = await routes.request(
        jsonReq('/connections/conn-1/path-mappings', {
          immichPathPrefix: '',
          localMountPath: '/Volumes/photos',
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_path_mapping' });
    } finally {
      cleanup();
    }
  });
});

async function makeTempMount(): Promise<string> {
  const { mkdtemp } = await import('fs/promises');
  return mkdtemp(path.join(tmpdir(), 'cloud-storage-route-'));
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function cloudFile(overrides: Partial<CloudFile> = {}): CloudFile {
  return {
    id: 'asset-1',
    name: 'image.jpg',
    mimeType: 'image/jpeg',
    size: 5,
    createdAt: '2026-05-04T00:00:00.000Z',
    modifiedAt: '2026-05-04T00:00:00.000Z',
    parentId: null,
    isFolder: false,
    provider: 'immich',
    ...overrides,
  };
}

function createLocalAdapter(
  overrides: Partial<CloudStorageAdapter>,
): CloudStorageAdapter {
  return {
    provider: 'immich',
    getCapabilities: vi.fn(),
    listChildren: vi.fn(),
    search: vi.fn(),
    getMetadata: vi.fn(),
    download: vi.fn(),
    exportContent: vi.fn(),
    createFolder: vi.fn(),
    upload: vi.fn(),
    updateMetadata: vi.fn(),
    move: vi.fn(),
    copy: vi.fn(),
    delete: vi.fn(),
    getChanges: vi.fn(),
    ...overrides,
  } as CloudStorageAdapter;
}
