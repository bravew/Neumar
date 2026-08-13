import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AssetEmbeddingService,
  AssetArtifactEngine,
  AssetMaterializer,
  AssetProxyEngine,
  createAssetIndexer,
  createAssetRegistry,
  drainAssetJobs,
  subscribeAssetMaterializeEvents,
  type Asset,
  type AssetMaterializeEvent,
  type AssetJob,
} from '@/shared/assets';
import type { AssetIndexer } from '@/shared/assets/indexer/pipeline';
import { probeAssetFile } from '@/shared/assets/indexer/probe';
import { extractIndexableText } from '@/shared/assets/indexer/text-extract';
import { migration as migration001 } from '@/shared/db/migrations/001_init';
import { migration as migration034 } from '@/shared/db/migrations/034_assets_catalog';
import { migration as migration035 } from '@/shared/db/migrations/035_assets_materialization';
import { runMigrations } from '@/shared/db/migrations/runner';

import { createTestDb } from '../../helpers/db';

let workspaceRoot: string;
const execFileAsync = promisify(execFile);

describe('AssetIndexer', () => {
  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-indexer-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('drains ingest jobs, extracts text, and writes image thumbnails', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const sharp = (await import('sharp')).default;
      await sharp({
        create: {
          width: 8,
          height: 6,
          channels: 3,
          background: '#ef4444',
        },
      })
        .png()
        .toFile(path.join(workspaceRoot, 'poster.png'));
      await fs.writeFile(
        path.join(workspaceRoot, 'notes.txt'),
        'indexable catalog notes',
      );

      const image = await registry.ingest({
        source: 'local_fs',
        storagePath: 'poster.png',
      });
      const text = await registry.ingest({
        source: 'local_fs',
        storagePath: 'notes.txt',
      });
      const indexer = createAssetIndexer({
        db,
        registry,
        getWorkspaceRoot: () => workspaceRoot,
      });

      const jobs = await drainAssetJobs(10, { db, indexer });

      expect(jobs).toHaveLength(2);
      expect(jobs.map((job) => job.status)).toEqual(['done', 'done']);
      const indexedImage = registry.get(image.asset.id);
      expect(indexedImage).toMatchObject({
        indexState: 'embedded',
        width: 8,
        height: 6,
      });
      expect(indexedImage?.thumbPath).toMatch(/thumb\.webp$/);
      expect(
        await fs.stat(path.join(workspaceRoot, indexedImage!.thumbPath!)),
      ).toMatchObject({ size: expect.any(Number) });
      expect(registry.get(text.asset.id)).toMatchObject({
        indexState: 'embedded',
        ocrText: 'indexable catalog notes',
      });
    } finally {
      cleanup();
    }
  });

  it('skips oversized PDF metadata and text reads', async () => {
    const filePath = path.join(workspaceRoot, 'huge.pdf');
    const largePdfBytes = 100 * 1024 * 1024 + 1;
    await fs.writeFile(filePath, '');
    await fs.truncate(filePath, largePdfBytes);
    const asset = assetFixture({
      kind: 'pdf',
      mime: 'application/pdf',
      bytes: largePdfBytes,
      storagePath: 'huge.pdf',
    });

    await expect(
      probeAssetFile(asset, filePath, workspaceRoot),
    ).resolves.toEqual({
      bytes: largePdfBytes,
      width: undefined,
      height: undefined,
      exif: undefined,
    });
    await expect(extractIndexableText(asset, filePath)).resolves.toBeNull();
  });

  it('re-encodes embedded assets in batches', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      let embedCount = 0;
      const embedding = new AssetEmbeddingService({
        db,
        localTextModelReady: () => true,
        textEmbedder: async () => {
          embedCount += 1;
          const vector = new Float32Array(768);
          vector[0] = 1;
          return vector;
        },
      });
      const indexer = createAssetIndexer({
        db,
        registry,
        embedding,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const now = Date.now();
      const insert = db.prepare(
        `INSERT INTO assets (
          id, source, kind, mime, bytes, title, imported_at, modified_at, index_state
        )
        VALUES (?, 'local_fs', 'text', 'text/plain', 1, ?, ?, ?, 'embedded')`,
      );
      for (let i = 0; i < 205; i += 1) {
        insert.run(`asset-${i}`, `Asset ${i}`, now - i, now - i);
      }

      const result = await indexer.runJob(
        assetJob('reencode', {
          modality: 'text',
        }),
      );

      expect(result).toMatchObject({
        modality: 'text',
        assets: 205,
        embedded: 205,
        skipped: 0,
      });
      expect(embedCount).toBe(205);
    } finally {
      cleanup();
    }
  });

  it('queues and drains proxy/artifact jobs for materialized video assets', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034, migration035]);
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const sourceBytes = Buffer.from('synthetic 4k video fixture');
      const contentHash = createHash('sha256')
        .update(sourceBytes)
        .digest('hex');
      const sourcePath = path.join(workspaceRoot, 'remote-source.mp4');
      await fs.writeFile(sourcePath, sourceBytes);
      const now = 1_700_000_000_000;
      const { asset } = registry.upsertRemote({
        source: 'box',
        connectionId: 'box-derivative-fixture',
        sourceId: 'video-4k',
        kind: 'video',
        mime: 'video/mp4',
        bytes: 600 * 1024 * 1024,
        width: 3840,
        height: 2160,
        durationMs: 60_000,
        contentHash,
        title: '4k source.mp4',
      });
      db.prepare(
        `INSERT INTO asset_cache (
          content_hash, cache_path, bytes, mime, fetched_at, last_used_at,
          origin_provider, origin_connection_id, origin_source_id,
          source_file_hint_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        contentHash,
        sourcePath,
        sourceBytes.byteLength,
        'video/mp4',
        now,
        now,
        'box',
        'box-derivative-fixture',
        'video-4k',
        null,
      );

      const events: AssetMaterializeEvent[] = [];
      const unsubscribe = subscribeAssetMaterializeEvents((event) => {
        if (event.assetId === asset.id) events.push(event);
      });
      const materializer = new AssetMaterializer({
        db,
        registry,
        getWorkspaceRoot: () => workspaceRoot,
        resolveAdapter: async () => null,
        scheduleJobDrain: () => {},
        now: () => now,
      });

      await materializer.materialize({
        assetId: asset.id,
        scope: 'video_project',
        scopeId: 'project-derivatives',
        reason: 'video_attach',
        sessionId: 'session-derivatives',
        clientRequestId: 'request-derivatives',
        proxies: ['edit_1080p'],
      });

      const queued = db
        .prepare(
          `SELECT kind, payload_json
           FROM asset_jobs
           WHERE kind IN ('proxy', 'artifact')
           ORDER BY kind`,
        )
        .all() as Array<{ kind: string; payload_json: string }>;
      expect(queued.map((job) => job.kind)).toEqual(['artifact', 'proxy']);
      expect(
        queued.map(
          (job) => JSON.parse(job.payload_json) as Record<string, unknown>,
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assetId: asset.id,
            contentHash,
            artifactKind: 'filmstrip',
            scope: 'video_project',
            scopeId: 'project-derivatives',
          }),
          expect.objectContaining({
            assetId: asset.id,
            contentHash,
            preset: 'edit_1080p',
            scope: 'video_project',
            scopeId: 'project-derivatives',
          }),
        ]),
      );

      const proxyEngine = new AssetProxyEngine({
        db,
        registry,
        getWorkspaceRoot: () => workspaceRoot,
        now: () => now + 1,
        renderer: async ({ outputPath }) => {
          await fs.writeFile(outputPath, 'proxy bytes');
          return { width: 1920, height: 1080, durationMs: 60_000 };
        },
      });
      const artifactEngine = new AssetArtifactEngine({
        db,
        registry,
        getWorkspaceRoot: () => workspaceRoot,
        now: () => now + 2,
        renderer: async ({ outputPath }) => {
          await fs.writeFile(
            outputPath,
            `${JSON.stringify({ timestamp_ms: 0, path: '.cache/frame.jpg' })}\n`,
            'utf8',
          );
        },
      });
      const indexer = createAssetIndexer({
        db,
        registry,
        getWorkspaceRoot: () => workspaceRoot,
        proxyEngine,
        artifactEngine,
      });

      const jobs = await drainAssetJobs(10, { db, indexer });
      unsubscribe();

      expect(jobs).toHaveLength(2);
      expect(jobs.map((job) => job.status)).toEqual(['done', 'done']);
      const proxy = db
        .prepare(
          `SELECT preset, proxy_path, bytes, width, height, duration_ms
           FROM asset_proxies
           WHERE content_hash = ?`,
        )
        .get(contentHash);
      expect(proxy).toMatchObject({
        preset: 'edit_1080p',
        bytes: 11,
        width: 1920,
        height: 1080,
        duration_ms: 60_000,
      });
      const artifact = db
        .prepare(
          `SELECT kind, data_path, bytes
           FROM asset_preview_artifacts
           WHERE content_hash = ?`,
        )
        .get(contentHash);
      expect(artifact).toMatchObject({
        kind: 'filmstrip',
        bytes: expect.any(Number),
      });
      await expect(
        fs.readFile((proxy as { proxy_path: string }).proxy_path, 'utf8'),
      ).resolves.toBe('proxy bytes');
      await expect(
        fs.readFile((artifact as { data_path: string }).data_path, 'utf8'),
      ).resolves.toContain('"timestamp_ms":0');
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          'materialize.complete',
          'proxy.complete',
          'artifact.complete',
        ]),
      );
    } finally {
      cleanup();
    }
  });

  it('generates proxy and filmstrip from a real 4K mp4 when ffmpeg is available', async () => {
    if (!(await canRunRealFfmpeg4kFixture())) return;
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034, migration035]);
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const sourcePath = path.join(workspaceRoot, 'real-4k-source.mp4');
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=navy:s=3840x2160:r=1:d=1',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          sourcePath,
        ],
        { timeout: 30_000 },
      );
      const sourceBytes = await fs.readFile(sourcePath);
      const sourceStat = await fs.stat(sourcePath);
      const contentHash = createHash('sha256')
        .update(sourceBytes)
        .digest('hex');
      const now = 1_700_000_010_000;
      const { asset } = registry.upsertRemote({
        source: 'box',
        connectionId: 'box-real-ffmpeg-fixture',
        sourceId: 'real-4k-video',
        kind: 'video',
        mime: 'video/mp4',
        bytes: sourceStat.size,
        width: 3840,
        height: 2160,
        durationMs: 1000,
        contentHash,
        title: 'real 4k source.mp4',
      });
      db.prepare(
        `INSERT INTO asset_cache (
          content_hash, cache_path, bytes, mime, fetched_at, last_used_at,
          origin_provider, origin_connection_id, origin_source_id,
          source_file_hint_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        contentHash,
        sourcePath,
        sourceStat.size,
        'video/mp4',
        now,
        now,
        'box',
        'box-real-ffmpeg-fixture',
        'real-4k-video',
        null,
      );

      const proxyEngine = new AssetProxyEngine({
        db,
        registry,
        getWorkspaceRoot: () => workspaceRoot,
        now: () => now + 1,
      });
      const artifactEngine = new AssetArtifactEngine({
        db,
        registry,
        getWorkspaceRoot: () => workspaceRoot,
        now: () => now + 2,
      });

      const proxy = await proxyEngine.generate({
        assetId: asset.id,
        contentHash,
        preset: 'edit_1080p',
      });
      const filmstrip = await artifactEngine.generate({
        assetId: asset.id,
        contentHash,
        kind: 'filmstrip',
      });

      expect(proxy).toMatchObject({
        bytes: expect.any(Number),
        generated: true,
      });
      expect(filmstrip).toMatchObject({
        bytes: expect.any(Number),
        generated: true,
      });
      const proxyRow = db
        .prepare(
          `SELECT width, height, duration_ms
           FROM asset_proxies
           WHERE content_hash = ? AND preset = 'edit_1080p'`,
        )
        .get(contentHash) as
        | { width: number; height: number; duration_ms: number }
        | undefined;
      expect(proxyRow?.width).toBeLessThanOrEqual(1920);
      expect(proxyRow?.height).toBeLessThanOrEqual(1080);
      expect(proxyRow?.duration_ms).toBeGreaterThan(0);
      await expect(fs.readFile(filmstrip.path!, 'utf8')).resolves.toContain(
        'timestamp_ms',
      );
    } finally {
      cleanup();
    }
  });

  it('backs off derivative job failures before marking attempts exhausted', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034, migration035]);
      let now = 10_000;
      db.prepare(
        `INSERT INTO asset_jobs (
          id, kind, status, payload_json, created_at, updated_at, attempts
        ) VALUES (?, ?, 'queued', ?, ?, ?, 0)`,
      ).run(
        'job-proxy-retry',
        'proxy',
        JSON.stringify({
          assetId: 'asset-retry',
          contentHash: 'hash-retry',
          preset: 'edit_1080p',
          scope: 'video_project',
          scopeId: 'project-retry',
        }),
        now,
        now,
      );
      const indexer = {
        runJob: vi.fn(async () => {
          throw new Error('renderer busy');
        }),
      } as unknown as AssetIndexer;

      const first = await drainAssetJobs(1, {
        db,
        indexer,
        now: () => now,
      });
      expect(first[0]).toMatchObject({ attempts: 1, status: 'queued' });
      expect(indexer.runJob).toHaveBeenCalledTimes(1);
      let row = assetJobRow(db, 'job-proxy-retry');
      expect(row.updated_at).toBe(now + 5_000);

      await expect(
        drainAssetJobs(1, { db, indexer, now: () => now }),
      ).resolves.toEqual([]);
      expect(indexer.runJob).toHaveBeenCalledTimes(1);

      now = row.updated_at;
      const second = await drainAssetJobs(1, {
        db,
        indexer,
        now: () => now,
      });
      expect(second[0]).toMatchObject({ attempts: 2, status: 'queued' });
      row = assetJobRow(db, 'job-proxy-retry');
      expect(row.updated_at).toBe(now + 10_000);

      now = row.updated_at;
      const third = await drainAssetJobs(1, {
        db,
        indexer,
        now: () => now,
      });
      expect(third[0]).toMatchObject({ attempts: 3, status: 'error' });
      row = assetJobRow(db, 'job-proxy-retry');
      expect(row.status).toBe('error');
      expect(row.attempts).toBe(3);
      expect(indexer.runJob).toHaveBeenCalledTimes(3);
    } finally {
      cleanup();
    }
  });
});

function assetFixture(patch: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-pdf',
    source: 'local_fs',
    connectionId: null,
    sourceId: null,
    clientRequestId: null,
    kind: 'text',
    mime: 'text/plain',
    bytes: 0,
    width: null,
    height: null,
    durationMs: null,
    contentHash: null,
    perceptualHash: null,
    title: null,
    description: null,
    caption: null,
    ocrText: null,
    transcript: null,
    storagePath: null,
    thumbPath: null,
    previewPath: null,
    capturedAt: null,
    importedAt: 1,
    modifiedAt: 1,
    deletedAt: null,
    provenance: null,
    exif: null,
    gpsLat: null,
    gpsLng: null,
    indexState: 'embedded',
    indexError: null,
    tags: [],
    attachments: [],
    ...patch,
  };
}

function assetJob(kind: string, payload: Record<string, unknown>): AssetJob {
  return {
    id: `job-${kind}`,
    kind,
    status: 'running',
    payload,
    result: {},
    errorText: null,
    createdAt: 1,
    updatedAt: 1,
    cancelledAt: null,
    attempts: 1,
  };
}

function assetJobRow(db: ReturnType<typeof createTestDb>['db'], id: string) {
  return db.prepare('SELECT * FROM asset_jobs WHERE id = ?').get(id) as {
    attempts: number;
    status: string;
    updated_at: number;
  };
}

async function canRunRealFfmpeg4kFixture(): Promise<boolean> {
  if (!(await commandAvailable('ffmpeg', ['-version']))) return false;
  if (!(await commandAvailable('ffprobe', ['-version']))) return false;
  return commandOutputIncludes(
    'ffmpeg',
    ['-hide_banner', '-encoders'],
    ['libx264', 'libvpx-vp9'],
  );
}

async function commandAvailable(command: string, args: string[]) {
  try {
    await execFileAsync(command, args, { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

async function commandOutputIncludes(
  command: string,
  args: string[],
  needles: string[],
) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 5000,
    });
    const output = `${stdout}${stderr}`;
    return needles.every((needle) => output.includes(needle));
  } catch {
    return false;
  }
}
