import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AssetSearchService,
  createAssetIndexer,
  createAssetRegistry,
  drainAssetJobs,
  type Asset,
} from '@/shared/assets';
import { migration as migration001 } from '@/shared/db/migrations/001_init';
import { migration as migration034 } from '@/shared/db/migrations/034_assets_catalog';
import { migration as migration035 } from '@/shared/db/migrations/035_assets_materialization';
import { runMigrations } from '@/shared/db/migrations/runner';
import {
  cloudStorageRegistry,
  type CloudStorageAdapter,
} from '@/shared/integrations/cloud-storage';

import { createTestDb } from '../../helpers/db';

let workspaceRoot: string;

describe('Assets API', () => {
  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-api-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('ingests a multipart file, searches FTS, and streams raw bytes', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const search = new AssetSearchService({ db, registry });
      const { createAssetsRoutes } = await import('@/app/api/assets');
      const routes = createAssetsRoutes({
        registry,
        search,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const body = new FormData();
      body.set(
        'file',
        new File(['catalog sunset asset'], 'sunset-note.txt', {
          type: 'text/plain',
        }),
      );
      body.set('tags', 'sunset,travel');

      const createRes = await routes.request('/', { method: 'POST', body });

      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as {
        asset: Asset;
        created: boolean;
      };
      expect(created.asset).toMatchObject({
        title: 'sunset-note.txt',
        kind: 'text',
        mime: 'text/plain',
        tags: ['sunset', 'travel'],
      });

      const searchRes = await routes.request('/search?q=sunset');
      expect(searchRes.status).toBe(200);
      const searchBody = (await searchRes.json()) as {
        items: Array<{
          asset: Asset;
          score: number;
          score_breakdown: { fts: number };
        }>;
      };
      expect(searchBody.items[0]?.asset.id).toBe(created.asset.id);
      expect(searchBody.items[0]?.score).toBeGreaterThan(0);
      expect(searchBody.items[0]?.score_breakdown.fts).toBeGreaterThan(0);

      const rawRes = await routes.request(`/${created.asset.id}/raw`);
      expect(rawRes.status).toBe(200);
      expect(rawRes.headers.get('content-type')).toBe('text/plain');
      expect(await rawRes.text()).toBe('catalog sunset asset');

      const deleteRes = await routes.request(`/${created.asset.id}`, {
        method: 'DELETE',
      });
      expect(deleteRes.status).toBe(200);
      expect((await routes.request(`/${created.asset.id}`)).status).toBe(404);
    } finally {
      cleanup();
    }
  });

  it('returns 400 for malformed JSON ingest bodies', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const search = new AssetSearchService({ db, registry });
      const { createAssetsRoutes } = await import('@/app/api/assets');
      const routes = createAssetsRoutes({
        registry,
        search,
        getWorkspaceRoot: () => workspaceRoot,
      });

      const res = await routes.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"path":',
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    } finally {
      cleanup();
    }
  });

  it('rejects multipart uploads before buffering oversized files', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const search = new AssetSearchService({ db, registry });
      const { createAssetsRoutes } = await import('@/app/api/assets');
      const routes = createAssetsRoutes({
        registry,
        search,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const body = new FormData();
      body.set(
        'file',
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'too-large.bin', {
          type: 'application/octet-stream',
        }),
      );

      const res = await routes.request('/', { method: 'POST', body });

      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({
        error: 'Asset upload exceeds 10 MB limit',
      });
    } finally {
      cleanup();
    }
  });

  it('reports storage stats and runs GC for old deleted assets', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      await fs.writeFile(path.join(workspaceRoot, 'stale.txt'), 'stale asset');
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const search = new AssetSearchService({ db, registry });
      const { createAssetsRoutes } = await import('@/app/api/assets');
      const routes = createAssetsRoutes({
        registry,
        search,
        getWorkspaceRoot: () => workspaceRoot,
      });

      const createRes = await routes.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'stale.txt' }),
      });
      const created = (await createRes.json()) as {
        asset: Asset;
        created: boolean;
      };

      const statsRes = await routes.request('/stats/storage');
      expect(statsRes.status).toBe(200);
      await expect(statsRes.json()).resolves.toMatchObject({
        activeCount: 1,
        localBytes: created.asset.bytes,
        cacheBytes: 0,
        materializedBytes: 0,
        proxyBytes: 0,
        previewArtifactBytes: 0,
        budgetBytes: 10 * 1024 * 1024 * 1024,
        warning: false,
      });

      await routes.request(`/${created.asset.id}`, { method: 'DELETE' });
      const gcRes = await routes.request('/gc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retentionDays: 0 }),
      });
      expect(gcRes.status).toBe(200);
      await expect(gcRes.json()).resolves.toMatchObject({
        result: {
          scanned: 1,
          purged: 1,
          skippedAttached: 0,
          bytesFreed: created.asset.bytes,
        },
      });
      // GC purges the catalog row but must NOT delete the user's original
      // in-place source file.
      await expect(
        fs.access(path.join(workspaceRoot, 'stale.txt')),
      ).resolves.toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('streams generated thumbnails and previews', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const search = new AssetSearchService({ db, registry });
      const indexer = createAssetIndexer({
        db,
        registry,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const sharp = (await import('sharp')).default;
      await sharp({
        create: {
          width: 12,
          height: 10,
          channels: 3,
          background: '#0ea5e9',
        },
      })
        .png()
        .toFile(path.join(workspaceRoot, 'thumb-source.png'));
      const { createAssetsRoutes } = await import('@/app/api/assets');
      const routes = createAssetsRoutes({
        registry,
        search,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const createRes = await routes.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'thumb-source.png' }),
      });
      const created = (await createRes.json()) as {
        asset: Asset;
        created: boolean;
      };

      await drainAssetJobs(1, { db, indexer });

      const thumbRes = await routes.request(`/${created.asset.id}/thumb`);
      expect(thumbRes.status).toBe(200);
      expect(thumbRes.headers.get('content-type')).toBe('image/webp');
      expect((await thumbRes.arrayBuffer()).byteLength).toBeGreaterThan(0);

      const previewRes = await routes.request(`/${created.asset.id}/preview`);
      expect(previewRes.status).toBe(200);
      expect(previewRes.headers.get('content-type')).toBe('image/jpeg');
    } finally {
      cleanup();
    }
  });

  it('proxies remote thumbnails when the catalog has no local derivative', async () => {
    const { db, cleanup } = createTestDb();
    const fakeAdapter = {
      provider: 'immich',
      getThumbnail: async (itemId: string) =>
        new Response(`thumbnail:${itemId}`, {
          headers: { 'content-type': 'image/jpeg' },
        }),
    } as CloudStorageAdapter;
    const resolveSpy = vi
      .spyOn(cloudStorageRegistry, 'resolve')
      .mockReturnValue(fakeAdapter);
    try {
      runMigrations(db, [migration001, migration034]);
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const search = new AssetSearchService({ db, registry });
      const { createAssetsRoutes } = await import('@/app/api/assets');
      const routes = createAssetsRoutes({
        registry,
        search,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const { asset } = registry.upsertRemote({
        source: 'immich',
        connectionId: 'immich-1',
        sourceId: 'photo-1',
        kind: 'image',
        mime: 'image/jpeg',
        bytes: 1234,
        width: 4000,
        height: 3000,
        title: 'Photo 1.jpg',
        provenance: {
          provider: 'immich',
          thumbnailUrl: 'immich-thumbnail:photo-1',
        },
      });

      const thumbRes = await routes.request(`/${asset.id}/thumb`);

      expect(thumbRes.status).toBe(200);
      expect(thumbRes.headers.get('content-type')).toBe('image/jpeg');
      expect(await thumbRes.text()).toBe('thumbnail:photo-1');
    } finally {
      resolveSpy.mockRestore();
      cleanup();
    }
  });

  it('proxies remote raw content with range headers for video playback', async () => {
    const { db, cleanup } = createTestDb();
    let seenRange: string | undefined;
    const fakeAdapter = {
      provider: 'google_drive',
      download: async (_itemId: string, init?: { range?: string }) => {
        seenRange = init?.range;
        return new Response('video-slice', {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-length': '11',
            'content-range': 'bytes 0-10/100',
            'accept-ranges': 'bytes',
          },
        });
      },
    } as CloudStorageAdapter;
    const resolveSpy = vi
      .spyOn(cloudStorageRegistry, 'resolve')
      .mockReturnValue(fakeAdapter);
    try {
      runMigrations(db, [migration001, migration034]);
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const search = new AssetSearchService({ db, registry });
      const { createAssetsRoutes } = await import('@/app/api/assets');
      const routes = createAssetsRoutes({
        registry,
        search,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const { asset } = registry.upsertRemote({
        source: 'google_drive',
        connectionId: 'drive-1',
        sourceId: 'video-1',
        kind: 'video',
        mime: 'video/mp4',
        bytes: 100,
        width: 1920,
        height: 1080,
        durationMs: 10_000,
        title: 'Drive clip.mp4',
        provenance: {
          provider: 'google_drive',
          webUrl: 'https://drive.google.com/file/d/video-1/view',
        },
      });

      const rawRes = await routes.request(`/${asset.id}/raw`, {
        headers: { Range: 'bytes=0-10' },
      });

      expect(seenRange).toBe('bytes=0-10');
      expect(rawRes.status).toBe(206);
      expect(rawRes.headers.get('content-type')).toBe('video/mp4');
      expect(rawRes.headers.get('content-range')).toBe('bytes 0-10/100');
      expect(rawRes.headers.get('accept-ranges')).toBe('bytes');
      expect(await rawRes.text()).toBe('video-slice');
    } finally {
      resolveSpy.mockRestore();
      cleanup();
    }
  });

  it('streams generated proxy and preview artifact rows', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034, migration035]);
      await fs.writeFile(path.join(workspaceRoot, 'clip.mp4'), 'source video');
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const search = new AssetSearchService({ db, registry });
      const { createAssetsRoutes } = await import('@/app/api/assets');
      const routes = createAssetsRoutes({
        registry,
        search,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const { asset } = await registry.ingest({
        source: 'local_fs',
        storagePath: 'clip.mp4',
        hint: {
          kind: 'video',
          mime: 'video/mp4',
          title: 'Clip.mp4',
        },
      });
      const contentHash = asset.contentHash;
      expect(contentHash).toBeTruthy();
      if (!contentHash) throw new Error('Expected local ingest content hash');

      const proxyPath = path.join(
        '.cache',
        'assets',
        'proxies',
        contentHash,
        'edit_1080p.webm',
      );
      const filmstripPath = path.join(
        '.cache',
        'assets',
        'artifacts',
        contentHash,
        'filmstrip',
        'frames.jsonl',
      );
      const waveformPath = path.join(
        '.cache',
        'assets',
        'artifacts',
        contentHash,
        'waveform.bin',
      );
      const posterPath = path.join(
        '.cache',
        'assets',
        'artifacts',
        contentHash,
        'poster.jpg',
      );
      await Promise.all(
        [proxyPath, filmstripPath, waveformPath, posterPath].map((filePath) =>
          fs.mkdir(path.dirname(path.join(workspaceRoot, filePath)), {
            recursive: true,
          }),
        ),
      );
      await fs.writeFile(path.join(workspaceRoot, proxyPath), 'proxy video');
      await fs.writeFile(path.join(workspaceRoot, filmstripPath), '{"t":0}\n');
      await fs.writeFile(path.join(workspaceRoot, waveformPath), 'waveform');
      await fs.writeFile(path.join(workspaceRoot, posterPath), 'poster');
      const now = 1_700_000_000_000;
      db.prepare(
        `INSERT INTO asset_cache (
          content_hash, cache_path, bytes, mime, fetched_at, last_used_at,
          origin_provider, origin_connection_id, origin_source_id,
          source_file_hint_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        contentHash,
        path.join(workspaceRoot, 'clip.mp4'),
        asset.bytes,
        asset.mime,
        now,
        now,
        'local_fs',
        null,
        null,
        null,
      );
      db.prepare(
        `INSERT INTO asset_proxies (
          content_hash, preset, proxy_path, bytes, generated_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(contentHash, 'edit_1080p', proxyPath, 11, now, now);
      const insertArtifact = db.prepare(
        `INSERT INTO asset_preview_artifacts (
          content_hash, kind, data_path, bytes, generated_at
        ) VALUES (?, ?, ?, ?, ?)`,
      );
      insertArtifact.run(contentHash, 'filmstrip', filmstripPath, 8, now);
      insertArtifact.run(contentHash, 'waveform', waveformPath, 8, now);
      insertArtifact.run(contentHash, 'poster', posterPath, 6, now);
      const insertMaterialization = db.prepare(
        `INSERT INTO asset_materializations (
          id, asset_id, scope, scope_id, active_path, content_hash, bytes,
          created_at, license_snapshot_json, client_request_id, role
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertMaterialization.run(
        'mat-video',
        asset.id,
        'video_project',
        'video-1',
        path.join(workspaceRoot, 'clip.mp4'),
        contentHash,
        4,
        now,
        null,
        null,
        'b-roll',
      );
      insertMaterialization.run(
        'mat-design',
        asset.id,
        'design_project',
        'design-1',
        path.join(workspaceRoot, 'clip.mp4'),
        contentHash,
        6,
        now,
        null,
        null,
        'reference',
      );

      const proxyRes = await routes.request(`/${asset.id}/proxy/edit_1080p`);
      expect(proxyRes.status).toBe(200);
      expect(proxyRes.headers.get('content-type')).toBe('video/webm');
      expect(await proxyRes.text()).toBe('proxy video');

      const invalidProxyRes = await routes.request(`/${asset.id}/proxy/nope`);
      expect(invalidProxyRes.status).toBe(400);

      const filmstripRes = await routes.request(`/${asset.id}/filmstrip`);
      expect(filmstripRes.status).toBe(200);
      expect(filmstripRes.headers.get('content-type')).toBe(
        'application/x-ndjson',
      );
      expect(await filmstripRes.text()).toBe('{"t":0}\n');

      const waveformRes = await routes.request(`/${asset.id}/waveform`);
      expect(waveformRes.status).toBe(200);
      expect(waveformRes.headers.get('content-type')).toBe(
        'application/octet-stream',
      );
      expect(await waveformRes.text()).toBe('waveform');

      const posterRes = await routes.request(`/${asset.id}/poster`);
      expect(posterRes.status).toBe(200);
      expect(posterRes.headers.get('content-type')).toBe('image/jpeg');
      expect(await posterRes.text()).toBe('poster');

      const statsRes = await routes.request('/stats/storage');
      expect(statsRes.status).toBe(200);
      await expect(statsRes.json()).resolves.toMatchObject({
        cacheBytes: asset.bytes,
        materializedBytes: 10,
        proxyBytes: 11,
        previewArtifactBytes: 22,
        materializedBytesByScope: [
          {
            scope: 'design_project',
            materializedBytes: 6,
            materializationCount: 1,
            projectCount: 1,
          },
          {
            scope: 'video_project',
            materializedBytes: 4,
            materializationCount: 1,
            projectCount: 1,
          },
        ],
      });
    } finally {
      cleanup();
    }
  });
});
