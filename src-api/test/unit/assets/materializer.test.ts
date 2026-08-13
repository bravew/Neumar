import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AssetMaterializer,
  AssetRegistry,
  AssetsError,
  __resetAssetMaterializerForTests,
  getAssetMaterializeStatus,
  subscribeAssetMaterializeEvents,
  type AssetMaterializeEvent,
} from '@/shared/assets';
import { getDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import type {
  Capabilities,
  CloudStorageAdapter,
  CloudStorageProvider,
} from '@/shared/integrations/cloud-storage';

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe('AssetMaterializer', () => {
  let workDir: string;
  let registry: AssetRegistry;
  let assetIds: string[];

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-materializer-'));
    setSetting('workDir', workDir);
    setSetting(
      'assets.materialize_session_budget_bytes',
      String(5 * 1024 * 1024 * 1024),
    );
    setSetting(
      'assets.materialize_project_budget_bytes',
      String(20 * 1024 * 1024 * 1024),
    );
    setSetting('assets.range_download_min_bytes', String(32 * 1024 * 1024));
    registry = new AssetRegistry();
    assetIds = [];
  });

  afterEach(async () => {
    __resetAssetMaterializerForTests();
    for (const assetId of assetIds) {
      try {
        registry.softDelete(assetId);
      } catch {
        // Best-effort cleanup; the temp workspace is removed below.
      }
    }
    await fs.rm(workDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  });

  it('downloads a remote-only asset once, reuses the cache, and dedupes retry requests', async () => {
    const sourceBytes = Buffer.concat([PNG_HEADER, Buffer.from(randomUUID())]);
    const contentHash = createHash('sha256').update(sourceBytes).digest('hex');
    const connectionId = `pexels-${randomUUID()}`;
    const sourceId = `photo-${randomUUID()}`;
    const { asset } = registry.upsertRemote({
      source: 'pexels',
      connectionId,
      sourceId,
      kind: 'image',
      mime: 'image/png',
      bytes: sourceBytes.byteLength,
      title: 'Attribution image.png',
      provenance: {
        licenseInfo: {
          provider: 'Pexels',
          license: 'Pexels',
          requiresAttribution: true,
          creatorName: 'Ada',
          attributionText: 'Photo by Ada on Pexels',
        },
      },
    });
    assetIds.push(asset.id);

    const { adapter, download } = createAdapter(sourceBytes);
    const materializer = new AssetMaterializer({
      registry,
      getWorkspaceRoot: () => workDir,
      resolveAdapter: async () => adapter,
      now: () => 1_700_000_000_000,
    });

    const first = await materializer.materialize({
      assetId: asset.id,
      scope: 'video_project',
      scopeId: 'project-a',
      reason: 'video_attach',
      sessionId: 'session-a',
      clientRequestId: 'request-1',
      role: 'b-roll',
    });

    expect(first).toMatchObject({
      cacheHit: false,
      contentHash,
      bytes: sourceBytes.byteLength,
      urls: {
        raw: `/assets/${asset.id}/raw`,
        preview: `/assets/${asset.id}/preview`,
      },
      license: {
        provider: 'Pexels',
        attribution: 'Photo by Ada on Pexels',
        attributionRequired: true,
        licenseCode: 'Pexels',
      },
    });
    await expect(fs.readFile(first.activePath)).resolves.toEqual(sourceBytes);

    const db = getDatabase();
    expect(
      db
        .prepare(
          `SELECT content_hash, bytes, origin_provider, origin_connection_id, origin_source_id
           FROM asset_cache
           WHERE content_hash = ?`,
        )
        .get(contentHash),
    ).toEqual({
      content_hash: contentHash,
      bytes: sourceBytes.byteLength,
      origin_provider: 'pexels',
      origin_connection_id: connectionId,
      origin_source_id: sourceId,
    });

    const second = await materializer.materialize({
      assetId: asset.id,
      scope: 'video_project',
      scopeId: 'project-a',
      reason: 'video_attach',
      sessionId: 'session-a',
      clientRequestId: 'request-2',
    });
    expect(second).toMatchObject({
      cacheHit: true,
      activePath: first.activePath,
      contentHash,
    });

    const retry = await materializer.materialize({
      assetId: asset.id,
      scope: 'video_project',
      scopeId: 'project-a',
      reason: 'video_attach',
      sessionId: 'session-a',
      clientRequestId: 'request-2',
    });
    expect(retry.materializationId).toBe(second.materializationId);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('retries transient download failures and emits progress events', async () => {
    const sourceBytes = Buffer.concat([PNG_HEADER, Buffer.from('retry')]);
    const { asset } = registry.upsertRemote({
      source: 'pexels',
      connectionId: `pexels-${randomUUID()}`,
      sourceId: `photo-${randomUUID()}`,
      kind: 'image',
      mime: 'image/png',
      bytes: sourceBytes.byteLength,
      title: 'Retry image.png',
    });
    assetIds.push(asset.id);

    let attempt = 0;
    const events: AssetMaterializeEvent[] = [];
    const unsubscribe = subscribeAssetMaterializeEvents((event) => {
      if (event.assetId === asset.id) events.push(event);
    });
    const { adapter, download } = createAdapter(sourceBytes, {
      download: async () => {
        attempt += 1;
        if (attempt === 1) {
          return new Response('try again', { status: 502 });
        }
        return responseFromBytes(sourceBytes);
      },
    });
    const materializer = new AssetMaterializer({
      registry,
      getWorkspaceRoot: () => workDir,
      resolveAdapter: async () => adapter,
    });

    const result = await materializer.materialize({
      assetId: asset.id,
      scope: 'video_project',
      scopeId: 'project-retry',
      reason: 'video_attach',
      sessionId: 'session-retry',
    });
    unsubscribe();

    expect(result.cacheHit).toBe(false);
    expect(download).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'materialize.started',
        'materialize.progress',
        'materialize.complete',
      ]),
    );
  });

  it('retries an interrupted whole-file response stream', async () => {
    const sourceBytes = Buffer.concat([
      PNG_HEADER,
      Buffer.from(`interrupted-stream-${randomUUID()}`),
    ]);
    const contentHash = createHash('sha256').update(sourceBytes).digest('hex');
    const { asset } = registry.upsertRemote({
      source: 'google_drive',
      connectionId: `google-drive-${randomUUID()}`,
      sourceId: `video-${randomUUID()}`,
      kind: 'video',
      mime: 'video/mp4',
      bytes: sourceBytes.byteLength,
      title: 'Interrupted stream.mp4',
    });
    assetIds.push(asset.id);

    let attempt = 0;
    const { adapter, download } = createAdapter(sourceBytes, {
      provider: 'google_drive',
      download: async () => {
        attempt += 1;
        if (attempt === 1) return interruptedResponseFromBytes(sourceBytes);
        return responseFromBytes(sourceBytes, {
          headers: { 'content-type': 'video/mp4' },
        });
      },
    });
    const materializer = new AssetMaterializer({
      registry,
      getWorkspaceRoot: () => workDir,
      resolveAdapter: async () => adapter,
    });

    const result = await materializer.materialize({
      assetId: asset.id,
      scope: 'video_project',
      scopeId: 'project-stream-retry',
      reason: 'video_attach',
      sessionId: 'session-stream-retry',
    });

    expect(result.contentHash).toBe(contentHash);
    await expect(fs.readFile(result.activePath)).resolves.toEqual(sourceBytes);
    expect(download).toHaveBeenCalledTimes(2);
    await expect(
      findPartialFiles(path.join(workDir, '.cache', 'assets', 'remote')),
    ).resolves.toEqual([]);
  });

  it('wraps repeated interrupted response streams as an asset error', async () => {
    const sourceBytes = Buffer.concat([
      PNG_HEADER,
      Buffer.from(`interrupted-stream-fail-${randomUUID()}`),
    ]);
    const { asset } = registry.upsertRemote({
      source: 'google_drive',
      connectionId: `google-drive-${randomUUID()}`,
      sourceId: `video-${randomUUID()}`,
      kind: 'video',
      mime: 'video/mp4',
      bytes: sourceBytes.byteLength,
      title: 'Interrupted stream failure.mp4',
    });
    assetIds.push(asset.id);

    const { adapter, download } = createAdapter(sourceBytes, {
      provider: 'google_drive',
      download: async () => interruptedResponseFromBytes(sourceBytes),
    });
    const materializer = new AssetMaterializer({
      registry,
      getWorkspaceRoot: () => workDir,
      resolveAdapter: async () => adapter,
    });

    await expect(
      materializer.materialize({
        assetId: asset.id,
        scope: 'video_project',
        scopeId: 'project-stream-fail',
        reason: 'video_attach',
        sessionId: 'session-stream-fail',
      }),
    ).rejects.toMatchObject({
      name: 'AssetsError',
      status: 502,
      detail: { code: 'ASSET_DOWNLOAD_STREAM_INTERRUPTED' },
    });
    expect(download).toHaveBeenCalledTimes(3);
    await expect(
      findPartialFiles(path.join(workDir, '.cache', 'assets', 'remote')),
    ).resolves.toEqual([]);
  });

  it('recovers cached bytes by source-file hint when content hash is absent', async () => {
    const sourceBytes = Buffer.concat([PNG_HEADER, Buffer.from('hint-match')]);
    const contentHash = createHash('sha256').update(sourceBytes).digest('hex');
    const connectionId = `pexels-${randomUUID()}`;
    const modifiedAt = 1_700_000_001_000;
    const first = registry.upsertRemote({
      source: 'pexels',
      connectionId,
      sourceId: `photo-${randomUUID()}`,
      kind: 'image',
      mime: 'image/png',
      bytes: sourceBytes.byteLength,
      title: 'Shared campaign image.png',
      modifiedAt,
    });
    const second = registry.upsertRemote({
      source: 'pexels',
      connectionId,
      sourceId: `photo-${randomUUID()}`,
      kind: 'image',
      mime: 'image/png',
      bytes: sourceBytes.byteLength,
      title: 'Shared campaign image.png',
      modifiedAt,
    });
    assetIds.push(first.asset.id, second.asset.id);

    const { adapter, download } = createAdapter(sourceBytes);
    const materializer = new AssetMaterializer({
      registry,
      getWorkspaceRoot: () => workDir,
      resolveAdapter: async () => adapter,
    });

    await materializer.materialize({
      assetId: first.asset.id,
      scope: 'video_project',
      scopeId: 'project-hint',
      reason: 'video_attach',
      sessionId: 'session-hint',
    });
    const recovered = await materializer.materialize({
      assetId: second.asset.id,
      scope: 'design_project',
      scopeId: 'project-hint',
      reason: 'design_attach',
      sessionId: 'session-hint',
    });

    expect(recovered).toMatchObject({
      cacheHit: true,
      contentHash,
      bytes: sourceBytes.byteLength,
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(
      getDatabase()
        .prepare('SELECT content_hash FROM assets WHERE id = ?')
        .get(second.asset.id),
    ).toEqual({ content_hash: contentHash });
  });

  it('records required download tracking once per session', async () => {
    const sourceBytes = Buffer.concat([
      PNG_HEADER,
      Buffer.from('unsplash-download-tracking'),
    ]);
    const connectionId = `unsplash-${randomUUID()}`;
    const sourceId = `photo-${randomUUID()}`;
    const trackingUrl = `https://api.unsplash.com/photos/${sourceId}/download`;
    const { asset } = registry.upsertRemote({
      source: 'unsplash',
      connectionId,
      sourceId,
      kind: 'image',
      mime: 'image/png',
      bytes: sourceBytes.byteLength,
      title: 'Tracked image.png',
      provenance: {
        licenseInfo: {
          provider: 'Unsplash',
          license: 'Unsplash',
          requiresAttribution: true,
          requiresDownloadTracking: true,
          downloadTrackingUrl: trackingUrl,
        },
      },
    });
    assetIds.push(asset.id);

    const { adapter, download, recordDownload } = createAdapter(sourceBytes, {
      provider: 'unsplash',
    });
    const materializer = new AssetMaterializer({
      registry,
      getWorkspaceRoot: () => workDir,
      resolveAdapter: async () => adapter,
    });

    await materializer.materialize({
      assetId: asset.id,
      scope: 'video_project',
      scopeId: 'project-tracking',
      reason: 'video_attach',
      sessionId: 'session-tracking-a',
      clientRequestId: 'request-tracking-1',
    });
    await materializer.materialize({
      assetId: asset.id,
      scope: 'video_project',
      scopeId: 'project-tracking',
      reason: 'video_attach',
      sessionId: 'session-tracking-a',
      clientRequestId: 'request-tracking-2',
    });
    await materializer.materialize({
      assetId: asset.id,
      scope: 'video_project',
      scopeId: 'project-tracking',
      reason: 'video_attach',
      sessionId: 'session-tracking-b',
      clientRequestId: 'request-tracking-3',
    });

    expect(download).toHaveBeenCalledTimes(1);
    expect(recordDownload).toHaveBeenCalledTimes(2);
    expect(recordDownload).toHaveBeenNthCalledWith(
      1,
      sourceId,
      expect.objectContaining({ trackingUrl }),
    );
    expect(recordDownload).toHaveBeenNthCalledWith(
      2,
      sourceId,
      expect.objectContaining({ trackingUrl }),
    );
  });

  it('reports generated proxy and preview artifact URLs in materialize status', async () => {
    const sourceBytes = Buffer.concat([
      PNG_HEADER,
      Buffer.from(`status-derivatives-${randomUUID()}`),
    ]);
    await fs.writeFile(path.join(workDir, 'status-source.png'), sourceBytes);
    const { asset } = await registry.ingest({
      source: 'local_fs',
      storagePath: 'status-source.png',
      clientRequestId: 'status-derivatives-source',
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Status source.png',
      },
    });
    assetIds.push(asset.id);
    expect(asset.contentHash).toBeTruthy();
    const contentHash = asset.contentHash!;
    const now = 1_700_000_000_000;
    const db = getDatabase();
    db.prepare(
      `INSERT INTO asset_cache (
        content_hash, cache_path, bytes, mime, fetched_at, last_used_at,
        origin_provider, origin_connection_id, origin_source_id,
        source_file_hint_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      contentHash,
      path.join(workDir, 'status-source.png'),
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
    ).run(
      contentHash,
      'design_2k',
      path.join(workDir, '.cache/assets/proxies/status.webp'),
      12,
      now,
      now,
    );
    db.prepare(
      `INSERT INTO asset_preview_artifacts (
        content_hash, kind, data_path, bytes, generated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      contentHash,
      'poster',
      path.join(workDir, '.cache/assets/artifacts/poster.jpg'),
      8,
      now,
    );

    expect(getAssetMaterializeStatus({ assetId: asset.id })).toMatchObject({
      urls: {
        proxy: {
          design_2k: `/assets/${asset.id}/proxy/design_2k`,
        },
        poster: `/assets/${asset.id}/poster`,
      },
      proxies: [
        expect.objectContaining({
          content_hash: contentHash,
          preset: 'design_2k',
          url: `/assets/${asset.id}/proxy/design_2k`,
        }),
      ],
      artifacts: [
        expect.objectContaining({
          content_hash: contentHash,
          kind: 'poster',
          url: `/assets/${asset.id}/poster`,
        }),
      ],
    });
  });

  it('uses range downloads when the upstream honors byte ranges', async () => {
    setSetting('assets.range_download_min_bytes', '1');
    const sourceBytes = Buffer.from('0123456789abcdef');
    const contentHash = createHash('sha256').update(sourceBytes).digest('hex');
    const { asset } = registry.upsertRemote({
      source: 'pexels',
      connectionId: `pexels-${randomUUID()}`,
      sourceId: `photo-${randomUUID()}`,
      kind: 'image',
      mime: 'image/png',
      bytes: sourceBytes.byteLength,
      title: 'Range image.png',
    });
    assetIds.push(asset.id);
    const ranges: string[] = [];
    const { adapter } = createAdapter(sourceBytes, {
      download: async (_id, init) => {
        const range = init?.range;
        if (!range) return responseFromBytes(sourceBytes);
        ranges.push(range);
        const match = range.match(/^bytes=(\d+)-(\d+)$/);
        if (!match) return new Response('bad range', { status: 416 });
        const start = Number(match[1]);
        const end = Number(match[2]);
        const chunk = sourceBytes.subarray(start, end + 1);
        return responseFromBytes(chunk, {
          status: 206,
          headers: {
            'content-range': `bytes ${start}-${end}/${sourceBytes.byteLength}`,
          },
        });
      },
    });
    const materializer = new AssetMaterializer({
      registry,
      getWorkspaceRoot: () => workDir,
      resolveAdapter: async () => adapter,
    });

    const result = await materializer.materialize({
      assetId: asset.id,
      scope: 'design_project',
      scopeId: 'project-range',
      reason: 'design_attach',
    });

    expect(result.contentHash).toBe(contentHash);
    await expect(fs.readFile(result.activePath)).resolves.toEqual(sourceBytes);
    expect(ranges).toHaveLength(1);
  });

  it('remembers when a provider connection ignores range downloads', async () => {
    setSetting('assets.range_download_min_bytes', '1');
    const connectionId = `pexels-${randomUUID()}`;
    const firstBytes = Buffer.from('first-large-asset');
    const secondBytes = Buffer.from('second-large-asset');
    const firstSourceId = `photo-${randomUUID()}`;
    const secondSourceId = `photo-${randomUUID()}`;
    const first = registry.upsertRemote({
      source: 'pexels',
      connectionId,
      sourceId: firstSourceId,
      kind: 'image',
      mime: 'image/png',
      bytes: firstBytes.byteLength,
      title: 'First no range.png',
    });
    const second = registry.upsertRemote({
      source: 'pexels',
      connectionId,
      sourceId: secondSourceId,
      kind: 'image',
      mime: 'image/png',
      bytes: secondBytes.byteLength,
      title: 'Second no range.png',
    });
    assetIds.push(first.asset.id, second.asset.id);

    const bytesById = new Map([
      [firstSourceId, firstBytes],
      [secondSourceId, secondBytes],
    ]);
    const rangeRequests: string[] = [];
    const { adapter, download } = createAdapter(firstBytes, {
      download: async (id, init) => {
        const bytes = bytesById.get(id) ?? firstBytes;
        if (init?.range) rangeRequests.push(init.range);
        return responseFromBytes(bytes);
      },
    });
    const materializer = new AssetMaterializer({
      registry,
      getWorkspaceRoot: () => workDir,
      resolveAdapter: async () => adapter,
    });

    await materializer.materialize({
      assetId: first.asset.id,
      scope: 'video_project',
      scopeId: 'project-no-range',
      reason: 'video_attach',
      sessionId: 'session-no-range',
    });
    await materializer.materialize({
      assetId: second.asset.id,
      scope: 'video_project',
      scopeId: 'project-no-range',
      reason: 'video_attach',
      sessionId: 'session-no-range',
    });

    expect(rangeRequests).toHaveLength(1);
    expect(download).toHaveBeenCalledTimes(3);
  });

  it('retries an interrupted ranged response stream', async () => {
    setSetting('assets.range_download_min_bytes', '1');
    const sourceBytes = Buffer.concat([
      PNG_HEADER,
      Buffer.from(`range-interrupted-${randomUUID()}`),
    ]);
    const contentHash = createHash('sha256').update(sourceBytes).digest('hex');
    const { asset } = registry.upsertRemote({
      source: 'google_drive',
      connectionId: `google-drive-${randomUUID()}`,
      sourceId: `video-${randomUUID()}`,
      kind: 'video',
      mime: 'video/mp4',
      bytes: sourceBytes.byteLength,
      title: 'Interrupted range.mp4',
    });
    assetIds.push(asset.id);

    let attempt = 0;
    const ranges: string[] = [];
    const { adapter, download } = createAdapter(sourceBytes, {
      provider: 'google_drive',
      download: async (_id, init) => {
        const range = init?.range;
        if (!range) return responseFromBytes(sourceBytes);
        ranges.push(range);
        const headers = {
          'content-range': `bytes 0-${sourceBytes.byteLength - 1}/${sourceBytes.byteLength}`,
          'content-type': 'video/mp4',
        };
        attempt += 1;
        if (attempt === 1) {
          return interruptedResponseFromBytes(sourceBytes, {
            status: 206,
            headers,
          });
        }
        return responseFromBytes(sourceBytes, { status: 206, headers });
      },
    });
    const materializer = new AssetMaterializer({
      registry,
      getWorkspaceRoot: () => workDir,
      resolveAdapter: async () => adapter,
    });

    const result = await materializer.materialize({
      assetId: asset.id,
      scope: 'video_project',
      scopeId: 'project-range-stream-retry',
      reason: 'video_attach',
      sessionId: 'session-range-stream-retry',
    });

    expect(result.contentHash).toBe(contentHash);
    await expect(fs.readFile(result.activePath)).resolves.toEqual(sourceBytes);
    expect(download).toHaveBeenCalledTimes(2);
    expect(ranges).toEqual([
      `bytes=0-${sourceBytes.byteLength - 1}`,
      `bytes=0-${sourceBytes.byteLength - 1}`,
    ]);
    await expect(
      findPartialFiles(path.join(workDir, '.cache', 'assets', 'remote')),
    ).resolves.toEqual([]);
  });

  it('removes partial range downloads when materialization is aborted', async () => {
    setSetting('assets.range_download_min_bytes', '1');
    const controller = new AbortController();
    const sourceId = `photo-${randomUUID()}`;
    const { asset } = registry.upsertRemote({
      source: 'pexels',
      connectionId: `pexels-${randomUUID()}`,
      sourceId,
      kind: 'image',
      mime: 'image/png',
      bytes: 8 * 1024 * 1024 + 1,
      title: 'Abort range image.png',
    });
    assetIds.push(asset.id);
    const ranges: string[] = [];
    const { adapter } = createAdapter(Buffer.from('unused'), {
      download: async (_id, init) => {
        if (!init?.range) return responseFromBytes(Buffer.from('unused'));
        ranges.push(init.range);
        if (ranges.length === 1) {
          return responseFromBytes(Buffer.from('partial'), {
            status: 206,
            headers: {
              'content-range': `bytes 0-6/${asset.bytes}`,
            },
          });
        }
        controller.abort(new DOMException('User cancelled', 'AbortError'));
        throw controller.signal.reason;
      },
    });
    const materializer = new AssetMaterializer({
      registry,
      getWorkspaceRoot: () => workDir,
      resolveAdapter: async () => adapter,
    });

    await expect(
      materializer.materialize({
        assetId: asset.id,
        scope: 'video_project',
        scopeId: 'project-abort',
        reason: 'video_attach',
        sessionId: 'session-abort',
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/i);

    await expect(
      findPartialFiles(path.join(workDir, '.cache', 'assets', 'remote')),
    ).resolves.toEqual([]);
    expect(ranges).toHaveLength(2);
    expect(
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM asset_cache
           WHERE origin_source_id = ?`,
        )
        .get(sourceId),
    ).toEqual({ count: 0 });
    expect(
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM asset_materializations
           WHERE asset_id = ?`,
        )
        .get(asset.id),
    ).toEqual({ count: 0 });
  });

  it('returns structured detail when a session budget blocks materialization', async () => {
    setSetting('assets.materialize_session_budget_bytes', '8');
    const sourceBytes = Buffer.from('larger-than-budget');
    const { asset } = registry.upsertRemote({
      source: 'pexels',
      connectionId: `pexels-${randomUUID()}`,
      sourceId: `photo-${randomUUID()}`,
      kind: 'image',
      mime: 'image/png',
      bytes: sourceBytes.byteLength,
      title: 'Budget image.png',
    });
    assetIds.push(asset.id);
    const { adapter, download } = createAdapter(sourceBytes);
    const materializer = new AssetMaterializer({
      registry,
      getWorkspaceRoot: () => workDir,
      resolveAdapter: async () => adapter,
    });

    try {
      await materializer.materialize({
        assetId: asset.id,
        scope: 'video_project',
        scopeId: 'project-budget',
        reason: 'video_attach',
        sessionId: 'session-budget',
      });
      throw new Error('Expected materialization to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AssetsError);
      expect(error).toMatchObject({
        status: 412,
        detail: {
          code: 'ASSET_MATERIALIZE_BUDGET_EXCEEDED',
          budget: 'session',
          usedBytes: 0,
          limitBytes: 8,
          requestedBytes: sourceBytes.byteLength,
          requiredBytes: sourceBytes.byteLength,
          sessionId: 'session-budget',
          scope: 'video_project',
          scopeId: 'project-budget',
        },
      });
    }
    expect(download).not.toHaveBeenCalled();
  });
});

function createAdapter(
  bytes: Buffer,
  overrides: {
    capabilities?: Partial<Capabilities>;
    download?: CloudStorageAdapter['download'];
    provider?: CloudStorageProvider;
    recordDownload?: NonNullable<CloudStorageAdapter['recordDownload']>;
  } = {},
) {
  const provider = overrides.provider ?? 'pexels';
  const file = {
    id: 'remote-image',
    name: 'Attribution image.png',
    mimeType: 'image/png',
    size: bytes.byteLength,
    createdAt: new Date(0).toISOString(),
    modifiedAt: new Date(0).toISOString(),
    parentId: null,
    isFolder: false,
    provider,
  };
  const emptyPage = { items: [], hasMore: false };
  const download = vi.fn<CloudStorageAdapter['download']>(
    overrides.download ?? (async () => responseFromBytes(bytes)),
  );
  const recordDownload = vi.fn<
    NonNullable<CloudStorageAdapter['recordDownload']>
  >(overrides.recordDownload ?? (async () => {}));

  const adapter: CloudStorageAdapter = {
    provider,
    getCapabilities: () => ({
      fullTextSearch: false,
      thumbnails: true,
      exportContent: true,
      watch: false,
      longPoll: false,
      sharedDrives: false,
      ...overrides.capabilities,
    }),
    listChildren: async () => emptyPage,
    search: async () => emptyPage,
    getMetadata: async () => file,
    download,
    recordDownload,
    exportContent: async () => ({
      fileId: file.id,
      content: bytes.toString('base64'),
      mimeType: 'image/png',
      size: bytes.byteLength,
      isBase64: true,
    }),
    createFolder: async () => file,
    upload: async () => file,
    updateMetadata: async () => file,
    move: async () => file,
    copy: async () => file,
    delete: async () => {},
    getChanges: async () => ({ changes: [], hasMore: false }),
  };
  return { adapter, download, recordDownload };
}

function responseFromBytes(
  bytes: Buffer,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  const body = new Uint8Array(bytes).buffer as ArrayBuffer;
  return new Response(body, {
    status: init.status,
    headers: {
      'content-length': String(bytes.byteLength),
      'content-type': 'image/png',
      ...init.headers,
    },
  });
}

function interruptedResponseFromBytes(
  bytes: Buffer,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(bytes.subarray(0, Math.min(4, bytes.byteLength)));
        return;
      }
      controller.error(terminatedStreamError());
    },
  });
  return new Response(body, {
    status: init.status,
    headers: {
      'content-length': String(bytes.byteLength),
      'content-type': 'image/png',
      ...init.headers,
    },
  });
}

function terminatedStreamError(): TypeError {
  const cause = Object.assign(new Error('Stream closed'), {
    code: 'ERR_HTTP2_STREAM_ERROR',
  });
  return new TypeError('terminated', { cause });
}

async function findPartialFiles(root: string): Promise<string[]> {
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findPartialFiles(child)));
    } else if (entry.isFile() && entry.name.endsWith('.partial')) {
      files.push(child);
    }
  }
  return files.sort();
}
