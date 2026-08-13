import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import { mimeFromExtension } from '@/shared/utils/mime-extension';

import { computeSha256 } from './indexer/hashing';
import type { PreviewArtifactKind, ProxyPreset } from './materializer-types';
import type {
  Asset,
  AssetAttachment,
  AssetIndexState,
  AssetKind,
  AssetQuery,
  AssetSource,
  AttachmentScope,
  IngestInput,
  Page,
  RemoteAssetInput,
} from './types';
import {
  getAssetsWorkspaceRoot,
  resolveWorkspaceStoragePath,
} from './workspace';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
export const DEFAULT_ASSET_GC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_GC_LIMIT = 200;
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'log',
]);
const DOC_EXTENSIONS = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']);

type SqlValue = string | number | null;

interface AssetRow {
  id: string;
  source: string;
  connection_id: string | null;
  source_id: string | null;
  client_request_id: string | null;
  kind: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  content_hash: string | null;
  perceptual_hash: string | null;
  title: string | null;
  description: string | null;
  caption: string | null;
  ocr_text: string | null;
  transcript: string | null;
  storage_path: string | null;
  thumb_path: string | null;
  preview_path: string | null;
  captured_at: number | null;
  imported_at: number;
  modified_at: number;
  deleted_at: number | null;
  provenance_json: string | null;
  exif_json: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  index_state: string;
  index_error: string | null;
}

interface AttachmentRow {
  scope: string;
  scope_id: string;
  role: string | null;
  attached_at: number;
}

interface ContentHashRow {
  content_hash: string | null;
}

interface GeneratedDerivativeRow {
  path: string;
}

interface ExistingAssetMatch {
  id: string;
  deletedAt: number | null;
}

interface RegistryOptions {
  db?: Database.Database;
  getWorkspaceRoot?: () => string;
}

export interface AssetStorageStats {
  totalCount: number;
  activeCount: number;
  deletedCount: number;
  totalBytes: number;
  localBytes: number;
  remoteBytes: number;
  deletedBytes: number;
  cacheBytes: number;
  materializedBytes: number;
  proxyBytes: number;
  previewArtifactBytes: number;
  managedBytes: number;
  materializedBytesByScope: AssetStorageScopeUsage[];
}

export interface AssetStorageScopeUsage {
  scope: string;
  materializedBytes: number;
  materializationCount: number;
  projectCount: number;
}

export interface AssetGarbageCollectOptions {
  retentionMs?: number;
  now?: number;
  limit?: number;
}

export interface AssetGarbageCollectResult {
  scanned: number;
  purged: number;
  skippedAttached: number;
  bytesFreed: number;
  filesDeleted: number;
  errors: Array<{ assetId: string; message: string }>;
}

interface DeletedAssetGcRow {
  id: string;
  storage_path: string | null;
  thumb_path: string | null;
  preview_path: string | null;
  bytes: number;
  attachment_count: number;
}

export class AssetsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'AssetsError';
  }
}

export class AssetRegistry {
  private readonly db: Database.Database;
  private readonly getWorkspaceRoot: () => string;

  constructor(options: RegistryOptions = {}) {
    this.db = options.db ?? getDatabase();
    this.getWorkspaceRoot = options.getWorkspaceRoot ?? getAssetsWorkspaceRoot;
  }

  async ingest(
    input: IngestInput,
  ): Promise<{ asset: Asset; created: boolean }> {
    if (!input.storagePath) {
      throw new AssetsError(
        'storagePath is required for catalog ingestion',
        400,
      );
    }

    const workspaceRoot = await realWorkspaceRoot(this.getWorkspaceRoot());
    const resolved = safeResolveStoragePath(input.storagePath, workspaceRoot);
    const realPath = await fs.promises
      .realpath(resolved.absolutePath)
      .catch(() => null);
    if (!realPath) {
      throw new AssetsError('Asset file does not exist', 404);
    }
    const realResolved = safeResolveStoragePath(realPath, workspaceRoot);
    const stat = await fs.promises
      .stat(realResolved.absolutePath)
      .catch(() => null);
    if (!stat?.isFile()) {
      throw new AssetsError('Asset file does not exist', 404);
    }

    const contentHash = await computeSha256(realResolved.absolutePath);
    const existing = this.findExisting(input, contentHash);
    if (existing) {
      if (existing.deletedAt !== null) {
        this.restoreDeletedExisting(existing.id, input.hint?.tags ?? []);
      }
      if (input.hint?.tags?.length) {
        this.tag(existing.id, input.hint.tags);
      }
      return { asset: this.getExisting(existing.id), created: false };
    }

    const now = Date.now();
    const id = randomUUID();
    const mime =
      input.hint?.mime ??
      mimeFromExtension(path.extname(resolved.absolutePath)) ??
      'application/octet-stream';
    const kind = input.hint?.kind ?? inferKind(mime, realResolved.absolutePath);
    const title = input.hint?.title ?? path.basename(realResolved.absolutePath);
    const insert = this.db.prepare(`
      INSERT INTO assets (
        id, source, connection_id, source_id, client_request_id, kind, mime,
        bytes, width, height, duration_ms, content_hash, title, description,
        caption, ocr_text, transcript, storage_path, captured_at, imported_at,
        modified_at, provenance_json, exif_json, index_state
      )
      VALUES (
        @id, @source, @connectionId, @sourceId, @clientRequestId, @kind, @mime,
        @bytes, @width, @height, @durationMs, @contentHash, @title,
        @description, @caption, @ocrText, @transcript, @storagePath,
        @capturedAt, @importedAt, @modifiedAt, @provenanceJson, @exifJson,
        'pending'
      )
    `);

    const writeAsset = this.db.transaction(() => {
      insert.run({
        id,
        source: input.source,
        connectionId: input.connectionId ?? null,
        sourceId: input.sourceId ?? null,
        clientRequestId: input.clientRequestId ?? null,
        kind,
        mime,
        bytes: input.hint?.bytes ?? stat.size,
        width: input.hint?.width ?? null,
        height: input.hint?.height ?? null,
        durationMs: input.hint?.durationMs ?? null,
        contentHash,
        title,
        description: input.hint?.description ?? null,
        caption: input.hint?.caption ?? null,
        ocrText: input.hint?.ocrText ?? null,
        transcript: input.hint?.transcript ?? null,
        storagePath: realResolved.relativePath,
        capturedAt: input.hint?.capturedAt ?? null,
        importedAt: now,
        modifiedAt: now,
        provenanceJson: stringifyJson(input.hint?.provenance),
        exifJson: stringifyJson(input.hint?.exif),
      });
      this.replaceTags(id, input.hint?.tags ?? []);
      this.upsertFts(id);
      this.enqueueJob('ingest', { assetId: id });
    });

    try {
      writeAsset();
    } catch (error) {
      const raced = this.findExisting(input, contentHash);
      if (raced) return { asset: this.getExisting(raced.id), created: false };
      throw error;
    }

    return { asset: this.getExisting(id), created: true };
  }

  upsertRemote(input: RemoteAssetInput): { asset: Asset; created: boolean } {
    if (!input.connectionId || !input.sourceId) {
      throw new AssetsError(
        'connectionId and sourceId are required for remote catalog assets',
        400,
      );
    }

    const existing = this.db
      .prepare(
        `SELECT id, imported_at
         FROM assets
         WHERE source = ? AND connection_id = ? AND source_id = ?`,
      )
      .get(input.source, input.connectionId, input.sourceId) as
      | { id: string; imported_at: number }
      | undefined;
    const now = Date.now();
    const id = existing?.id ?? randomUUID();
    const modifiedAt = input.modifiedAt ?? now;
    const importedAt = existing?.imported_at ?? now;

    const writeAsset = this.db.transaction(() => {
      if (existing) {
        this.db
          .prepare(
            `UPDATE assets
             SET kind = @kind,
                 mime = @mime,
                 bytes = @bytes,
                 width = @width,
                 height = @height,
                 duration_ms = @durationMs,
                 content_hash = @contentHash,
                 title = @title,
                 description = @description,
                 caption = @caption,
                 ocr_text = @ocrText,
                 transcript = @transcript,
                 storage_path = NULL,
                 captured_at = @capturedAt,
                 modified_at = @modifiedAt,
                 deleted_at = NULL,
                 provenance_json = @provenanceJson,
                 exif_json = @exifJson,
                 gps_lat = @gpsLat,
                 gps_lng = @gpsLng,
                 index_state = 'embedded',
                 index_error = NULL
             WHERE id = @id`,
          )
          .run(remoteParams(id, importedAt, modifiedAt, input));
      } else {
        this.db
          .prepare(
            `INSERT INTO assets (
              id, source, connection_id, source_id, client_request_id, kind,
              mime, bytes, width, height, duration_ms, content_hash, title,
              description, caption, ocr_text, transcript, storage_path,
              captured_at, imported_at, modified_at, provenance_json,
              exif_json, gps_lat, gps_lng, index_state
            )
            VALUES (
              @id, @source, @connectionId, @sourceId, NULL, @kind, @mime,
              @bytes, @width, @height, @durationMs, @contentHash, @title,
              @description, @caption, @ocrText, @transcript, NULL,
              @capturedAt, @importedAt, @modifiedAt, @provenanceJson,
              @exifJson, @gpsLat, @gpsLng, 'embedded'
            )`,
          )
          .run(remoteParams(id, importedAt, modifiedAt, input));
      }
      this.replaceTags(id, input.tags ?? []);
      this.upsertFts(id);
    });

    writeAsset();
    return { asset: this.getExisting(id), created: !existing };
  }

  get(id: string): Asset | null {
    const row = this.db
      .prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL')
      .get(id) as AssetRow | undefined;
    return row ? this.rowToAsset(row) : null;
  }

  list(query: AssetQuery = {}): Page<Asset> {
    const limit = clampLimit(query.limit);
    const offset = decodeCursor(query.cursor);
    const { whereSql, params } = this.buildWhere(query);
    const rows = this.db
      .prepare(
        `SELECT * FROM assets
         WHERE ${whereSql}
         ORDER BY COALESCE(captured_at, imported_at) DESC, id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit + 1, offset) as AssetRow[];
    const visibleRows = rows.slice(0, limit);
    return {
      items: visibleRows.map((row) => this.rowToAsset(row)),
      nextCursor:
        rows.length > limit ? encodeCursor(offset + visibleRows.length) : null,
    };
  }

  update(
    id: string,
    patch: { title?: string | null; description?: string | null },
  ): Asset {
    const current = this.get(id);
    if (!current) throw new AssetsError('Asset not found', 404);
    const nextTitle = patch.title === undefined ? current.title : patch.title;
    const nextDescription =
      patch.description === undefined ? current.description : patch.description;
    this.db
      .prepare(
        `UPDATE assets
         SET title = ?, description = ?, modified_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(nextTitle, nextDescription, Date.now(), id);
    this.upsertFts(id);
    return this.getExisting(id);
  }

  softDelete(id: string): void {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE assets
         SET deleted_at = ?, modified_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(now, now, id);
    if (result.changes === 0) throw new AssetsError('Asset not found', 404);
    this.deleteFts(id);
    this.deleteEmbeddings(id);
  }

  softDeleteRemote(
    source: AssetSource,
    connectionId: string,
    sourceId: string,
  ): boolean {
    const row = this.db
      .prepare(
        `SELECT id FROM assets
         WHERE source = ? AND connection_id = ? AND source_id = ?
           AND deleted_at IS NULL`,
      )
      .get(source, connectionId, sourceId) as { id: string } | undefined;
    if (!row) return false;
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE assets
         SET deleted_at = ?, modified_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(now, now, row.id);
    this.deleteFts(row.id);
    this.deleteEmbeddings(row.id);
    return true;
  }

  storageStats(): AssetStorageStats {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS totalCount,
           COALESCE(SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS activeCount,
           COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS deletedCount,
           COALESCE(SUM(CASE WHEN deleted_at IS NULL THEN bytes ELSE 0 END), 0) AS totalBytes,
           COALESCE(SUM(CASE WHEN deleted_at IS NULL AND storage_path IS NOT NULL THEN bytes ELSE 0 END), 0) AS localBytes,
           COALESCE(SUM(CASE WHEN deleted_at IS NULL AND storage_path IS NULL THEN bytes ELSE 0 END), 0) AS remoteBytes,
           COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN bytes ELSE 0 END), 0) AS deletedBytes
         FROM assets`,
      )
      .get() as {
      totalCount: number;
      activeCount: number;
      deletedCount: number;
      totalBytes: number;
      localBytes: number;
      remoteBytes: number;
      deletedBytes: number;
    };
    const cacheBytes = this.sumTableBytes('asset_cache');
    const materializedBytes = this.sumTableBytes('asset_materializations');
    const proxyBytes = this.sumTableBytes('asset_proxies');
    const previewArtifactBytes = this.sumTableBytes('asset_preview_artifacts');
    const materializedBytesByScope = this.materializedBytesByScope();
    return {
      ...row,
      cacheBytes,
      materializedBytes,
      proxyBytes,
      previewArtifactBytes,
      materializedBytesByScope,
      managedBytes:
        row.localBytes +
        cacheBytes +
        materializedBytes +
        proxyBytes +
        previewArtifactBytes,
    };
  }

  garbageCollectDeleted(
    options: AssetGarbageCollectOptions = {},
  ): AssetGarbageCollectResult {
    const retentionMs = options.retentionMs ?? DEFAULT_ASSET_GC_RETENTION_MS;
    const cutoff = (options.now ?? Date.now()) - Math.max(0, retentionMs);
    const limit = Math.min(
      Math.max(Math.trunc(options.limit ?? DEFAULT_GC_LIMIT), 1),
      1000,
    );
    const rows = this.db
      .prepare(
        `SELECT a.id, a.storage_path, a.thumb_path, a.preview_path, a.bytes,
                COUNT(aa.asset_id) AS attachment_count
         FROM assets a
         LEFT JOIN asset_attachments aa ON aa.asset_id = a.id
         WHERE a.deleted_at IS NOT NULL
           AND a.deleted_at <= ?
         GROUP BY a.id
         ORDER BY a.deleted_at ASC, a.id ASC
         LIMIT ?`,
      )
      .all(cutoff, limit) as DeletedAssetGcRow[];

    const workspaceRoot = realWorkspaceRootSync(this.getWorkspaceRoot());
    const result: AssetGarbageCollectResult = {
      scanned: rows.length,
      purged: 0,
      skippedAttached: 0,
      bytesFreed: 0,
      filesDeleted: 0,
      errors: [],
    };

    for (const row of rows) {
      if (row.attachment_count > 0) {
        result.skippedAttached += 1;
        continue;
      }
      try {
        result.filesDeleted += this.removeDeletedAssetFiles(row, workspaceRoot);
        this.purgeDeletedAssetRow(row.id);
        result.purged += 1;
        result.bytesFreed += row.bytes;
      } catch (error) {
        result.errors.push({
          assetId: row.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  tag(assetId: string, tags: string[]): void {
    this.ensureAsset(assetId);
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?, ?)`,
    );
    const tx = this.db.transaction(() => {
      for (const tag of normalizeTags(tags)) insert.run(assetId, tag);
      this.upsertFts(assetId);
    });
    tx();
  }

  untag(assetId: string, tags: string[]): void {
    this.ensureAsset(assetId);
    const remove = this.db.prepare(
      `DELETE FROM asset_tags WHERE asset_id = ? AND tag = ?`,
    );
    const tx = this.db.transaction(() => {
      for (const tag of normalizeTags(tags)) remove.run(assetId, tag);
      this.upsertFts(assetId);
    });
    tx();
  }

  attach(assetId: string, scope: AttachmentScope, role?: string): void {
    this.ensureAsset(assetId);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO asset_attachments
         (asset_id, scope, scope_id, role, attached_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(assetId, scope.scope, scope.scopeId, role ?? null, Date.now());
  }

  detach(assetId: string, scope: AttachmentScope): void {
    this.db
      .prepare(
        `DELETE FROM asset_attachments
         WHERE asset_id = ? AND scope = ? AND scope_id = ?`,
      )
      .run(assetId, scope.scope, scope.scopeId);
  }

  storagePathFor(id: string): { absolutePath: string; mime: string } {
    const asset = this.get(id);
    if (!asset) throw new AssetsError('Asset not found', 404);
    if (!asset.storagePath) {
      throw new AssetsError('Asset is not materialized locally', 404);
    }
    const workspaceRoot = realWorkspaceRootSync(this.getWorkspaceRoot());
    const { absolutePath } = safeResolveStoragePath(
      asset.storagePath,
      workspaceRoot,
    );
    let realPath: string;
    try {
      realPath = fs.realpathSync(absolutePath);
    } catch {
      throw new AssetsError('Asset file not found', 404);
    }
    const realResolved = safeResolveStoragePath(realPath, workspaceRoot);
    return { absolutePath: realResolved.absolutePath, mime: asset.mime };
  }

  derivativePathFor(
    id: string,
    variant: 'thumb' | 'preview',
  ): { absolutePath: string; mime: string } {
    const asset = this.get(id);
    if (!asset) throw new AssetsError('Asset not found', 404);
    const storagePath =
      variant === 'thumb' ? asset.thumbPath : asset.previewPath;
    if (!storagePath) {
      throw new AssetsError(`Asset ${variant} is not available`, 404);
    }
    const workspaceRoot = realWorkspaceRootSync(this.getWorkspaceRoot());
    const { absolutePath } = safeResolveStoragePath(storagePath, workspaceRoot);
    let realPath: string;
    try {
      realPath = fs.realpathSync(absolutePath);
    } catch {
      throw new AssetsError(`Asset ${variant} file not found`, 404);
    }
    const realResolved = safeResolveStoragePath(realPath, workspaceRoot);
    return {
      absolutePath: realResolved.absolutePath,
      mime:
        mimeFromExtension(path.extname(realResolved.absolutePath)) ??
        'application/octet-stream',
    };
  }

  proxyPathFor(
    id: string,
    preset: ProxyPreset,
  ): { absolutePath: string; mime: string } {
    const row = this.generatedDerivativeRow(
      id,
      `SELECT proxy_path AS path
       FROM asset_proxies
       WHERE preset = ? AND content_hash IN`,
      [preset],
    );
    const resolved = this.resolveGeneratedDerivativePath(row?.path);
    if (!resolved) throw new AssetsError('Asset proxy is not available', 404);
    this.db
      .prepare(
        `UPDATE asset_proxies
         SET last_used_at = ?
         WHERE preset = ? AND proxy_path = ?`,
      )
      .run(Date.now(), preset, row!.path);
    return {
      absolutePath: resolved.absolutePath,
      mime: mimeForProxyPreset(preset, resolved.absolutePath),
    };
  }

  previewArtifactPathFor(
    id: string,
    kind: PreviewArtifactKind,
  ): { absolutePath: string; mime: string } {
    const row = this.generatedDerivativeRow(
      id,
      `SELECT data_path AS path
       FROM asset_preview_artifacts
       WHERE kind = ? AND content_hash IN`,
      [kind],
    );
    const resolved = this.resolveGeneratedDerivativePath(row?.path);
    if (!resolved) {
      throw new AssetsError('Asset preview artifact is not available', 404);
    }
    return {
      absolutePath: resolved.absolutePath,
      mime: mimeForPreviewArtifact(kind, resolved.absolutePath),
    };
  }

  refreshSearchIndex(id: string): void {
    this.upsertFts(id);
  }

  rowToAsset(row: AssetRow): Asset {
    return {
      id: row.id,
      source: row.source as AssetSource,
      connectionId: row.connection_id,
      sourceId: row.source_id,
      clientRequestId: row.client_request_id,
      kind: row.kind as AssetKind,
      mime: row.mime,
      bytes: row.bytes,
      width: row.width,
      height: row.height,
      durationMs: row.duration_ms,
      contentHash: row.content_hash,
      perceptualHash: row.perceptual_hash,
      title: row.title,
      description: row.description,
      caption: row.caption,
      ocrText: row.ocr_text,
      transcript: row.transcript,
      storagePath: row.storage_path,
      thumbPath: row.thumb_path,
      previewPath: row.preview_path,
      capturedAt: row.captured_at,
      importedAt: row.imported_at,
      modifiedAt: row.modified_at,
      deletedAt: row.deleted_at,
      provenance: parseJson(row.provenance_json),
      exif: parseJson(row.exif_json),
      gpsLat: row.gps_lat,
      gpsLng: row.gps_lng,
      indexState: row.index_state as AssetIndexState,
      indexError: row.index_error,
      tags: this.tagsFor(row.id),
      attachments: this.attachmentsFor(row.id),
    };
  }

  private findExisting(
    input: IngestInput,
    contentHash: string | null,
  ): ExistingAssetMatch | null {
    if (input.clientRequestId) {
      const row = this.db
        .prepare(
          `SELECT id, deleted_at FROM assets
           WHERE client_request_id = ?`,
        )
        .get(input.clientRequestId) as
        | { id: string; deleted_at: number | null }
        | undefined;
      if (row) return { id: row.id, deletedAt: row.deleted_at };
    }

    if (input.sourceId) {
      const row = this.db
        .prepare(
          `SELECT id, deleted_at FROM assets
           WHERE source = ?
             AND COALESCE(connection_id, '') = COALESCE(?, '')
             AND source_id = ?`,
        )
        .get(input.source, input.connectionId ?? null, input.sourceId) as
        | { id: string; deleted_at: number | null }
        | undefined;
      if (row) return { id: row.id, deletedAt: row.deleted_at };
    }

    if (input.source === 'local_fs' && !input.sourceId && contentHash) {
      const row = this.db
        .prepare(
          `SELECT id, deleted_at FROM assets
           WHERE source = 'local_fs'
             AND source_id IS NULL
             AND content_hash = ?`,
        )
        .get(contentHash) as
        | { id: string; deleted_at: number | null }
        | undefined;
      if (row) return { id: row.id, deletedAt: row.deleted_at };
    }

    return null;
  }

  private restoreDeletedExisting(assetId: string, tags: string[]): void {
    const now = Date.now();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE assets
           SET deleted_at = NULL,
               modified_at = ?,
               index_state = 'pending',
               index_error = NULL
           WHERE id = ?`,
        )
        .run(now, assetId);
      if (tags.length) this.replaceTags(assetId, tags);
      this.upsertFts(assetId);
      this.enqueueJob('ingest', { assetId });
    });
    tx();
  }

  private getExisting(id: string): Asset {
    const asset = this.get(id);
    if (!asset) throw new AssetsError('Asset not found after write', 500);
    return asset;
  }

  private ensureAsset(id: string): void {
    if (!this.get(id)) throw new AssetsError('Asset not found', 404);
  }

  private buildWhere(query: AssetQuery): {
    whereSql: string;
    params: SqlValue[];
  } {
    const clauses = ['deleted_at IS NULL'];
    const params: SqlValue[] = [];

    if (query.modalities?.length) {
      clauses.push(`kind IN (${placeholders(query.modalities.length)})`);
      params.push(...query.modalities);
    }
    if (query.sources?.length) {
      clauses.push(`source IN (${placeholders(query.sources.length)})`);
      params.push(...query.sources);
    }
    if (query.dateRange?.fromMs !== undefined) {
      clauses.push('COALESCE(captured_at, imported_at) >= ?');
      params.push(query.dateRange.fromMs);
    }
    if (query.dateRange?.toMs !== undefined) {
      clauses.push('COALESCE(captured_at, imported_at) <= ?');
      params.push(query.dateRange.toMs);
    }
    if (query.collectionId) {
      clauses.push(
        `EXISTS (
          SELECT 1 FROM asset_collection_items aci
          WHERE aci.asset_id = assets.id AND aci.collection_id = ?
        )`,
      );
      params.push(query.collectionId);
    }
    if (query.attachedTo) {
      clauses.push(
        `EXISTS (
          SELECT 1 FROM asset_attachments aa
          WHERE aa.asset_id = assets.id AND aa.scope = ? AND aa.scope_id = ?
        )`,
      );
      params.push(query.attachedTo.scope, query.attachedTo.scopeId);
    }
    for (const tag of normalizeTags(query.tags ?? [])) {
      clauses.push(
        `EXISTS (
          SELECT 1 FROM asset_tags at
          WHERE at.asset_id = assets.id AND at.tag = ?
        )`,
      );
      params.push(tag);
    }

    return { whereSql: clauses.join(' AND '), params };
  }

  private replaceTags(assetId: string, tags: string[]): void {
    this.db.prepare('DELETE FROM asset_tags WHERE asset_id = ?').run(assetId);
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?, ?)`,
    );
    for (const tag of normalizeTags(tags)) insert.run(assetId, tag);
  }

  private upsertFts(assetId: string): void {
    const row = this.db
      .prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL')
      .get(assetId) as AssetRow | undefined;
    this.deleteFts(assetId);
    if (!row) return;
    this.db
      .prepare(
        `INSERT INTO assets_fts
         (asset_id, title, description, caption, ocr_text, transcript, tag_blob)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.title ?? '',
        row.description ?? '',
        row.caption ?? '',
        row.ocr_text ?? '',
        row.transcript ?? '',
        this.tagsFor(row.id).join(' '),
      );
  }

  private deleteFts(assetId: string): void {
    this.db.prepare('DELETE FROM assets_fts WHERE asset_id = ?').run(assetId);
  }

  private deleteEmbeddings(assetId: string): void {
    const rows = this.db
      .prepare('SELECT id FROM asset_embeddings WHERE asset_id = ?')
      .all(assetId) as Array<{ id: number }>;
    for (const row of rows) {
      try {
        this.db
          .prepare('DELETE FROM assets_vec_768 WHERE rowid = ?')
          .run(row.id);
      } catch {
        // sqlite-vec is optional; metadata cleanup still keeps the catalog sane.
      }
    }
    this.db
      .prepare('DELETE FROM asset_embeddings WHERE asset_id = ?')
      .run(assetId);
  }

  private removeDeletedAssetFiles(
    row: DeletedAssetGcRow,
    workspaceRoot: string,
  ): number {
    // Only delete asset-managed derivatives (thumbnails, previews, and the
    // per-asset .cache/assets/<id> directory). Never delete `storage_path`:
    // for local_fs/ai_gen sources it points at the user's original in-place
    // file, so purging a catalog row must not destroy the user's own data.
    const paths = new Set(
      [row.thumb_path, row.preview_path].filter((value): value is string =>
        Boolean(value),
      ),
    );
    paths.add(path.join('.cache', 'assets', row.id));
    let deleted = 0;
    for (const storagePath of paths) {
      const { absolutePath } = resolveWorkspaceStoragePath(
        storagePath,
        workspaceRoot,
      );
      if (!fs.existsSync(absolutePath)) continue;
      const stat = fs.statSync(absolutePath);
      fs.rmSync(absolutePath, {
        recursive: stat.isDirectory(),
        force: true,
      });
      deleted += 1;
    }
    return deleted;
  }

  private purgeDeletedAssetRow(assetId: string): void {
    const tx = this.db.transaction(() => {
      this.deleteFts(assetId);
      this.deleteEmbeddings(assetId);
      this.db.prepare('DELETE FROM asset_tags WHERE asset_id = ?').run(assetId);
      this.db
        .prepare('DELETE FROM asset_collection_items WHERE asset_id = ?')
        .run(assetId);
      this.db
        .prepare('DELETE FROM asset_attachments WHERE asset_id = ?')
        .run(assetId);
      this.db.prepare('DELETE FROM assets WHERE id = ?').run(assetId);
    });
    tx();
  }

  private enqueueJob(kind: string, payload: unknown): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO asset_jobs
         (id, kind, status, payload_json, created_at, updated_at)
         VALUES (?, ?, 'queued', ?, ?, ?)`,
      )
      .run(randomUUID(), kind, JSON.stringify(payload), now, now);
  }

  private tagsFor(assetId: string): string[] {
    const rows = this.db
      .prepare('SELECT tag FROM asset_tags WHERE asset_id = ? ORDER BY tag')
      .all(assetId) as { tag: string }[];
    return rows.map((row) => row.tag);
  }

  private attachmentsFor(assetId: string): AssetAttachment[] {
    const rows = this.db
      .prepare(
        `SELECT scope, scope_id, role, attached_at
         FROM asset_attachments
         WHERE asset_id = ?
         ORDER BY attached_at DESC`,
      )
      .all(assetId) as AttachmentRow[];
    return rows.map((row) => ({
      scope: row.scope,
      scopeId: row.scope_id,
      role: row.role,
      attachedAt: row.attached_at,
    }));
  }

  private generatedDerivativeRow(
    assetId: string,
    queryPrefix: string,
    prefixParams: SqlValue[],
  ): GeneratedDerivativeRow | null {
    const hashes = this.contentHashesForAsset(assetId);
    if (hashes.length === 0) return null;
    return (
      (this.db
        .prepare(
          `${queryPrefix} (${placeholders(hashes.length)})
           ORDER BY path ASC
           LIMIT 1`,
        )
        .get(...prefixParams, ...hashes) as
        | GeneratedDerivativeRow
        | undefined) ?? null
    );
  }

  private contentHashesForAsset(assetId: string): string[] {
    const asset = this.get(assetId);
    if (!asset) throw new AssetsError('Asset not found', 404);
    const hashes = new Set<string>();
    if (asset.contentHash) hashes.add(asset.contentHash);
    const rows = this.db
      .prepare(
        `SELECT DISTINCT content_hash
         FROM asset_materializations
         WHERE asset_id = ? AND content_hash IS NOT NULL`,
      )
      .all(assetId) as ContentHashRow[];
    for (const row of rows) {
      if (row.content_hash) hashes.add(row.content_hash);
    }
    return [...hashes];
  }

  private resolveGeneratedDerivativePath(
    storedPath: string | undefined,
  ): { absolutePath: string; relativePath: string } | null {
    if (!storedPath) return null;
    const workspaceRoot = realWorkspaceRootSync(this.getWorkspaceRoot());
    let absolutePath: string;
    try {
      absolutePath = safeResolveStoragePath(
        storedPath,
        workspaceRoot,
      ).absolutePath;
    } catch (error) {
      if (!path.isAbsolute(storedPath)) throw error;
      absolutePath = path.resolve(storedPath);
    }
    if (!fs.existsSync(absolutePath)) return null;
    const realPath = fs.realpathSync(absolutePath);
    const resolved = safeResolveStoragePath(realPath, workspaceRoot);
    const stat = fs.statSync(resolved.absolutePath);
    if (!stat.isFile()) return null;
    return resolved;
  }

  private sumTableBytes(table: string): number {
    if (!this.tableExists(table)) return 0;
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(bytes), 0) AS bytes FROM ${table}`)
      .get() as { bytes: number };
    return row.bytes;
  }

  private materializedBytesByScope(): AssetStorageScopeUsage[] {
    if (!this.tableExists('asset_materializations')) return [];
    return this.db
      .prepare(
        `SELECT scope,
                COALESCE(SUM(bytes), 0) AS materializedBytes,
                COUNT(*) AS materializationCount,
                COUNT(DISTINCT scope_id) AS projectCount
         FROM asset_materializations
         GROUP BY scope
         ORDER BY materializedBytes DESC, scope ASC`,
      )
      .all() as AssetStorageScopeUsage[];
  }

  private tableExists(table: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table),
    );
  }
}

export function createAssetRegistry(
  options: RegistryOptions = {},
): AssetRegistry {
  return new AssetRegistry(options);
}

let assetRegistrySingleton: AssetRegistry | null = null;

export function getAssetRegistry(): AssetRegistry {
  assetRegistrySingleton ??= new AssetRegistry();
  return assetRegistrySingleton;
}

export function __resetAssetRegistryForTests(): void {
  assetRegistrySingleton = null;
}

function mimeForProxyPreset(preset: ProxyPreset, filePath: string): string {
  const detected = mimeFromExtension(path.extname(filePath));
  if (detected) return detected;
  if (preset === 'design_2k') return 'image/webp';
  if (preset === 'audio_mp3') return 'audio/mpeg';
  if (preset === 'web_720p') return 'video/mp4';
  return 'video/webm';
}

function mimeForPreviewArtifact(
  kind: PreviewArtifactKind,
  filePath: string,
): string {
  const detected = mimeFromExtension(path.extname(filePath));
  if (detected) return detected;
  if (kind === 'poster') return 'image/jpeg';
  if (kind === 'filmstrip') return 'application/x-ndjson';
  return 'application/octet-stream';
}

function inferKind(mime: string, filePath: string): AssetKind {
  const normalizedMime = mime.toLowerCase();
  if (normalizedMime.startsWith('image/')) return 'image';
  if (normalizedMime.startsWith('video/')) return 'video';
  if (normalizedMime.startsWith('audio/')) return 'audio';
  if (normalizedMime === 'application/pdf') return 'pdf';

  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  if (TEXT_EXTENSIONS.has(ext) || normalizedMime.startsWith('text/')) {
    return 'text';
  }
  if (DOC_EXTENSIONS.has(ext)) return 'doc';
  return 'other';
}

function safeResolveStoragePath(storagePath: string, workspaceRoot: string) {
  try {
    return resolveWorkspaceStoragePath(storagePath, workspaceRoot);
  } catch {
    throw new AssetsError(
      'Asset path must stay within the configured workspace',
      403,
    );
  }
}

async function realWorkspaceRoot(workspaceRoot: string): Promise<string> {
  return fs.promises.realpath(workspaceRoot).catch(() => workspaceRoot);
}

function realWorkspaceRootSync(workspaceRoot: string): string {
  try {
    return fs.realpathSync(workspaceRoot);
  } catch {
    return workspaceRoot;
  }
}

function normalizeTags(tags: string[]): string[] {
  return [
    ...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
  ];
}

function clampLimit(limit: number | undefined): number {
  if (!limit) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
      offset?: unknown;
    };
    return typeof parsed.offset === 'number' && parsed.offset > 0
      ? Math.trunc(parsed.offset)
      : 0;
  } catch {
    return 0;
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function stringifyJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function remoteParams(
  id: string,
  importedAt: number,
  modifiedAt: number,
  input: RemoteAssetInput,
) {
  return {
    id,
    source: input.source,
    connectionId: input.connectionId,
    sourceId: input.sourceId,
    kind: input.kind,
    mime: input.mime,
    bytes: input.bytes,
    width: input.width ?? null,
    height: input.height ?? null,
    durationMs: input.durationMs ?? null,
    contentHash: input.contentHash ?? null,
    title: input.title ?? null,
    description: input.description ?? null,
    caption: input.caption ?? null,
    ocrText: input.ocrText ?? null,
    transcript: input.transcript ?? null,
    capturedAt: input.capturedAt ?? null,
    importedAt,
    modifiedAt,
    provenanceJson: stringifyJson(input.provenance),
    exifJson: stringifyJson(input.exif),
    gpsLat: input.gpsLat ?? null,
    gpsLng: input.gpsLng ?? null,
  };
}

function parseJson(value: string | null): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
