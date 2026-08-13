import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { getDatabase } from '@/shared/db';
import type { CloudFile } from '@/shared/integrations/cloud-storage/types';
import type {
  LinkedAsset,
  LinkedAssetKind,
  LinkedSource,
} from '@/shared/video/types';

import { resolveLinkedSourceAdapter } from './adapter-bridge';
import {
  durationMsFromCloudFile,
  heightFromCloudFile,
  linkedAssetKind,
  probeLocalMetadata,
  widthFromCloudFile,
} from './metadata';
import { cacheLinkedAssetThumbnail } from './thumbnails';

const DEFAULT_MAX_FILES = 10_000;
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 6;

export interface LinkedSourceCrawlResult {
  fileCount: number;
  state: LinkedSource['index']['state'];
  cursor?: string;
}

interface CrawlQueueItem {
  parentId: string;
  depth: number;
}

export async function crawlLinkedSource(input: {
  projectId: string;
  source: LinkedSource;
  workspaceRoot: string;
  depth?: number;
}): Promise<LinkedSourceCrawlResult> {
  const adapter = resolveLinkedSourceAdapter(input.source);
  const maxDepth = Math.min(
    input.depth ?? input.source.filters?.maxDepth ?? DEFAULT_MAX_DEPTH,
    DEFAULT_MAX_DEPTH,
  );
  const maxFiles = input.source.budget?.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytes = input.source.budget?.maxBytes ?? DEFAULT_MAX_BYTES;
  const queue: CrawlQueueItem[] = [
    { parentId: input.source.rootPath, depth: 0 },
  ];
  let fileCount = 0;
  let partial = false;

  while (queue.length > 0) {
    const next = queue.shift()!;
    let cursor: string | undefined;
    do {
      const page = await adapter.listChildren({
        parentId: next.parentId,
        cursor,
        limit: 100,
      });
      for (const item of page.items) {
        if (item.isFolder) {
          if (next.depth < maxDepth) {
            queue.push({ parentId: item.id, depth: next.depth + 1 });
          }
          continue;
        }
        const kind = linkedAssetKind(item);
        if (!passesFilters(item, kind, input.source.filters)) continue;
        if (fileCount >= maxFiles) {
          partial = true;
          break;
        }

        const asset = await upsertLinkedAssetFromCloudFile({
          projectId: input.projectId,
          sourceId: input.source.id,
          item,
          kind,
          workspaceRoot: input.workspaceRoot,
        });
        const thumbnailCachePath = await cacheLinkedAssetThumbnail({
          adapter,
          externalId: item.id,
          projectId: input.projectId,
          sourceId: input.source.id,
          assetId: asset.id,
          kind,
          workspaceRoot: input.workspaceRoot,
          maxBytes,
        });
        if (
          thumbnailCachePath &&
          thumbnailCachePath !== asset.thumbnailCachePath
        ) {
          updateLinkedAssetThumbnail(asset.id, thumbnailCachePath);
        }
        fileCount += 1;
      }
      if (partial) break;
      cursor = page.nextCursor;
    } while (cursor);
    if (partial) break;
  }

  return {
    fileCount,
    state: partial ? 'partial' : 'fresh',
  };
}

function passesFilters(
  file: CloudFile,
  kind: LinkedAssetKind,
  filters: LinkedSource['filters'],
): boolean {
  if (kind === 'other') return false;
  if (filters?.types?.length && !filters.types.includes(kind)) return false;
  if (filters?.extensions?.length) {
    const ext = path.extname(file.name).toLowerCase().replace(/^\./, '');
    const allowed = filters.extensions.map((item) =>
      item.toLowerCase().replace(/^\./, ''),
    );
    if (!allowed.includes(ext)) return false;
  }
  const durationMs = durationMsFromCloudFile(file);
  if (
    filters?.minDurationMs !== undefined &&
    (durationMs === undefined || durationMs < filters.minDurationMs)
  ) {
    return false;
  }
  if (
    filters?.maxDurationMs !== undefined &&
    durationMs !== undefined &&
    durationMs > filters.maxDurationMs
  ) {
    return false;
  }
  return true;
}

async function upsertLinkedAssetFromCloudFile(input: {
  projectId: string;
  sourceId: string;
  item: CloudFile;
  kind: LinkedAssetKind;
  workspaceRoot: string;
}): Promise<LinkedAsset> {
  const existing = getLinkedAssetByExternalId(
    input.projectId,
    input.sourceId,
    input.item.id,
  );
  const localProbe =
    input.item.provider === 'local_fs'
      ? await probeLocalMetadata(input.item.id, input.workspaceRoot)
      : {};
  const now = new Date().toISOString();
  const asset: LinkedAsset = {
    id: existing?.id ?? randomUUID(),
    projectId: input.projectId,
    sourceId: input.sourceId,
    externalId: input.item.id,
    name: input.item.name,
    mime: input.item.mimeType,
    kind: input.kind,
    sizeBytes: input.item.size,
    durationMs: durationMsFromCloudFile(input.item) ?? localProbe.durationMs,
    width: widthFromCloudFile(input.item) ?? localProbe.width,
    height: heightFromCloudFile(input.item) ?? localProbe.height,
    thumbnailCachePath: existing?.thumbnailCachePath,
    description: input.item.mediaMetadata?.description ?? existing?.description,
    captionProvider: existing?.captionProvider,
    captionModel: existing?.captionModel,
    embeddingModel: existing?.embeddingModel,
    embeddingDim: existing?.embeddingDim,
    embeddedAt: existing?.embeddedAt,
    modifiedAt: toIso(input.item.modifiedAt),
    indexedAt: now,
  };
  upsertLinkedAsset(asset);
  return asset;
}

function upsertLinkedAsset(asset: LinkedAsset): void {
  getDatabase()
    .prepare(
      `INSERT INTO linked_assets
        (id, project_id, source_id, external_id, name, mime, kind, size_bytes,
         duration_ms, width, height, thumbnail_cache_path, description,
         caption_provider, caption_model, embedding_model, embedding_dim,
         embedded_at, modified_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, source_id, external_id) DO UPDATE SET
         name = excluded.name,
         mime = excluded.mime,
         kind = excluded.kind,
         size_bytes = excluded.size_bytes,
         duration_ms = excluded.duration_ms,
         width = excluded.width,
         height = excluded.height,
         description = COALESCE(excluded.description, linked_assets.description),
         caption_provider = CASE
           WHEN linked_assets.modified_at IS NOT excluded.modified_at
             OR linked_assets.size_bytes IS NOT excluded.size_bytes
           THEN NULL
           ELSE linked_assets.caption_provider
         END,
         caption_model = CASE
           WHEN linked_assets.modified_at IS NOT excluded.modified_at
             OR linked_assets.size_bytes IS NOT excluded.size_bytes
           THEN NULL
           ELSE linked_assets.caption_model
         END,
         embedding_model = CASE
           WHEN linked_assets.modified_at IS NOT excluded.modified_at
             OR linked_assets.size_bytes IS NOT excluded.size_bytes
           THEN NULL
           ELSE linked_assets.embedding_model
         END,
         embedding_dim = CASE
           WHEN linked_assets.modified_at IS NOT excluded.modified_at
             OR linked_assets.size_bytes IS NOT excluded.size_bytes
           THEN NULL
           ELSE linked_assets.embedding_dim
         END,
         embedded_at = CASE
           WHEN linked_assets.modified_at IS NOT excluded.modified_at
             OR linked_assets.size_bytes IS NOT excluded.size_bytes
           THEN NULL
           ELSE linked_assets.embedded_at
         END,
         modified_at = excluded.modified_at,
         indexed_at = excluded.indexed_at`,
    )
    .run(
      asset.id,
      asset.projectId,
      asset.sourceId,
      asset.externalId,
      asset.name,
      asset.mime ?? null,
      asset.kind,
      asset.sizeBytes ?? null,
      asset.durationMs ?? null,
      asset.width ?? null,
      asset.height ?? null,
      asset.thumbnailCachePath ?? null,
      asset.description ?? null,
      asset.captionProvider ?? null,
      asset.captionModel ?? null,
      asset.embeddingModel ?? null,
      asset.embeddingDim ?? null,
      asset.embeddedAt ?? null,
      asset.modifiedAt ?? null,
      asset.indexedAt,
    );
}

function updateLinkedAssetThumbnail(
  assetId: string,
  thumbnailCachePath: string,
): void {
  getDatabase()
    .prepare(`UPDATE linked_assets SET thumbnail_cache_path = ? WHERE id = ?`)
    .run(thumbnailCachePath, assetId);
}

function getLinkedAssetByExternalId(
  projectId: string,
  sourceId: string,
  externalId: string,
): LinkedAsset | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM linked_assets
       WHERE project_id = ? AND source_id = ? AND external_id = ?`,
    )
    .get(projectId, sourceId, externalId);
  return row ? rowToLinkedAsset(row) : null;
}

export function rowToLinkedAsset(row: unknown): LinkedAsset {
  const value = row as Record<string, unknown>;
  return {
    id: String(value.id),
    projectId: String(value.project_id),
    sourceId: String(value.source_id),
    externalId: String(value.external_id),
    name: String(value.name),
    mime: optionalString(value.mime),
    kind: value.kind as LinkedAssetKind,
    sizeBytes: optionalNumber(value.size_bytes),
    durationMs: optionalNumber(value.duration_ms),
    width: optionalNumber(value.width),
    height: optionalNumber(value.height),
    thumbnailCachePath: optionalString(value.thumbnail_cache_path),
    description: optionalString(value.description),
    captionProvider: optionalString(value.caption_provider),
    captionModel: optionalString(value.caption_model),
    embeddingModel: optionalString(value.embedding_model),
    embeddingDim: optionalNumber(value.embedding_dim),
    embeddedAt: optionalString(value.embedded_at),
    modifiedAt: optionalString(value.modified_at),
    favorite: optionalBoolean(value.favorite),
    lastOpenedAt: optionalString(value.last_opened_at),
    indexedAt: String(value.indexed_at),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return undefined;
}

function toIso(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}
