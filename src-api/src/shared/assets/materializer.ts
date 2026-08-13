import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import type { CloudStorageAdapter } from '@/shared/integrations/cloud-storage';

import { scheduleAssetJobDrain } from './indexer/jobs';
import {
  __resetAssetDownloadCapabilitiesForTests,
  downloadAssetToPartial,
} from './materializer-download';
import {
  emitMaterializeCancelled,
  emitMaterializeComplete,
  emitMaterializeError,
  emitMaterializeProgress,
  emitMaterializeStarted,
} from './materializer-events';
import {
  cachePathFor,
  copyMaterializedFile,
  defaultResolveAdapter,
  extensionForCache,
  licenseSnapshotFor,
  safeSegment,
  settingNumber,
  sha256File,
  sourceFileHintForAsset,
  stringifySourceFileHint,
  type CacheRow,
} from './materializer-helpers';
import {
  cacheRow,
  cacheRowByOrigin,
  cacheRowBySourceFileHint,
  findIdempotentMaterializationRow,
  insertMaterializationRow,
  materializeResultFromRow,
  touchCacheRow,
} from './materializer-store';
import type {
  MaterializeRequest,
  MaterializeResult,
  PreviewArtifactKind,
  ProxyPreset,
} from './materializer-types';
import { AssetRegistry, AssetsError } from './registry';
import type { Asset, AttachmentScope } from './types';
import { getAssetsWorkspaceRoot } from './workspace';

const DEFAULT_SESSION_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_PROJECT_BUDGET_BYTES = 20 * 1024 * 1024 * 1024;
const DEFAULT_RANGE_DOWNLOAD_MIN_BYTES = 32 * 1024 * 1024;
const sessionBytes = new Map<string, number>();
const trackedDownloads = new Map<string, Promise<void>>();

interface MaterializerOptions {
  db?: Database.Database;
  registry?: AssetRegistry;
  getWorkspaceRoot?: () => string;
  resolveAdapter?: (asset: Asset) => Promise<CloudStorageAdapter | null>;
  scheduleJobDrain?: (
    limit: number,
    options: { db: Database.Database },
  ) => void;
  now?: () => number;
}

export class AssetMaterializer {
  private readonly db: Database.Database;
  private readonly registry: AssetRegistry;
  private readonly getWorkspaceRoot: () => string;
  private readonly resolveAdapter: (
    asset: Asset,
  ) => Promise<CloudStorageAdapter | null>;
  private readonly scheduleJobDrain: (
    limit: number,
    options: { db: Database.Database },
  ) => void;
  private readonly now: () => number;
  // Single-flight: concurrent `materialize` calls for the same
  // (asset, scope, scopeId, role) share one in-flight promise instead
  // of stampeding the cloud adapter. Drop-on-timeline races with an
  // agent transcode racing with a render-preflight on the same clip
  // would otherwise each open a parallel multi-GB stream and
  // double/triple count toward the session byte budget. See macOS File
  // Provider `fetchContentsForItemWithIdentifier` and the Go singleflight
  // pattern for prior art.
  private readonly inflight = new Map<string, Promise<MaterializeResult>>();
  // External cancel hook keyed by the same single-flight key. Hydrate
  // endpoints can call `cancel(req)` to fire `signal.abort()` on the
  // in-flight download adapter (already plumbed through
  // `materializer-download.ts`). On abort the inflight Map entry
  // releases via the `.finally` below, so a follow-up retry will start
  // a fresh fetch.
  private readonly cancellers = new Map<string, AbortController>();

  constructor(options: MaterializerOptions = {}) {
    this.db = options.db ?? getDatabase();
    this.getWorkspaceRoot = options.getWorkspaceRoot ?? getAssetsWorkspaceRoot;
    this.registry =
      options.registry ??
      new AssetRegistry({
        db: this.db,
        getWorkspaceRoot: this.getWorkspaceRoot,
      });
    this.resolveAdapter = options.resolveAdapter ?? defaultResolveAdapter;
    this.scheduleJobDrain = options.scheduleJobDrain ?? scheduleAssetJobDrain;
    this.now = options.now ?? Date.now;
  }

  async materialize(req: MaterializeRequest): Promise<MaterializeResult> {
    const key = inflightKey(req);
    const inflight = this.inflight.get(key);
    if (inflight) return inflight;
    // Wire an internal AbortController so an external `cancel(req)`
    // can abort the download adapter even when the caller didn't pass
    // its own signal. If the caller did, we link both — aborting
    // either propagates.
    const controller = new AbortController();
    const callerSignal = req.signal;
    // Forward caller abort -> internal controller. Track the listener
    // explicitly so we can detach it in the `.finally` below; otherwise
    // a caller that reuses a long-lived signal across many materializes
    // would accumulate listeners (each closing over its controller).
    let forwardAbort: (() => void) | undefined;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason);
      else {
        forwardAbort = () => controller.abort(callerSignal.reason);
        callerSignal.addEventListener('abort', forwardAbort, { once: true });
      }
    }
    const merged: MaterializeRequest = { ...req, signal: controller.signal };
    this.cancellers.set(key, controller);
    const promise = this.runMaterialize(merged).finally(() => {
      this.inflight.delete(key);
      if (this.cancellers.get(key) === controller) {
        this.cancellers.delete(key);
      }
      if (forwardAbort && callerSignal) {
        callerSignal.removeEventListener('abort', forwardAbort);
      }
    });
    this.inflight.set(key, promise);
    return promise;
  }

  // External cancel by single-flight key. Aborts the in-flight download
  // (the cloud adapter accepts `req.signal` via
  // `downloadAssetToPartial`) and lets the inflight Map release. A
  // subsequent `materialize` call with the same key starts a fresh
  // fetch. Returns whether anything was actually cancelled.
  cancel(req: {
    assetId: string;
    scope: AttachmentScope['scope'];
    scopeId: string;
    role?: string;
  }): boolean {
    const key = inflightKey({
      assetId: req.assetId,
      scope: req.scope,
      scopeId: req.scopeId,
      role: req.role,
      reason: 'video_hydrate',
    });
    const controller = this.cancellers.get(key);
    if (!controller) return false;
    controller.abort(new AssetsError('Hydration cancelled by user', 499));
    return true;
  }

  private async runMaterialize(
    req: MaterializeRequest,
  ): Promise<MaterializeResult> {
    emitMaterializeStarted(req);
    try {
      const asset = this.registry.get(req.assetId);
      if (!asset) throw new AssetsError('Asset not found', 404);

      const existing = findIdempotentMaterializationRow(this.db, req);
      if (existing) {
        await this.enqueueDerivativeJobs(asset, req, existing.content_hash);
        return emitMaterializeComplete(
          req,
          materializeResultFromRow(req.assetId, existing, true),
        );
      }

      this.assertProjectBudget(req, asset.bytes);

      const local = await this.localMaterialization(asset).catch((error) => {
        if (error instanceof AssetsError && error.status === 404) return null;
        throw error;
      });
      if (local) {
        const row = insertMaterializationRow(
          this.db,
          this.now(),
          req,
          asset,
          local.absolutePath,
          { contentHash: local.contentHash, bytes: local.bytes },
        );
        await this.enqueueDerivativeJobs(asset, req, row.content_hash);
        return emitMaterializeComplete(
          req,
          materializeResultFromRow(asset.id, row, true),
        );
      }

      if (!asset.connectionId || !asset.sourceId) {
        throw new AssetsError('Asset is not materializable', 404);
      }

      let cache = await this.findReusableCache(asset);
      const cacheHit = Boolean(cache);
      if (!cache) {
        this.assertSessionBudget(req, asset.bytes);
        cache = await this.downloadToCache(asset, req);
        if (req.sessionId) this.recordSessionBudget(req.sessionId, cache.bytes);
      } else {
        touchCacheRow(this.db, this.now(), cache.content_hash);
        this.recordRecoveredContentHash(asset, cache.content_hash);
      }
      await this.recordDownloadTrackingIfNeeded(asset, req);

      const row = insertMaterializationRow(
        this.db,
        this.now(),
        req,
        asset,
        cache.cache_path,
        { contentHash: cache.content_hash, bytes: cache.bytes },
      );
      await this.enqueueDerivativeJobs(asset, req, row.content_hash);
      return emitMaterializeComplete(
        req,
        materializeResultFromRow(asset.id, row, cacheHit),
      );
    } catch (error) {
      // Distinguish a user cancel from a hard failure so the UI can
      // surface a quieter "Cancelled" state with a retry affordance
      // instead of a red error badge.
      if (req.signal?.aborted || isMaterializeAbortError(error)) {
        emitMaterializeCancelled(req);
      } else {
        emitMaterializeError(req, error);
      }
      throw error;
    }
  }

  async copyInto(
    materialization: MaterializeResult,
    targetPath: string,
    opts: { strategy?: 'clone' | 'copy' | 'hardlink' } = {},
  ): Promise<void> {
    await copyMaterializedFile(
      materialization.activePath,
      targetPath,
      opts.strategy ?? 'clone',
    );
    this.db
      .prepare('UPDATE asset_materializations SET active_path = ? WHERE id = ?')
      .run(targetPath, materialization.materializationId);
    materialization.activePath = targetPath;
  }

  recordSessionBudget(sessionId: string, bytes: number): void {
    sessionBytes.set(sessionId, (sessionBytes.get(sessionId) ?? 0) + bytes);
  }

  private async localMaterialization(asset: Asset) {
    const { absolutePath } = this.registry.storagePathFor(asset.id);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) throw new AssetsError('Asset file not found', 404);
    const contentHash = asset.contentHash ?? (await sha256File(absolutePath));
    return { absolutePath, bytes: stat.size, contentHash };
  }

  private async downloadToCache(
    asset: Asset,
    req: MaterializeRequest,
  ): Promise<CacheRow> {
    const adapter = await this.resolveAdapter(asset);
    if (!adapter) throw new AssetsError('Asset connector not found', 404);

    const partial = path.join(
      this.getWorkspaceRoot(),
      '.cache',
      'assets',
      'remote',
      safeSegment(asset.source),
      `${randomUUID()}.partial`,
    );
    await fs.mkdir(path.dirname(partial), { recursive: true });
    const written = await downloadAssetToPartial(adapter, asset, req, partial, {
      rangeMinBytes: settingNumber(
        'assets.range_download_min_bytes',
        DEFAULT_RANGE_DOWNLOAD_MIN_BYTES,
      ),
      onProgress: (bytes, total) => emitMaterializeProgress(req, bytes, total),
    });
    const finalPath = cachePathFor(
      this.getWorkspaceRoot(),
      asset.source,
      written.contentHash,
      extensionForCache(asset.mime, asset.title),
    );
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.rename(partial, finalPath).catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await fs.rm(partial, { force: true });
    });

    const now = this.now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO asset_cache (
          content_hash, cache_path, bytes, mime, fetched_at, last_used_at,
          origin_provider, origin_connection_id, origin_source_id,
          source_file_hint_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        written.contentHash,
        finalPath,
        written.bytes,
        written.mime,
        now,
        now,
        asset.source,
        asset.connectionId,
        asset.sourceId,
        stringifySourceFileHint(sourceFileHintForAsset(asset)),
      );
    this.db
      .prepare(
        'UPDATE assets SET content_hash = ?, modified_at = ? WHERE id = ?',
      )
      .run(written.contentHash, now, asset.id);
    return {
      content_hash: written.contentHash,
      cache_path: finalPath,
      bytes: written.bytes,
    };
  }

  private async findReusableCache(asset: Asset): Promise<CacheRow | null> {
    const candidates = [
      cacheRow(this.db, asset.contentHash),
      cacheRowByOrigin(this.db, asset),
      cacheRowBySourceFileHint(this.db, asset),
    ].filter((row): row is CacheRow => Boolean(row));
    for (const row of candidates) {
      if (await this.cachePathExists(row)) return row;
    }
    return null;
  }

  private async cachePathExists(row: CacheRow): Promise<boolean> {
    if (!this.pathIsInsideWorkspace(row.cache_path)) return false;
    const stat = await fs.stat(row.cache_path).catch(() => null);
    return Boolean(stat?.isFile());
  }

  private pathIsInsideWorkspace(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    const root = path.resolve(this.getWorkspaceRoot());
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
  }

  private recordRecoveredContentHash(asset: Asset, contentHash: string): void {
    if (asset.contentHash === contentHash) return;
    this.db
      .prepare(
        'UPDATE assets SET content_hash = ?, modified_at = ? WHERE id = ?',
      )
      .run(contentHash, this.now(), asset.id);
    asset.contentHash = contentHash;
  }

  private async recordDownloadTrackingIfNeeded(
    asset: Asset,
    req: MaterializeRequest,
  ): Promise<void> {
    const license = licenseSnapshotFor(asset);
    const metadataRequiresTracking = Boolean(
      license?.raw?.requiresDownloadTracking ||
      license?.raw?.downloadTrackingUrl,
    );
    if (!metadataRequiresTracking && !asset.connectionId) return;

    const adapter = await this.resolveAdapter(asset);
    if (!adapter) {
      if (metadataRequiresTracking) {
        throw new AssetsError('Asset download tracking is required', 502, {
          code: 'ASSET_DOWNLOAD_TRACKING_UNAVAILABLE',
          assetId: asset.id,
        });
      }
      return;
    }

    const capabilityRequiresTracking = Boolean(
      adapter.getCapabilities().licenseInfo?.downloadTrackingRequired,
    );
    if (!metadataRequiresTracking && !capabilityRequiresTracking) return;
    if (!asset.sourceId) {
      throw new AssetsError(
        'Asset download tracking source id is missing',
        502,
        {
          code: 'ASSET_DOWNLOAD_TRACKING_UNAVAILABLE',
          assetId: asset.id,
        },
      );
    }
    if (!adapter.recordDownload) {
      throw new AssetsError('Asset download tracking is unavailable', 502, {
        code: 'ASSET_DOWNLOAD_TRACKING_UNAVAILABLE',
        assetId: asset.id,
        provider: asset.source,
      });
    }

    const trackingKey = downloadTrackingKey(asset, req);
    const existing = trackedDownloads.get(trackingKey);
    if (existing) return existing;
    const tracking = adapter
      .recordDownload(asset.sourceId, {
        trackingUrl: license?.raw?.downloadTrackingUrl,
        signal: req.signal,
      })
      .catch((error) => {
        trackedDownloads.delete(trackingKey);
        throw error;
      });
    trackedDownloads.set(trackingKey, tracking);
    await tracking;
  }

  private assertSessionBudget(req: MaterializeRequest, bytes: number): void {
    if (!req.sessionId) return;
    const limit = settingNumber(
      'assets.materialize_session_budget_bytes',
      DEFAULT_SESSION_BUDGET_BYTES,
    );
    const used = sessionBytes.get(req.sessionId) ?? 0;
    if (limit > 0 && used + bytes > limit) {
      throw new AssetsError('Materialize session budget exceeded', 412, {
        code: 'ASSET_MATERIALIZE_BUDGET_EXCEEDED',
        budget: 'session',
        usedBytes: used,
        limitBytes: limit,
        requestedBytes: bytes,
        requiredBytes: used + bytes,
        sessionId: req.sessionId,
        scope: req.scope,
        scopeId: req.scopeId,
      });
    }
  }

  private assertProjectBudget(req: MaterializeRequest, bytes: number): void {
    const limit = settingNumber(
      'assets.materialize_project_budget_bytes',
      DEFAULT_PROJECT_BUDGET_BYTES,
    );
    if (limit <= 0) return;
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(bytes), 0) AS used
         FROM asset_materializations
         WHERE scope = ? AND scope_id = ?`,
      )
      .get(req.scope, req.scopeId) as { used: number };
    if (row.used + bytes > limit) {
      throw new AssetsError('Materialize project budget exceeded', 412, {
        code: 'ASSET_MATERIALIZE_BUDGET_EXCEEDED',
        budget: 'project',
        usedBytes: row.used,
        limitBytes: limit,
        requestedBytes: bytes,
        requiredBytes: row.used + bytes,
        scope: req.scope,
        scopeId: req.scopeId,
      });
    }
  }

  private async enqueueDerivativeJobs(
    asset: Asset,
    req: MaterializeRequest,
    contentHash: string | null,
  ): Promise<void> {
    if (!contentHash) return;
    let enqueued = 0;
    for (const preset of proxyPresetsFor(asset, req, this.db)) {
      if (await this.proxyAvailable(contentHash, preset)) continue;
      if (this.hasPendingDerivativeJob('proxy', contentHash, preset, req)) {
        continue;
      }
      this.insertDerivativeJob('proxy', {
        assetId: asset.id,
        contentHash,
        preset,
        scope: req.scope,
        scopeId: req.scopeId,
        sessionId: req.sessionId,
      });
      enqueued += 1;
    }
    for (const kind of artifactKindsFor(asset, req)) {
      if (await this.artifactAvailable(contentHash, kind)) continue;
      if (this.hasPendingDerivativeJob('artifact', contentHash, kind, req)) {
        continue;
      }
      this.insertDerivativeJob('artifact', {
        assetId: asset.id,
        contentHash,
        artifactKind: kind,
        scope: req.scope,
        scopeId: req.scopeId,
        sessionId: req.sessionId,
      });
      enqueued += 1;
    }
    if (enqueued > 0) {
      this.scheduleJobDrain(Math.max(2, enqueued), { db: this.db });
    }
  }

  private async proxyAvailable(
    contentHash: string,
    preset: ProxyPreset,
  ): Promise<boolean> {
    const row = this.db
      .prepare(
        `SELECT proxy_path
         FROM asset_proxies
         WHERE content_hash = ? AND preset = ?`,
      )
      .get(contentHash, preset) as { proxy_path: string } | undefined;
    if (!row) return false;
    const stat = await fs.stat(row.proxy_path).catch(() => null);
    if (stat?.isFile()) return true;
    this.db
      .prepare(
        'DELETE FROM asset_proxies WHERE content_hash = ? AND preset = ?',
      )
      .run(contentHash, preset);
    return false;
  }

  private async artifactAvailable(
    contentHash: string,
    kind: PreviewArtifactKind,
  ): Promise<boolean> {
    const row = this.db
      .prepare(
        `SELECT data_path
         FROM asset_preview_artifacts
         WHERE content_hash = ? AND kind = ?`,
      )
      .get(contentHash, kind) as { data_path: string } | undefined;
    if (!row) return false;
    const stat = await fs.stat(row.data_path).catch(() => null);
    if (stat?.isFile()) return true;
    this.db
      .prepare(
        'DELETE FROM asset_preview_artifacts WHERE content_hash = ? AND kind = ?',
      )
      .run(contentHash, kind);
    return false;
  }

  private hasPendingDerivativeJob(
    kind: 'proxy' | 'artifact',
    contentHash: string,
    variant: string,
    req: MaterializeRequest,
  ): boolean {
    const rows = this.db
      .prepare(
        `SELECT payload_json
         FROM asset_jobs
         WHERE kind = ?
           AND status IN ('queued', 'running')`,
      )
      .all(kind) as Array<{ payload_json: string }>;
    return rows.some((row) =>
      derivativeJobMatches(row.payload_json, kind, contentHash, variant, req),
    );
  }

  private insertDerivativeJob(
    kind: 'proxy' | 'artifact',
    payload: Record<string, unknown>,
  ): void {
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO asset_jobs
         (id, kind, status, payload_json, created_at, updated_at)
         VALUES (?, ?, 'queued', ?, ?, ?)`,
      )
      .run(randomUUID(), kind, JSON.stringify(payload), now, now);
  }
}

let singleton: AssetMaterializer | null = null;

export function getAssetMaterializer(): AssetMaterializer {
  return (singleton ??= new AssetMaterializer());
}

export function __resetAssetMaterializerForTests(): void {
  singleton = null;
  sessionBytes.clear();
  trackedDownloads.clear();
  __resetAssetDownloadCapabilitiesForTests();
}

export function __setAssetMaterializerForTests(
  materializer: AssetMaterializer,
): void {
  singleton = materializer;
}

function isMaterializeAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError') return true;
  if ((error as { code?: string }).code === 'ABORT_ERR') return true;
  if (error instanceof AssetsError && error.status === 499) return true;
  return false;
}

function inflightKey(req: MaterializeRequest): string {
  // Concurrent calls for the same (assetId, scope, scopeId, role)
  // coalesce. clientRequestId/sessionId/reason intentionally excluded so
  // a drop-on-timeline and an agent transcode on the same project
  // share one fetch.
  return [req.assetId, req.scope, req.scopeId, req.role ?? 'asset'].join('|');
}

function downloadTrackingKey(asset: Asset, req: MaterializeRequest): string {
  const useKey = req.sessionId
    ? `session:${req.sessionId}`
    : `scope:${req.scope}:${req.scopeId}`;
  const itemKey =
    asset.connectionId && asset.sourceId
      ? `${asset.source}:${asset.connectionId}:${asset.sourceId}`
      : asset.id;
  return `${useKey}:${itemKey}`;
}

function proxyPresetsFor(
  asset: Asset,
  req: MaterializeRequest,
  db: Database.Database,
): ProxyPreset[] {
  const requested =
    req.proxies !== undefined ? req.proxies : defaultProxyPresets(asset, req);
  return [...new Set(requested)].filter((preset) =>
    shouldQueueProxy(asset, preset, db),
  );
}

function defaultProxyPresets(
  asset: Asset,
  req: MaterializeRequest,
): ProxyPreset[] {
  if (req.reason === 'video_attach') return ['edit_1080p'];
  if (req.reason === 'design_attach' && asset.kind === 'image') {
    return ['design_2k'];
  }
  return [];
}

function artifactKindsFor(
  asset: Asset,
  req: MaterializeRequest,
): PreviewArtifactKind[] {
  if (req.reason === 'video_attach' || req.reason === 'preview') {
    if (asset.kind === 'video') return ['filmstrip'];
    if (asset.kind === 'audio') return ['waveform'];
  }
  if (
    (req.reason === 'design_attach' || req.reason === 'preview') &&
    asset.kind === 'pdf'
  ) {
    return ['poster'];
  }
  return [];
}

function shouldQueueProxy(
  asset: Asset,
  preset: ProxyPreset,
  db: Database.Database,
): boolean {
  if (preset === 'web_720p') return asset.kind === 'video';
  if (preset === 'audio_mp3') {
    return asset.kind === 'audio' && asset.mime !== 'audio/mpeg';
  }
  if (preset === 'design_2k') {
    return asset.kind === 'image' && (asset.width ?? 0) > 2048;
  }
  if (asset.kind !== 'video') return false;
  const thresholds = readProxyThresholds(db);
  const pixelCount = (asset.width ?? 0) * (asset.height ?? 0);
  return (
    pixelCount >= thresholds.minPixelCount ||
    (asset.durationMs ?? 0) >= thresholds.minDurationSeconds * 1000 ||
    asset.bytes >= thresholds.minBytes
  );
}

function readProxyThresholds(db: Database.Database): {
  minPixelCount: number;
  minDurationSeconds: number;
  minBytes: number;
} {
  const fallback = {
    minPixelCount: 8_294_400,
    minDurationSeconds: 600,
    minBytes: 524_288_000,
  };
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('assets.proxy_thresholds_json') as { value: string } | undefined;
  if (!row?.value) return fallback;
  try {
    const parsed = JSON.parse(row.value) as Partial<typeof fallback>;
    return {
      minPixelCount: finiteNumber(parsed.minPixelCount, fallback.minPixelCount),
      minDurationSeconds: finiteNumber(
        parsed.minDurationSeconds,
        fallback.minDurationSeconds,
      ),
      minBytes: finiteNumber(parsed.minBytes, fallback.minBytes),
    };
  } catch {
    return fallback;
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function derivativeJobMatches(
  raw: string,
  kind: 'proxy' | 'artifact',
  contentHash: string,
  variant: string,
  req: MaterializeRequest,
): boolean {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.contentHash !== contentHash) return false;
    if (parsed.scope !== req.scope || parsed.scopeId !== req.scopeId) {
      return false;
    }
    return kind === 'proxy'
      ? parsed.preset === variant
      : (parsed.artifactKind ?? parsed.kind) === variant;
  } catch {
    return false;
  }
}
