import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AssetRegistry,
  __resetAssetMaterializerForTests,
} from '@/shared/assets';
import { closeDatabase, getDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import {
  attachCatalogAssetToProject,
  hydrateProjectAsset,
  hydrateReferencedProjectAssets,
} from '@/shared/video/catalog-assets';
import { createProject, getProject } from '@/shared/video/store';

describe('video catalog asset attachments', () => {
  let homeDir: string;
  let workDir: string;
  let registry: AssetRegistry;
  let assetIds: string[];

  beforeEach(async () => {
    __resetAssetMaterializerForTests();
    closeDatabase();
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-catalog-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-catalog-'));
    vi.stubEnv('HOME', homeDir);
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setSetting('workDir', workDir);
    registry = new AssetRegistry();
    assetIds = [];
  });

  afterEach(async () => {
    for (const assetId of assetIds) {
      try {
        registry.softDelete(assetId);
      } catch {
        // Best-effort cleanup; the temp workspace is removed below.
      }
    }
    __resetAssetMaterializerForTests();
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('materializes a catalog image into the video project and records the attachment', async () => {
    const project = await createProject({
      name: 'Catalog bridge',
      template: 'slideshow',
    });
    const sharp = (await import('sharp')).default;
    const sourceBytes = await sharp({
      create: {
        width: 11,
        height: 7,
        channels: 3,
        background: '#ef4444',
      },
    })
      .png()
      .toBuffer();
    await fs.mkdir(path.join(workDir, 'library'), { recursive: true });
    await fs.writeFile(path.join(workDir, 'library', 'hero.png'), sourceBytes);
    const ingested = await registry.ingest({
      source: 'local_fs',
      storagePath: 'library/hero.png',
      clientRequestId: randomUUID(),
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Hero Image',
      },
    });
    assetIds.push(ingested.asset.id);

    const attached = await attachCatalogAssetToProject(
      project.id,
      ingested.asset.id,
      { role: 'b-roll', hydrate: 'proxy' },
    );

    expect(attached.asset).toMatchObject({
      kind: 'image',
      // Catalog attaches are tagged `'downloaded'` so the inspector and
      // provenance dialog stop labelling them as a manual user upload.
      source: 'downloaded',
      provenance: {
        // Local-fs ingests don't carry a richer provenance.provider, so
        // we fall back to the catalog source ('local_fs').
        provider: 'local_fs',
        sourceUrl: `asset:${ingested.asset.id}`,
        sourceDisplayName: 'Hero Image',
        attribution: 'local_fs',
      },
      metadata: {
        width: 11,
        height: 7,
      },
    });
    expect(attached.project.assets.map((asset) => asset.id)).toEqual([
      attached.asset.id,
    ]);
    await expect(
      fs.readFile(path.join(workDir, attached.asset.path)),
    ).resolves.toEqual(sourceBytes);
    expect(registry.get(ingested.asset.id)?.attachments).toEqual([
      {
        scope: 'video_project',
        scopeId: project.id,
        role: 'b-roll',
        attachedAt: expect.any(Number),
      },
    ]);
  });

  it('stamps the catalog capture date onto the attached asset metadata', async () => {
    const project = await createProject({
      name: 'Capture date montage',
      template: 'slideshow',
    });
    const sharp = (await import('sharp')).default;
    const sourceBytes = await sharp({
      create: { width: 12, height: 8, channels: 3, background: '#10b981' },
    })
      .png()
      .toBuffer();
    await fs.mkdir(path.join(workDir, 'library'), { recursive: true });
    await fs.writeFile(path.join(workDir, 'library', 'dated.png'), sourceBytes);
    const capturedMs = Date.parse('2025-02-16T19:08:21.000Z');
    const ingested = await registry.ingest({
      source: 'local_fs',
      storagePath: 'library/dated.png',
      clientRequestId: randomUUID(),
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Dated Image',
        capturedAt: capturedMs,
      },
    });
    assetIds.push(ingested.asset.id);

    const attached = await attachCatalogAssetToProject(
      project.id,
      ingested.asset.id,
      { role: 'asset', hydrate: 'proxy' },
    );

    expect(attached.asset.metadata.capturedAt).toBe('2025-02-16T19:08:21.000Z');
  });

  it('hydrates reference-only catalog project assets by project media id', async () => {
    const project = await createProject({
      name: 'Deferred catalog bridge',
      template: 'slideshow',
    });
    const sharp = (await import('sharp')).default;
    const sourceBytes = await sharp({
      create: {
        width: 16,
        height: 9,
        channels: 3,
        background: '#2563eb',
      },
    })
      .png()
      .toBuffer();
    await fs.mkdir(path.join(workDir, 'library'), { recursive: true });
    await fs.writeFile(
      path.join(workDir, 'library', 'deferred.png'),
      sourceBytes,
    );
    const ingested = await registry.ingest({
      source: 'local_fs',
      storagePath: 'library/deferred.png',
      clientRequestId: randomUUID(),
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Deferred Image',
      },
    });
    assetIds.push(ingested.asset.id);
    const referenced = await attachCatalogAssetToProject(
      project.id,
      ingested.asset.id,
      { role: 'b-roll', hydrate: 'none' },
    );

    expect(referenced.asset).toMatchObject({
      path: `catalog:${ingested.asset.id}`,
      materializationState: 'referenced',
    });

    const hydrated = await hydrateReferencedProjectAssets(
      project.id,
      [referenced.asset.id, 'missing-media-item'],
      { role: 'asset' },
    );

    expect(hydrated.assets).toHaveLength(1);
    expect(hydrated.assets[0]).toMatchObject({
      id: referenced.asset.id,
      kind: 'image',
      source: 'downloaded',
      materializationState: 'ready',
      provenance: { catalogAssetId: ingested.asset.id },
    });
    expect(hydrated.assets[0]?.path).not.toBe(`catalog:${ingested.asset.id}`);
    await expect(
      fs.readFile(path.join(workDir, hydrated.assets[0]!.path)),
    ).resolves.toEqual(sourceBytes);

    const stored = await getProject(project.id);
    expect(stored.assets[0]).toMatchObject({
      id: referenced.asset.id,
      materializationState: 'ready',
    });
  });

  it('rehydrates a catalog-backed ready asset when its project copy is missing', async () => {
    const project = await createProject({
      name: 'Recover missing project copy',
      template: 'slideshow',
    });
    const sharp = (await import('sharp')).default;
    const sourceBytes = await sharp({
      create: {
        width: 18,
        height: 10,
        channels: 3,
        background: '#2563eb',
      },
    })
      .png()
      .toBuffer();
    await fs.mkdir(path.join(workDir, 'library'), { recursive: true });
    await fs.writeFile(
      path.join(workDir, 'library', 'recover.png'),
      sourceBytes,
    );
    const ingested = await registry.ingest({
      source: 'local_fs',
      storagePath: 'library/recover.png',
      clientRequestId: randomUUID(),
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Recover Image',
      },
    });
    assetIds.push(ingested.asset.id);
    const attached = await attachCatalogAssetToProject(
      project.id,
      ingested.asset.id,
      { role: 'b-roll', hydrate: 'proxy' },
    );

    await fs.rm(path.join(workDir, attached.asset.path));
    const repaired = await hydrateProjectAsset(project.id, attached.asset.id, {
      role: 'asset',
    });

    expect(repaired.asset).toMatchObject({
      id: attached.asset.id,
      kind: 'image',
      source: 'downloaded',
      materializationState: 'ready',
      provenance: { catalogAssetId: ingested.asset.id },
    });
    await expect(
      fs.readFile(path.join(workDir, repaired.asset.path)),
    ).resolves.toEqual(sourceBytes);
    const stored = await getProject(project.id);
    expect(stored.assets[0]?.path).toBe(repaired.asset.path);
  });

  it('hands ready catalog proxy and artifact URLs to attached video media', async () => {
    const project = await createProject({
      name: 'Catalog proxy bridge',
      template: 'custom',
    });
    const sourceBytes = Buffer.from(`video-bytes-${randomUUID()}`);
    const sourcePath = path.join(workDir, 'library', 'source.mp4');
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, sourceBytes);
    const ingested = await registry.ingest({
      source: 'local_fs',
      storagePath: 'library/source.mp4',
      clientRequestId: randomUUID(),
      hint: {
        kind: 'video',
        mime: 'video/mp4',
        width: 3840,
        height: 2160,
        durationMs: 120_000,
        title: 'Source clip',
      },
    });
    assetIds.push(ingested.asset.id);
    const contentHash =
      ingested.asset.contentHash ??
      createHash('sha256').update(sourceBytes).digest('hex');
    const proxyPath = path.join(
      workDir,
      '.cache',
      'assets',
      'proxies',
      contentHash.slice(0, 2),
      contentHash.slice(2),
      'edit_1080p.webm',
    );
    const filmstripPath = path.join(
      workDir,
      '.cache',
      'assets',
      'artifacts',
      contentHash.slice(0, 2),
      contentHash.slice(2),
      'filmstrip',
      'frames.jsonl',
    );
    await Promise.all([
      fs.mkdir(path.dirname(proxyPath), { recursive: true }),
      fs.mkdir(path.dirname(filmstripPath), { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(proxyPath, 'proxy bytes ready'),
      fs.writeFile(filmstripPath, '{"timestamp_ms":0,"path":"frame-0.jpg"}\n'),
    ]);
    const now = Date.now();
    const db = getDatabase();
    db.prepare(
      `INSERT OR REPLACE INTO asset_cache (
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
      'local_fs',
      null,
      null,
      null,
    );
    db.prepare(
      `INSERT OR REPLACE INTO asset_proxies (
        content_hash, preset, proxy_path, bytes, width, height, duration_ms,
        generated_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      contentHash,
      'edit_1080p',
      proxyPath,
      17,
      1920,
      1080,
      120_000,
      now,
      now,
    );
    db.prepare(
      `INSERT OR REPLACE INTO asset_preview_artifacts (
        content_hash, kind, data_path, bytes, generated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(contentHash, 'filmstrip', filmstripPath, 42, now);

    const attached = await attachCatalogAssetToProject(
      project.id,
      ingested.asset.id,
      { role: 'b-roll', hydrate: 'proxy' },
    );

    const proxy = attached.asset.proxy;
    expect(proxy).toBeDefined();
    if (!proxy) throw new Error('Expected catalog proxy hand-off');
    const realWorkDir = await fs.realpath(workDir);
    const realProxyPath = await fs.realpath(proxyPath);
    expect(proxy).toMatchObject({
      source: 'asset_catalog',
      url: `/assets/${encodeURIComponent(ingested.asset.id)}/proxy/edit_1080p`,
      path: path.relative(realWorkDir, realProxyPath),
      widthPx: 1920,
      heightPx: 1080,
      bitrateBps: 1,
    });
    expect(attached.asset.filmstripUrl).toBe(
      `/assets/${encodeURIComponent(ingested.asset.id)}/filmstrip`,
    );
    expect(attached.asset.waveformUrl).toBeUndefined();
    expect(attached.project.assets[0]).toMatchObject({
      id: attached.asset.id,
      proxy: {
        source: 'asset_catalog',
      },
      filmstripUrl: `/assets/${encodeURIComponent(ingested.asset.id)}/filmstrip`,
    });
    await expect(
      fs.readFile(path.join(realWorkDir, proxy.path), 'utf8'),
    ).resolves.toBe('proxy bytes ready');
  });

  it('hands ready waveform artifact URLs to attached audio media', async () => {
    const project = await createProject({
      name: 'Catalog waveform bridge',
      template: 'custom',
    });
    const sourceBytes = Buffer.from(`audio-bytes-${randomUUID()}`);
    const sourcePath = path.join(workDir, 'library', 'voice.wav');
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, sourceBytes);
    const ingested = await registry.ingest({
      source: 'local_fs',
      storagePath: 'library/voice.wav',
      clientRequestId: randomUUID(),
      hint: {
        kind: 'audio',
        mime: 'audio/wav',
        durationMs: 45_000,
        title: 'Voice track',
      },
    });
    assetIds.push(ingested.asset.id);
    const contentHash =
      ingested.asset.contentHash ??
      createHash('sha256').update(sourceBytes).digest('hex');
    const waveformPath = path.join(
      workDir,
      '.cache',
      'assets',
      'artifacts',
      contentHash.slice(0, 2),
      contentHash.slice(2),
      'waveform.bin',
    );
    await fs.mkdir(path.dirname(waveformPath), { recursive: true });
    await fs.writeFile(waveformPath, 'waveform bytes');
    const now = Date.now();
    const db = getDatabase();
    db.prepare(
      `INSERT OR REPLACE INTO asset_cache (
        content_hash, cache_path, bytes, mime, fetched_at, last_used_at,
        origin_provider, origin_connection_id, origin_source_id,
        source_file_hint_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      contentHash,
      sourcePath,
      sourceBytes.byteLength,
      'audio/wav',
      now,
      now,
      'local_fs',
      null,
      null,
      null,
    );
    db.prepare(
      `INSERT OR REPLACE INTO asset_preview_artifacts (
        content_hash, kind, data_path, bytes, generated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(contentHash, 'waveform', waveformPath, 14, now);

    const attached = await attachCatalogAssetToProject(
      project.id,
      ingested.asset.id,
      { role: 'voiceover', hydrate: 'proxy' },
    );

    expect(attached.asset.kind).toBe('audio');
    expect(attached.asset.proxy).toBeUndefined();
    expect(attached.asset.filmstripUrl).toBeUndefined();
    expect(attached.asset.waveformUrl).toBe(
      `/assets/${encodeURIComponent(ingested.asset.id)}/waveform`,
    );
    expect(attached.project.assets[0]).toMatchObject({
      id: attached.asset.id,
      waveformUrl: `/assets/${encodeURIComponent(ingested.asset.id)}/waveform`,
    });
  });

  it('rejects non-media catalog assets without changing the project', async () => {
    const project = await createProject({
      name: 'Catalog unsupported',
      template: 'slideshow',
    });
    await fs.writeFile(path.join(workDir, 'notes.txt'), 'not timeline media');
    const ingested = await registry.ingest({
      source: 'local_fs',
      storagePath: 'notes.txt',
      clientRequestId: randomUUID(),
      hint: {
        kind: 'text',
        mime: 'text/plain',
        title: 'Notes',
      },
    });
    assetIds.push(ingested.asset.id);

    await expect(
      attachCatalogAssetToProject(project.id, ingested.asset.id),
    ).rejects.toMatchObject({ status: 400 });
    await expect(getProject(project.id)).resolves.toMatchObject({
      assets: [],
    });
  });

  it('preserves every reference-only asset when catalog attaches run in parallel', async () => {
    const project = await createProject({
      name: 'Parallel catalog attaches',
      template: 'slideshow',
    });
    const remoteAssets = Array.from({ length: 6 }, (_, index) => {
      const { asset } = registry.upsertRemote({
        source: 'immich',
        connectionId: 'immich-1',
        sourceId: `photo-${index}`,
        kind: 'image',
        mime: 'image/jpeg',
        bytes: 1024 + index,
        width: 4000,
        height: 3000,
        title: `Photo ${index}.jpg`,
        provenance: {
          provider: 'immich',
          webUrl: `https://immich.example/photos/photo-${index}`,
          thumbnailUrl: `immich-thumbnail:photo-${index}`,
        },
      });
      assetIds.push(asset.id);
      return asset;
    });

    await Promise.all(
      remoteAssets.map((asset) =>
        attachCatalogAssetToProject(project.id, asset.id),
      ),
    );

    const reloaded = await getProject(project.id);
    expect(reloaded.assets).toHaveLength(remoteAssets.length);
    expect(
      new Set(reloaded.assets.map((asset) => asset.provenance?.catalogAssetId)),
    ).toEqual(new Set(remoteAssets.map((asset) => asset.id)));
    expect(reloaded.assets[0]?.provenance).toMatchObject({
      connectionId: 'immich-1',
      sourceId: expect.stringMatching(/^photo-/),
      thumbnailUrl: expect.stringMatching(/^immich-thumbnail:photo-/),
    });
  });

  it('returns the existing project asset when the same catalog asset is attached again', async () => {
    const project = await createProject({
      name: 'Duplicate catalog attach',
      template: 'slideshow',
    });
    const { asset } = registry.upsertRemote({
      source: 'immich',
      connectionId: 'immich-1',
      sourceId: 'photo-duplicate',
      kind: 'image',
      mime: 'image/jpeg',
      bytes: 4096,
      width: 4000,
      height: 3000,
      title: 'Photo duplicate.jpg',
      provenance: {
        provider: 'immich',
        webUrl: 'https://immich.example/photos/photo-duplicate',
        thumbnailUrl: 'immich-thumbnail:photo-duplicate',
      },
    });
    assetIds.push(asset.id);

    const [first, second, third] = await Promise.all([
      attachCatalogAssetToProject(project.id, asset.id),
      attachCatalogAssetToProject(project.id, asset.id),
      attachCatalogAssetToProject(project.id, asset.id),
    ]);

    expect(second.asset.id).toBe(first.asset.id);
    expect(third.asset.id).toBe(first.asset.id);
    const reloaded = await getProject(project.id);
    expect(reloaded.assets).toHaveLength(1);
    expect(reloaded.assets[0]).toMatchObject({
      id: first.asset.id,
      path: `catalog:${asset.id}`,
      provenance: {
        catalogAssetId: asset.id,
        sourceDisplayName: 'Photo duplicate.jpg',
      },
    });
  });
});
