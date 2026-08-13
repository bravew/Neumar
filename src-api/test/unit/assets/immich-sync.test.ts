import type Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import {
  AssetCatalogSyncScheduler,
  AssetSearchService,
  createAssetRegistry,
  setAssetConnectionIndexingEnabled,
} from '@/shared/assets';
import { searchImmichSourceScoped } from '@/shared/assets/connectors/remote-search';
import { migration as migration001 } from '@/shared/db/migrations/001_init';
import { migration as migration016 } from '@/shared/db/migrations/016_cloud_storage_local';
import { migration as migration034 } from '@/shared/db/migrations/034_assets_catalog';
import { runMigrations } from '@/shared/db/migrations/runner';
import {
  CloudStorageError,
  upsertCachedConnections,
  type CloudFile,
  type CloudStorageAdapter,
} from '@/shared/integrations/cloud-storage';

import { createTestDb } from '../../helpers/db';

describe('Immich asset catalog sync', () => {
  it('full-syncs Immich files into the local asset catalog', async () => {
    const { db, cleanup } = createTestDb();
    try {
      migrate(db);
      cacheImmichConnection(db);
      const files = [
        cloudFile({
          id: 'asset-1',
          name: 'Sunset deck.jpg',
          mediaMetadata: {
            takenAt: '2026-05-01T10:00:00.000Z',
            tags: [{ id: 'tag-1', value: 'sunset' }],
            description: 'Golden sunset over the deck',
            fileInfo: {
              checksum: 'sha1-a',
              width: 1600,
              height: 900,
            },
          },
        }),
        cloudFile({
          id: 'asset-2',
          name: 'Kitchen clip.mp4',
          mimeType: 'video/mp4',
          mediaMetadata: {
            tags: [{ id: 'tag-2', value: 'family' }],
            fileInfo: {
              checksum: 'sha1-b',
              durationSeconds: 12,
              width: 1920,
              height: 1080,
            },
          },
        }),
      ];
      const adapter = createAdapter({
        search: vi.fn(async (input) => {
          if (input.cursor === '2') {
            return { items: [files[1]!], hasMore: false };
          }
          return {
            items: [files[0]!],
            nextCursor: '2',
            hasMore: true,
          };
        }),
      });
      const registry = createAssetRegistry({ db });
      const scheduler = new AssetCatalogSyncScheduler({
        db,
        registry,
        now: () => Date.parse('2026-06-01T00:00:00.000Z'),
        resolveAdapter: () => adapter,
      });

      const result = await scheduler.syncConnection({
        source: 'immich',
        connectionId: 'immich-1',
        mode: 'full',
        limit: 1,
      });

      expect(result).toMatchObject({
        mode: 'full',
        scanned: 2,
        created: 2,
        updated: 0,
        deleted: 0,
      });
      expect(result.state.cursor).toBe('2026-06-01T00:00:00.000Z');

      const search = new AssetSearchService({
        db,
        registry,
        remoteSearch: async () => null,
      });
      const hits = await search.search({
        text: 'sunset',
        sources: ['immich'],
        semantic: false,
      });
      expect(hits.items[0]?.asset).toMatchObject({
        source: 'immich',
        connectionId: 'immich-1',
        sourceId: 'asset-1',
        kind: 'image',
        title: 'Sunset deck.jpg',
        tags: ['sunset'],
        width: 1600,
        height: 900,
      });
    } finally {
      cleanup();
    }
  });

  it('applies delta updates and deletes from Immich changes', async () => {
    const { db, cleanup } = createTestDb();
    try {
      migrate(db);
      cacheImmichConnection(db);
      const registry = createAssetRegistry({ db });
      const initialFiles = [
        cloudFile({ id: 'asset-1', name: 'Old title.jpg' }),
        cloudFile({ id: 'asset-2', name: 'Deleted photo.jpg' }),
      ];
      const updated = cloudFile({
        id: 'asset-1',
        name: 'Updated title.jpg',
        modifiedAt: '2026-05-02T00:00:00.000Z',
      });
      const adapter = createAdapter({
        search: vi.fn(async () => ({
          items: initialFiles,
          hasMore: false,
        })),
        getChanges: vi.fn(async () => ({
          changes: [
            {
              id: 'change-1',
              type: 'updated',
              itemId: 'asset-1',
              item: updated,
            },
            {
              id: 'change-2',
              type: 'deleted',
              itemId: 'asset-2',
            },
          ],
          nextCursor: 'cursor-2',
          hasMore: false,
        })),
      });
      const scheduler = new AssetCatalogSyncScheduler({
        db,
        registry,
        now: () => Date.parse('2026-06-01T00:00:00.000Z'),
        resolveAdapter: () => adapter,
      });

      await scheduler.syncConnection({
        source: 'immich',
        connectionId: 'immich-1',
        mode: 'full',
      });
      const delta = await scheduler.syncConnection({
        source: 'immich',
        connectionId: 'immich-1',
        mode: 'delta',
      });

      expect(delta).toMatchObject({
        mode: 'delta',
        scanned: 1,
        created: 0,
        updated: 1,
        deleted: 1,
      });
      expect(delta.state.cursor).toBe('cursor-2');
      const items = registry.list({ sources: ['immich'], limit: 10 }).items;
      expect(items.map((asset) => asset.sourceId)).toEqual(['asset-1']);
      expect(items[0]?.title).toBe('Updated title.jpg');
    } finally {
      cleanup();
    }
  });

  it('prunes remote assets missing from a completed Immich full sync', async () => {
    const { db, cleanup } = createTestDb();
    try {
      migrate(db);
      cacheImmichConnection(db);
      const registry = createAssetRegistry({ db });
      const assetOne = cloudFile({ id: 'asset-1', name: 'Kept photo.jpg' });
      const assetTwo = cloudFile({ id: 'asset-2', name: 'Removed photo.jpg' });
      const adapter = createAdapter({
        search: vi
          .fn()
          .mockResolvedValueOnce({
            items: [assetOne, assetTwo],
            hasMore: false,
          })
          .mockResolvedValueOnce({
            items: [assetOne],
            hasMore: false,
          }),
      });
      const scheduler = new AssetCatalogSyncScheduler({
        db,
        registry,
        now: () => Date.parse('2026-06-01T00:00:00.000Z'),
        resolveAdapter: () => adapter,
      });

      await scheduler.syncConnection({
        source: 'immich',
        connectionId: 'immich-1',
        mode: 'full',
      });
      const secondFullSync = await scheduler.syncConnection({
        source: 'immich',
        connectionId: 'immich-1',
        mode: 'full',
      });

      expect(secondFullSync).toMatchObject({
        mode: 'full',
        scanned: 1,
        created: 0,
        updated: 1,
        deleted: 1,
      });
      expect(
        registry
          .list({ sources: ['immich'], limit: 10 })
          .items.map((asset) => asset.sourceId),
      ).toEqual(['asset-1']);
    } finally {
      cleanup();
    }
  });

  it('removes unreadable Immich rows from blank local search results', async () => {
    const { db, cleanup } = createTestDb();
    try {
      migrate(db);
      cacheImmichConnection(db);
      const registry = createAssetRegistry({ db });
      const stale = registry.upsertRemote({
        source: 'immich',
        connectionId: 'immich-1',
        sourceId: 'stale-asset',
        kind: 'image',
        mime: 'image/jpeg',
        bytes: 1024,
        title: 'Stale photo.jpg',
        capturedAt: Date.parse('2026-06-02T00:00:00.000Z'),
      });
      registry.upsertRemote({
        source: 'immich',
        connectionId: 'immich-1',
        sourceId: 'fresh-asset',
        kind: 'image',
        mime: 'image/jpeg',
        bytes: 1024,
        title: 'Fresh photo.jpg',
        capturedAt: Date.parse('2026-06-01T00:00:00.000Z'),
      });
      const getMetadata = vi.fn(async (sourceId: string) => {
        if (sourceId === 'stale-asset') {
          throw new CloudStorageError('transient_upstream', 'Immich 400', {
            status: 400,
          });
        }
        return cloudFile({ id: sourceId, name: 'Fresh photo.jpg' });
      });
      const adapter = createAdapter({ getMetadata });
      const search = new AssetSearchService({
        db,
        registry,
        remoteSearch: async () => null,
        resolveAdapter: () => adapter,
      });

      // First paint returns the indexed page without waiting on the provider.
      const page = await search.search({ limit: 2 });
      expect(page.items.map((item) => item.asset.sourceId)).toEqual([
        'stale-asset',
        'fresh-asset',
      ]);

      // Background validation soft-deletes the unreadable row for next load.
      await search.whenRemoteValidationSettled();
      expect(registry.get(stale.asset.id)).toBeNull();
      expect(getMetadata).toHaveBeenCalledWith('stale-asset');
      expect(getMetadata).toHaveBeenCalledWith('fresh-asset');
      const reloaded = await search.search({ limit: 2 });
      expect(reloaded.items.map((item) => item.asset.sourceId)).toEqual([
        'fresh-asset',
      ]);
    } finally {
      cleanup();
    }
  });

  it('does not wait for live Immich listing when browsing the source catalog', async () => {
    const { db, cleanup } = createTestDb();
    try {
      migrate(db);
      cacheImmichConnection(db);
      setAssetConnectionIndexingEnabled('immich-1', true, { db });
      const registry = createAssetRegistry({ db });
      registry.upsertRemote({
        source: 'immich',
        connectionId: 'immich-1',
        sourceId: 'catalog-asset',
        kind: 'image',
        mime: 'image/jpeg',
        bytes: 1024,
        title: 'Catalog photo.jpg',
        capturedAt: Date.parse('2026-06-01T00:00:00.000Z'),
      });
      const remoteSearch = vi.fn(() => new Promise<never>(() => undefined));
      const search = new AssetSearchService({
        db,
        registry,
        remoteSearch,
        resolveAdapter: () => null,
      });

      const page = await withSearchTimeout(
        search.search({ sources: ['immich'], limit: 5 }),
      );

      expect(remoteSearch).not.toHaveBeenCalled();
      expect(page.items.map((item) => item.asset.sourceId)).toEqual([
        'catalog-asset',
      ]);
    } finally {
      cleanup();
    }
  });

  it('keeps Immich catalog rows when metadata validation stalls', async () => {
    const { db, cleanup } = createTestDb();
    try {
      migrate(db);
      cacheImmichConnection(db);
      const registry = createAssetRegistry({ db });
      registry.upsertRemote({
        source: 'immich',
        connectionId: 'immich-1',
        sourceId: 'slow-asset',
        kind: 'image',
        mime: 'image/jpeg',
        bytes: 1024,
        title: 'Slow metadata photo.jpg',
        capturedAt: Date.parse('2026-06-01T00:00:00.000Z'),
      });
      const getMetadata = vi.fn(() => new Promise<never>(() => undefined));
      const adapter = createAdapter({ getMetadata });
      const search = new AssetSearchService({
        db,
        registry,
        remoteSearch: async () => null,
        resolveAdapter: () => adapter,
        remoteValidationTimeoutMs: 1,
      });

      const page = await withSearchTimeout(
        search.search({ sources: ['immich'], limit: 5 }),
      );

      expect(page.items.map((item) => item.asset.sourceId)).toEqual([
        'slow-asset',
      ]);
      expect(getMetadata).toHaveBeenCalledWith('slow-asset');
    } finally {
      cleanup();
    }
  });

  it('uses Immich smart search when asset search is source-scoped', async () => {
    const { db, cleanup } = createTestDb();
    try {
      migrate(db);
      cacheImmichConnection(db);
      setAssetConnectionIndexingEnabled('immich-1', true, { db });
      const registry = createAssetRegistry({ db });
      const search = vi.fn(async () => ({
        items: [
          cloudFile({
            id: 'asset-dog',
            name: 'Dog at the lake.jpg',
            mediaMetadata: {
              description: 'A golden retriever jumping into the lake',
            },
          }),
        ],
        nextCursor: '2',
        hasMore: false,
      }));
      const adapter = createAdapter({ search });

      const page = await searchImmichSourceScoped(
        {
          text: 'golden retriever lake',
          sources: ['immich'],
          limit: 5,
        },
        {
          db,
          registry,
          resolveAdapter: () => adapter,
        },
      );

      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'golden retriever lake',
          searchMode: 'context',
          limit: 5,
        }),
      );
      expect(page?.items[0]?.asset).toMatchObject({
        source: 'immich',
        connectionId: 'immich-1',
        sourceId: 'asset-dog',
        title: 'Dog at the lake.jpg',
      });
      expect(page?.nextCursor).toBe('2');
    } finally {
      cleanup();
    }
  });
});

function migrate(db: Database.Database) {
  runMigrations(db, [migration001, migration016, migration034]);
}

function cacheImmichConnection(db: Database.Database) {
  upsertCachedConnections(
    [
      {
        id: 'immich-1',
        provider: 'immich',
        displayName: 'Home Immich',
        status: 'active',
        connectedAt: '2026-05-01T00:00:00.000Z',
      },
    ],
    db,
  );
}

function cloudFile(overrides: Partial<CloudFile> = {}): CloudFile {
  return {
    id: 'asset-1',
    name: 'Image.jpg',
    mimeType: 'image/jpeg',
    size: 1024,
    createdAt: '2026-05-01T00:00:00.000Z',
    modifiedAt: '2026-05-01T00:00:00.000Z',
    parentId: null,
    isFolder: false,
    provider: 'immich',
    ...overrides,
  };
}

function createAdapter(
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

async function withSearchTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 50,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out waiting for catalog search')),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
