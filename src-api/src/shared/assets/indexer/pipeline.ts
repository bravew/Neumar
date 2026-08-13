import fs from 'node:fs/promises';

import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import { createLogger } from '@/shared/utils/logger';

import { AssetArtifactEngine } from '../artifact-engine';
import { AssetEmbeddingService } from '../embedding';
import {
  emitArtifactComplete,
  emitArtifactError,
  emitProxyComplete,
  emitProxyError,
} from '../materializer-events';
import { assetUrls } from '../materializer-helpers';
import {
  PREVIEW_ARTIFACT_KINDS,
  PROXY_PRESETS,
  type PreviewArtifactKind,
  type ProxyPreset,
} from '../materializer-types';
import { AssetProxyEngine } from '../proxy-engine';
import { AssetRegistry } from '../registry';
import type { Asset, AssetJob } from '../types';
import { getAssetsWorkspaceRoot } from '../workspace';
import { computeSha256 } from './hashing';
import { probeAssetFile } from './probe';
import { extractIndexableText } from './text-extract';
import { generateAssetDerivatives } from './thumbs';

const logger = createLogger('Assets/Indexer');
const REENCODE_BATCH_SIZE = 100;

interface AssetIndexerOptions {
  db?: Database.Database;
  embedding?: AssetEmbeddingService;
  getWorkspaceRoot?: () => string;
  registry?: AssetRegistry;
  proxyEngine?: AssetProxyEngine;
  artifactEngine?: AssetArtifactEngine;
}

export class AssetIndexer {
  private readonly db: Database.Database;
  private readonly embedding: AssetEmbeddingService;
  private readonly getWorkspaceRoot: () => string;
  private readonly registry: AssetRegistry;
  private readonly proxyEngine: AssetProxyEngine;
  private readonly artifactEngine: AssetArtifactEngine;

  constructor(options: AssetIndexerOptions = {}) {
    this.db = options.db ?? getDatabase();
    this.embedding =
      options.embedding ?? new AssetEmbeddingService({ db: this.db });
    this.getWorkspaceRoot = options.getWorkspaceRoot ?? getAssetsWorkspaceRoot;
    this.registry =
      options.registry ??
      new AssetRegistry({
        db: this.db,
        getWorkspaceRoot: this.getWorkspaceRoot,
      });
    this.proxyEngine =
      options.proxyEngine ??
      new AssetProxyEngine({
        db: this.db,
        registry: this.registry,
        getWorkspaceRoot: this.getWorkspaceRoot,
      });
    this.artifactEngine =
      options.artifactEngine ??
      new AssetArtifactEngine({
        db: this.db,
        registry: this.registry,
        getWorkspaceRoot: this.getWorkspaceRoot,
      });
  }

  async runJob(job: AssetJob): Promise<Record<string, unknown>> {
    if (job.kind === 'proxy') return this.runProxyJob(job);
    if (job.kind === 'artifact') return this.runArtifactJob(job);
    if (job.kind === 'reencode') {
      const modality =
        job.payload.modality === 'image' || job.payload.modality === 'text'
          ? job.payload.modality
          : null;
      if (!modality)
        throw new Error('Reencode job payload is missing modality');
      return this.reencodeAssets(modality, { jobId: job.id });
    }
    if (job.kind !== 'ingest' && job.kind !== 'thumb' && job.kind !== 'embed') {
      return { skipped: true, kind: job.kind };
    }
    const assetId =
      typeof job.payload.assetId === 'string' ? job.payload.assetId : null;
    if (!assetId) throw new Error('Asset job payload is missing assetId');
    return this.processAsset(assetId, { jobId: job.id });
  }

  private async runProxyJob(job: AssetJob): Promise<Record<string, unknown>> {
    const payload = parseProxyJobPayload(job);
    await this.throwIfCancelled(job.id);
    try {
      const result = await this.proxyEngine.generate(payload);
      await this.throwIfCancelled(job.id);
      if (result.path) {
        emitProxyComplete({
          assetId: payload.assetId,
          scope: payload.scope,
          scopeId: payload.scopeId,
          sessionId: payload.sessionId,
          preset: payload.preset,
          url: assetUrls(payload.assetId).proxy?.[payload.preset] ?? '',
        });
      }
      return {
        assetId: payload.assetId,
        contentHash: payload.contentHash,
        preset: payload.preset,
        generated: result.generated,
        skippedReason: result.skippedReason,
        path: result.path,
        bytes: result.bytes,
      };
    } catch (error) {
      emitProxyError(payload, error);
      throw error;
    }
  }

  private async runArtifactJob(
    job: AssetJob,
  ): Promise<Record<string, unknown>> {
    const payload = parseArtifactJobPayload(job);
    await this.throwIfCancelled(job.id);
    try {
      const result = await this.artifactEngine.generate(payload);
      await this.throwIfCancelled(job.id);
      if (result.path) {
        emitArtifactComplete({
          assetId: payload.assetId,
          scope: payload.scope,
          scopeId: payload.scopeId,
          sessionId: payload.sessionId,
          kind: payload.kind,
          url: artifactUrl(payload.assetId, payload.kind),
        });
      }
      return {
        assetId: payload.assetId,
        contentHash: payload.contentHash,
        kind: payload.kind,
        generated: result.generated,
        skippedReason: result.skippedReason,
        path: result.path,
        bytes: result.bytes,
      };
    } catch (error) {
      emitArtifactError(payload, error);
      throw error;
    }
  }

  async processAsset(
    assetId: string,
    options: { jobId?: string } = {},
  ): Promise<Record<string, unknown>> {
    this.markAssetProbing(assetId);
    try {
      await this.throwIfCancelled(options.jobId);
      const asset = this.registry.get(assetId);
      if (!asset) throw new Error('Asset not found');
      const { absolutePath } = this.registry.storagePathFor(asset.id);
      const workspaceRoot = await realWorkspaceRoot(this.getWorkspaceRoot());

      const [probe, contentHash, extractedText] = await Promise.all([
        probeAssetFile(asset, absolutePath, workspaceRoot),
        computeSha256(absolutePath),
        extractIndexableText(asset, absolutePath),
      ]);
      await this.throwIfCancelled(options.jobId);

      let derivatives: { thumbPath?: string; previewPath?: string } = {};
      try {
        derivatives = await generateAssetDerivatives({
          asset: { ...asset, durationMs: probe.durationMs ?? asset.durationMs },
          filePath: absolutePath,
          workspaceRoot,
        });
      } catch (error) {
        logger.warn('assets.indexer.derivative_failed', {
          asset_id: asset.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await this.throwIfCancelled(options.jobId);

      this.markAssetEmbedded(asset, {
        bytes: probe.bytes,
        width: probe.width,
        height: probe.height,
        durationMs: probe.durationMs,
        contentHash,
        thumbPath: derivatives.thumbPath,
        previewPath: derivatives.previewPath,
        extractedText,
        exif: probe.exif,
      });
      const indexedAsset = this.registry.get(asset.id);
      const embedding = indexedAsset
        ? await this.embedAssetBestEffort(indexedAsset, absolutePath)
        : { embedded: 0, skipped: [] };
      return {
        assetId: asset.id,
        bytes: probe.bytes,
        thumbPath: derivatives.thumbPath,
        previewPath: derivatives.previewPath,
        textExtracted: Boolean(extractedText),
        embeddings: embedding,
      };
    } catch (error) {
      this.markAssetFailed(assetId, error);
      throw error;
    }
  }

  private async reencodeAssets(
    modality: 'text' | 'image',
    options: { jobId?: string },
  ): Promise<Record<string, unknown>> {
    let embedded = 0;
    let skipped = 0;
    let assets = 0;
    let offset = 0;

    for (;;) {
      const rows = this.db
        .prepare(
          `SELECT id FROM assets
           WHERE deleted_at IS NULL
             AND index_state = 'embedded'
           ORDER BY modified_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(REENCODE_BATCH_SIZE, offset) as { id: string }[];
      if (rows.length === 0) break;
      assets += rows.length;
      offset += rows.length;

      for (const row of rows) {
        await this.throwIfCancelled(options.jobId);
        const asset = this.registry.get(row.id);
        if (!asset) continue;
        let filePath: string | undefined;
        if (asset.storagePath) {
          try {
            filePath = this.registry.storagePathFor(asset.id).absolutePath;
          } catch {
            filePath = undefined;
          }
        }
        const result = await this.embedAssetBestEffort(asset, filePath);
        embedded += result.embedded;
        skipped += result.skipped.filter(
          (item) => item.modality === modality,
        ).length;
      }
    }
    this.embedding.markReencodeIdle(modality);
    return { modality, assets, embedded, skipped };
  }

  private async embedAssetBestEffort(
    asset: Asset,
    filePath?: string,
  ): Promise<{
    embedded: number;
    skipped: Array<{ modality: string; reason: string }>;
  }> {
    try {
      return await this.embedding.embedAsset(asset, filePath);
    } catch (error) {
      logger.warn('assets.indexer.embedding_failed', {
        asset_id: asset.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        embedded: 0,
        skipped: [{ modality: 'text', reason: 'embedding_failed' }],
      };
    }
  }

  private markAssetProbing(assetId: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE assets
         SET index_state = 'probing', index_error = NULL, modified_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(now, assetId);
  }

  private markAssetEmbedded(
    asset: Asset,
    patch: {
      bytes: number;
      width?: number;
      height?: number;
      durationMs?: number;
      contentHash: string;
      thumbPath?: string;
      previewPath?: string;
      extractedText: string | null;
      exif?: Record<string, unknown>;
    },
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE assets
         SET bytes = ?,
             width = ?,
             height = ?,
             duration_ms = ?,
             content_hash = ?,
             thumb_path = COALESCE(?, thumb_path),
             preview_path = COALESCE(?, preview_path),
             ocr_text = COALESCE(?, ocr_text),
             exif_json = ?,
             index_state = 'embedded',
             index_error = NULL,
             modified_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(
        patch.bytes,
        patch.width ?? asset.width,
        patch.height ?? asset.height,
        patch.durationMs ?? asset.durationMs,
        patch.contentHash,
        patch.thumbPath ?? null,
        patch.previewPath ?? null,
        patch.extractedText,
        stringifyMergedExif(asset.exif, patch.exif),
        now,
        asset.id,
      );
    this.registry.refreshSearchIndex(asset.id);
  }

  private markAssetFailed(assetId: string, error: unknown): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE assets
         SET index_state = 'failed', index_error = ?, modified_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(
        error instanceof Error ? error.message : String(error),
        now,
        assetId,
      );
  }

  private async throwIfCancelled(jobId: string | undefined): Promise<void> {
    if (!jobId) return;
    const row = this.db
      .prepare(`SELECT status, cancelled_at FROM asset_jobs WHERE id = ?`)
      .get(jobId) as
      | { status: string; cancelled_at: number | null }
      | undefined;
    if (row?.status === 'cancelled' || row?.cancelled_at) {
      throw new Error('Asset job cancelled');
    }
  }
}

export function createAssetIndexer(
  options: AssetIndexerOptions = {},
): AssetIndexer {
  return new AssetIndexer(options);
}

export async function runAssetIndexJob(
  job: AssetJob,
): Promise<Record<string, unknown>> {
  return new AssetIndexer().runJob(job);
}

async function realWorkspaceRoot(workspaceRoot: string): Promise<string> {
  return fs.realpath(workspaceRoot).catch(() => workspaceRoot);
}

function stringifyMergedExif(
  current: unknown,
  patch: Record<string, unknown> | undefined,
): string | null {
  if (!patch) return current === null ? null : JSON.stringify(current);
  const currentObject =
    current && typeof current === 'object'
      ? (current as Record<string, unknown>)
      : {};
  return JSON.stringify({ ...currentObject, ...patch });
}

interface DerivativeJobPayloadBase {
  assetId: string;
  contentHash: string;
  scope: string;
  scopeId: string;
  sessionId?: string;
}

interface ProxyJobPayload extends DerivativeJobPayloadBase {
  preset: ProxyPreset;
}

interface ArtifactJobPayload extends DerivativeJobPayloadBase {
  kind: PreviewArtifactKind;
}

function parseProxyJobPayload(job: AssetJob): ProxyJobPayload {
  const base = parseDerivativeJobBase(job);
  const preset = job.payload.preset;
  if (!isProxyPreset(preset)) {
    throw new Error('Proxy job payload is missing preset');
  }
  return { ...base, preset };
}

function parseArtifactJobPayload(job: AssetJob): ArtifactJobPayload {
  const base = parseDerivativeJobBase(job);
  const kind = job.payload.artifactKind ?? job.payload.kind;
  if (!isPreviewArtifactKind(kind)) {
    throw new Error('Artifact job payload is missing kind');
  }
  return { ...base, kind };
}

function parseDerivativeJobBase(job: AssetJob): DerivativeJobPayloadBase {
  const assetId = stringPayload(job.payload.assetId);
  const contentHash = stringPayload(job.payload.contentHash);
  const scope = stringPayload(job.payload.scope);
  const scopeId = stringPayload(job.payload.scopeId);
  if (!assetId || !contentHash || !scope || !scopeId) {
    throw new Error('Derivative job payload is incomplete');
  }
  const sessionId = stringPayload(job.payload.sessionId);
  return sessionId
    ? { assetId, contentHash, scope, scopeId, sessionId }
    : { assetId, contentHash, scope, scopeId };
}

function stringPayload(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isProxyPreset(value: unknown): value is ProxyPreset {
  return (
    typeof value === 'string' && PROXY_PRESETS.includes(value as ProxyPreset)
  );
}

function isPreviewArtifactKind(value: unknown): value is PreviewArtifactKind {
  return (
    typeof value === 'string' &&
    PREVIEW_ARTIFACT_KINDS.includes(value as PreviewArtifactKind)
  );
}

function artifactUrl(assetId: string, kind: PreviewArtifactKind): string {
  const urls = assetUrls(assetId);
  if (kind === 'filmstrip') return urls.filmstrip ?? '';
  if (kind === 'waveform') return urls.waveform ?? '';
  return urls.poster ?? '';
}
