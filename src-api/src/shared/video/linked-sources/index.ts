import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';

import { getDatabase } from '@/shared/db';
import type { CloudFile } from '@/shared/integrations/cloud-storage/types';
import { extensionFromMime } from '@/shared/utils/mime-extension';
import {
  findProjectAssetByContentHash,
  getProject,
  getVideoAssetsDir,
  getVideoProjectRoot,
  externalMediaItem,
  hashFile,
  mediaItemFromPath,
  updateProjectDocument,
  writeProject,
} from '@/shared/video/store';
import { rebuildTimelineFromStoryboard } from '@/shared/video/timeline';
import type { VideoJob } from '@/shared/video/types';
import type {
  AspectRatio,
  LinkedAsset,
  LinkedAssetSearchCapability,
  LinkedAssetSearchHit,
  LinkedFolderChild,
  LinkedAssetKind,
  LinkedSource,
  LinkedSourceProvider,
  VideoProject,
} from '@/shared/video/types';

import {
  defaultConnectionIdForProvider,
  resolveLinkedSourceAdapter,
} from './adapter-bridge';
import { purgeLinkedSourceCache } from './cache';
import { crawlLinkedSource, isFilesystemNoise } from './crawler';
import { rowToLinkedAsset } from './crawler';
import { LocalFsLinkedSourceAdapter } from './local-fs';
import { consumeLocalFolderGrant } from './local-grants';
import { linkedAssetKind } from './metadata';
import {
  indexLinkedAssetsForSource,
  searchLinkedAssets as searchLinkedAssetsInternal,
} from './search';

const DEFAULT_BUDGET = {
  maxFiles: 10_000,
  maxBytes: 500 * 1024 * 1024,
  ttlSec: 86_400,
};

export interface AddLinkedSourceInput {
  provider: LinkedSourceProvider;
  connectionId?: string;
  rootPath: string;
  displayName?: string;
  role?: LinkedSource['role'];
  filters?: LinkedSource['filters'];
  budget?: LinkedSource['budget'];
  localGrantToken?: string;
}

export interface UpdateLinkedSourceInput {
  displayName?: string;
  role?: LinkedSource['role'];
  filters?: LinkedSource['filters'];
  budget?: LinkedSource['budget'];
}

export interface LinkedAssetListInput {
  sourceId?: string;
  kind?: LinkedAssetKind;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface AttachLinkedAssetInput {
  sceneId?: string;
  role?: 'asset' | 'reference';
}

export interface LinkedAssetSearchInput {
  query?: string;
  kind?: Exclude<LinkedAssetKind, 'other'>;
  sourceIds?: string[];
  role?: LinkedSource['role'];
  durationMs?: { min?: number; max?: number };
  aspectRatio?: AspectRatio;
  limit?: number;
}

export async function addLinkedSource(
  projectId: string,
  input: AddLinkedSourceInput,
): Promise<{ project: VideoProject; source: LinkedSource }> {
  const project = await getProject(projectId);
  const now = new Date().toISOString();
  const rootPath =
    input.provider === 'local-fs'
      ? await consumeLocalFolderGrant(input.rootPath, input.localGrantToken)
      : input.rootPath.trim();
  const source: LinkedSource = {
    id: randomUUID(),
    provider: input.provider,
    connectionId:
      input.connectionId?.trim() ||
      defaultConnectionIdForProvider(input.provider),
    rootPath,
    displayName: input.displayName?.trim() || defaultDisplayName(rootPath),
    role: input.role ?? 'context',
    filters: normalizeFilters(input.filters),
    index: { state: 'unindexed' },
    budget: normalizeBudget(input.budget),
    createdAt: now,
    updatedAt: now,
  };
  if (source.provider !== 'local-fs') {
    resolveLinkedSourceAdapter(source);
  }
  const next = {
    ...project,
    linkedSources: [...(project.linkedSources ?? []), source],
    updatedAt: now,
  };
  await writeProject(next);
  return { project: next, source };
}

export async function listLinkedSources(
  projectId: string,
): Promise<LinkedSource[]> {
  return (await getProject(projectId)).linkedSources ?? [];
}

export async function updateLinkedSource(
  projectId: string,
  sourceId: string,
  input: UpdateLinkedSourceInput,
): Promise<{ project: VideoProject; source: LinkedSource }> {
  const project = await getProject(projectId);
  const now = new Date().toISOString();
  let updated: LinkedSource | undefined;
  const linkedSources = (project.linkedSources ?? []).map((source) => {
    if (source.id !== sourceId) return source;
    updated = {
      ...source,
      displayName: input.displayName?.trim() || source.displayName,
      role: input.role ?? source.role,
      filters:
        input.filters === undefined
          ? source.filters
          : normalizeFilters(input.filters),
      budget:
        input.budget === undefined
          ? source.budget
          : normalizeBudget(input.budget),
      index:
        input.filters === undefined && input.budget === undefined
          ? source.index
          : { ...source.index, state: 'stale' },
      updatedAt: now,
    };
    return updated;
  });
  if (!updated) throw new Error('Linked source not found');
  const next = { ...project, linkedSources, updatedAt: now };
  await writeProject(next);
  return { project: next, source: updated };
}

export async function setLinkedSourceFavorite(
  projectId: string,
  sourceId: string,
  favorite: boolean,
): Promise<{ project: VideoProject; source: LinkedSource }> {
  const project = await getProject(projectId);
  const now = new Date().toISOString();
  let updated: LinkedSource | undefined;
  const linkedSources = (project.linkedSources ?? []).map((source) => {
    if (source.id !== sourceId) return source;
    updated = { ...source, favorite, updatedAt: now };
    return updated;
  });
  if (!updated) throw new Error('Linked source not found');
  const next = { ...project, linkedSources, updatedAt: now };
  await writeProject(next);
  return { project: next, source: updated };
}

export async function removeLinkedSource(
  projectId: string,
  sourceId: string,
): Promise<VideoProject> {
  const project = await getProject(projectId);
  const source = (project.linkedSources ?? []).find(
    (item) => item.id === sourceId,
  );
  if (!source) throw new Error('Linked source not found');
  deleteLinkedAssetsForSource(projectId, sourceId);
  await purgeLinkedSourceCache(
    getVideoProjectRoot(projectId),
    projectId,
    sourceId,
  );
  const next = {
    ...project,
    linkedSources: (project.linkedSources ?? []).filter(
      (item) => item.id !== sourceId,
    ),
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return next;
}

export async function enqueueLinkedSourceSync(
  projectId: string,
  sourceId: string,
  depth?: number,
): Promise<{ project: VideoProject; job: VideoJob; source: LinkedSource }> {
  const project = await markLinkedSourceIndex(projectId, sourceId, {
    state: 'crawling',
    error: undefined,
  });
  const source = findLinkedSource(project, sourceId);
  const job: VideoJob = {
    id: randomUUID(),
    projectId,
    kind: 'linked-source.sync',
    status: 'queued',
    payload: { projectId, sourceId, depth },
    caller: 'in-app',
  };
  insertVideoJob(job);
  return { project, job, source };
}

export async function runLinkedSourceSyncJob(
  job: VideoJob,
): Promise<Record<string, unknown>> {
  const sourceId = String(job.payload.sourceId ?? '');
  if (!sourceId) throw new Error('Linked source sync job missing sourceId');
  const workspaceRoot = getVideoProjectRoot(job.projectId);
  const project = await markLinkedSourceIndex(job.projectId, sourceId, {
    state: 'crawling',
    error: undefined,
  });
  const source = findLinkedSource(project, sourceId);
  try {
    const result = await crawlLinkedSource({
      projectId: job.projectId,
      source,
      workspaceRoot,
      depth: optionalNumber(job.payload.depth),
    });
    // Sweep out rows an earlier sync indexed before the crawler learned to
    // skip filesystem bookkeeping — otherwise a folder stays half-full of
    // AppleDouble entries until the user removes and re-adds the source.
    purgeIndexedFilesystemNoise(job.projectId, sourceId);
    const indexed = await indexLinkedAssetsForSource(job.projectId, source);
    await markLinkedSourceIndex(job.projectId, sourceId, {
      state: result.state,
      fileCount: result.fileCount,
      cursor: result.cursor,
      lastSyncedAt: new Date().toISOString(),
      error: undefined,
    });
    return {
      sourceId,
      fileCount: result.fileCount,
      state: result.state,
      searchIndex: indexed,
    };
  } catch (error) {
    await markLinkedSourceIndex(job.projectId, sourceId, {
      state: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function searchLinkedAssets(
  projectId: string,
  input: LinkedAssetSearchInput = {},
): Promise<{
  results: LinkedAssetSearchHit[];
  capability: LinkedAssetSearchCapability;
}> {
  const sources = await listLinkedSources(projectId);
  return searchLinkedAssetsInternal(projectId, sources, input);
}

export async function listLinkedFolderChildren(
  projectId: string,
  input: {
    sourceId: string;
    path?: string;
    page?: string;
    limit?: number;
    kinds?: LinkedAssetKind[];
  },
) {
  const project = await getProject(projectId);
  const source = findLinkedSource(project, input.sourceId);
  const adapter = resolveLinkedSourceAdapter(source);
  const allowedKinds = input.kinds?.length ? new Set(input.kinds) : undefined;
  const page = await adapter.listChildren({
    parentId: input.path?.trim() || source.rootPath,
    cursor: input.page,
    limit: clampInteger(input.limit, 1, 100) ?? 50,
  });
  return {
    entries: page.items
      .map((item) =>
        linkedFolderChildFromItem(projectId, source.id, item, allowedKinds),
      )
      .filter((entry): entry is LinkedFolderChild => Boolean(entry)),
    nextCursor: page.nextCursor,
  };
}

function linkedFolderChildFromItem(
  projectId: string,
  sourceId: string,
  item: CloudFile,
  allowedKinds: Set<LinkedAssetKind> | undefined,
): LinkedFolderChild | null {
  const kind = item.isFolder ? undefined : linkedAssetKind(item);
  if (!item.isFolder && allowedKinds && (!kind || !allowedKinds.has(kind))) {
    return null;
  }
  const asset =
    item.isFolder || !kind
      ? undefined
      : getLinkedAssetByExternalIdWithActivity(projectId, sourceId, item.id);
  return {
    id: item.id,
    name: item.name,
    isFolder: item.isFolder,
    mimeType: item.mimeType,
    size: item.size,
    modifiedAt:
      item.modifiedAt instanceof Date
        ? item.modifiedAt.toISOString()
        : item.modifiedAt,
    kind,
    assetId: asset?.id,
    thumbnailUrl: asset?.thumbnailCachePath
      ? `/video/projects/${encodeURIComponent(projectId)}/linked-assets/${encodeURIComponent(
          asset.id,
        )}/thumbnail`
      : undefined,
    favorite: asset?.favorite,
    lastOpenedAt: asset?.lastOpenedAt,
  };
}

export async function previewLinkedAsset(projectId: string, assetId: string) {
  const asset = getLinkedAsset(projectId, assetId);
  markLinkedAssetOpened(projectId, assetId);
  const project = await getProject(projectId);
  const source = findLinkedSource(project, asset.sourceId);
  return {
    asset,
    thumbnailUrl: asset.thumbnailCachePath
      ? `/video/projects/${encodeURIComponent(projectId)}/linked-assets/${encodeURIComponent(
          asset.id,
        )}/thumbnail`
      : '',
    description: asset.description,
    sourceDisplayName: source.displayName,
    metadata: {
      mime: asset.mime,
      kind: asset.kind,
      sizeBytes: asset.sizeBytes,
      durationMs: asset.durationMs,
      width: asset.width,
      height: asset.height,
      modifiedAt: asset.modifiedAt,
      captionProvider: asset.captionProvider,
      captionModel: asset.captionModel,
      embeddingModel: asset.embeddingModel,
      embeddingDim: asset.embeddingDim,
    },
  };
}

export function listLinkedAssets(
  projectId: string,
  input: LinkedAssetListInput = {},
): LinkedAsset[] {
  const where = ['project_id = ?'];
  const args: Array<string | number> = [projectId];
  if (input.sourceId) {
    where.push('source_id = ?');
    args.push(input.sourceId);
  }
  if (input.kind) {
    where.push('kind = ?');
    args.push(input.kind);
  }
  if (input.query?.trim()) {
    where.push('LOWER(name) LIKE ?');
    args.push(`%${input.query.trim().toLowerCase()}%`);
  }
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const rows = getDatabase()
    .prepare(
      `SELECT ${linkedAssetSelectColumns()}
       FROM linked_assets AS la
       LEFT JOIN linked_asset_activity AS activity
         ON activity.project_id = la.project_id AND activity.asset_id = la.id
       WHERE ${where.map(qualifyLinkedAssetWhere).join(' AND ')}
       ORDER BY la.indexed_at DESC, la.name ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset);
  return rows.map(rowToLinkedAsset);
}

export function getLinkedAsset(
  projectId: string,
  assetId: string,
): LinkedAsset {
  const row = getDatabase()
    .prepare(
      `SELECT ${linkedAssetSelectColumns()}
       FROM linked_assets AS la
       LEFT JOIN linked_asset_activity AS activity
         ON activity.project_id = la.project_id AND activity.asset_id = la.id
       WHERE la.project_id = ? AND la.id = ?`,
    )
    .get(projectId, assetId);
  if (!row) throw new Error('Linked asset not found');
  return rowToLinkedAsset(row);
}

function getLinkedAssetByExternalIdWithActivity(
  projectId: string,
  sourceId: string,
  externalId: string,
): LinkedAsset | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT ${linkedAssetSelectColumns()}
       FROM linked_assets AS la
       LEFT JOIN linked_asset_activity AS activity
         ON activity.project_id = la.project_id AND activity.asset_id = la.id
       WHERE la.project_id = ? AND la.source_id = ? AND la.external_id = ?`,
    )
    .get(projectId, sourceId, externalId);
  return row ? rowToLinkedAsset(row) : undefined;
}

function linkedAssetSelectColumns(): string {
  return [
    'la.*',
    'COALESCE(activity.favorite, 0) AS favorite',
    'activity.last_opened_at AS last_opened_at',
  ].join(', ');
}

function qualifyLinkedAssetWhere(clause: string): string {
  return clause
    .replaceAll(/\bproject_id\b/g, 'la.project_id')
    .replaceAll(/\bsource_id\b/g, 'la.source_id')
    .replaceAll(/\bkind\b/g, 'la.kind')
    .replaceAll(/\bname\b/g, 'la.name');
}

export function listRecentLinkedAssets(
  projectId: string,
  limit = 24,
): LinkedAsset[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${linkedAssetSelectColumns()}
       FROM linked_asset_activity AS activity
       JOIN linked_assets AS la
         ON la.project_id = activity.project_id AND la.id = activity.asset_id
       WHERE activity.project_id = ? AND activity.last_opened_at IS NOT NULL
       ORDER BY activity.last_opened_at DESC
       LIMIT ?`,
    )
    .all(projectId, clampInteger(limit, 1, 100) ?? 24);
  return rows.map(rowToLinkedAsset);
}

export function listFavoriteLinkedAssets(
  projectId: string,
  limit = 48,
): LinkedAsset[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${linkedAssetSelectColumns()}
       FROM linked_asset_activity AS activity
       JOIN linked_assets AS la
         ON la.project_id = activity.project_id AND la.id = activity.asset_id
       WHERE activity.project_id = ? AND activity.favorite = 1
       ORDER BY activity.updated_at DESC
       LIMIT ?`,
    )
    .all(projectId, clampInteger(limit, 1, 100) ?? 48);
  return rows.map(rowToLinkedAsset);
}

export function setLinkedAssetFavorite(
  projectId: string,
  assetId: string,
  favorite: boolean,
): LinkedAsset {
  getLinkedAsset(projectId, assetId);
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO linked_asset_activity
        (project_id, asset_id, favorite, last_opened_at, opened_count, updated_at)
       VALUES (?, ?, ?, NULL, 0, ?)
       ON CONFLICT(project_id, asset_id) DO UPDATE SET
         favorite = excluded.favorite,
         updated_at = excluded.updated_at`,
    )
    .run(projectId, assetId, favorite ? 1 : 0, now);
  return getLinkedAsset(projectId, assetId);
}

export function markLinkedAssetOpened(
  projectId: string,
  assetId: string,
): LinkedAsset {
  getLinkedAsset(projectId, assetId);
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO linked_asset_activity
        (project_id, asset_id, favorite, last_opened_at, opened_count, updated_at)
       VALUES (?, ?, 0, ?, 1, ?)
       ON CONFLICT(project_id, asset_id) DO UPDATE SET
         last_opened_at = excluded.last_opened_at,
         opened_count = linked_asset_activity.opened_count + 1,
         updated_at = excluded.updated_at`,
    )
    .run(projectId, assetId, now, now);
  return getLinkedAsset(projectId, assetId);
}

export async function attachLinkedAsset(
  projectId: string,
  assetId: string,
  input: AttachLinkedAssetInput = {},
): Promise<{ project: VideoProject; asset: VideoProject['assets'][number] }> {
  const linkedAsset = getLinkedAsset(projectId, assetId);
  const project = await getProject(projectId);
  const source = findLinkedSource(project, linkedAsset.sourceId);
  const adapter = resolveLinkedSourceAdapter(source);
  const root = getVideoProjectRoot(projectId);

  // A local linked folder already has the bytes on this machine. Attaching
  // registers the user's own file as the master and copies nothing; only a
  // remote provider has to be pulled in. The file is still hashed where it
  // sits so re-attaching media the project already holds is idempotent.
  const localSourcePath =
    adapter instanceof LocalFsLinkedSourceAdapter
      ? await adapter.resolveLocalFilePath(linkedAsset.externalId)
      : undefined;

  let materializedPath: string | undefined;
  const materialize = async (): Promise<string> => {
    if (materializedPath) return materializedPath;
    const destination = await linkedAssetDestination(projectId, linkedAsset);
    try {
      // Pulls the master into the project for editing — request the original,
      // not a streaming transcode (which Immich can 500 on).
      const response = await adapter.download(linkedAsset.externalId, {
        preferOriginal: true,
      });
      if (!response.ok) {
        throw new Error(
          `Linked asset download failed with HTTP ${response.status}`,
        );
      }
      if (!response.body) {
        throw new Error('Linked asset download returned an empty body');
      }
      // Stream to disk. A 4K master read whole into a Buffer blows the
      // process memory budget and stalls the attach it was meant to finish.
      await streamPipeline(
        Readable.fromWeb(
          response.body as Parameters<typeof Readable.fromWeb>[0],
        ),
        createWriteStream(destination),
      );
    } catch (error) {
      // Never leave a half-written master behind for the next attach to find.
      await fs.rm(destination, { force: true }).catch(() => {});
      throw error;
    }
    materializedPath = destination;
    return destination;
  };

  const buildAsset = async (
    contentHash: string | undefined,
  ): Promise<VideoProject['assets'][number]> => {
    const asset = localSourcePath
      ? await externalMediaItem(localSourcePath, 'downloaded', contentHash)
      : await mediaItemFromPath(await materialize(), 'downloaded', root);
    asset.provenance = {
      provider: source.provider,
      sourceUrl:
        source.provider === 'local-fs'
          ? `local-fs:${linkedAsset.externalId}`
          : linkedAsset.externalId,
      sourceDisplayName: source.displayName,
      attribution: source.displayName,
    };
    if (contentHash) {
      asset.metadata = { ...asset.metadata, contentHash };
    }
    return asset;
  };

  // Hash the local file where it sits; a remote one only exists once pulled.
  const contentHash = await hashFile(
    localSourcePath ?? (await materialize()),
  ).catch(() => undefined);

  // If this exact file is already a project asset, reuse it instead of adding a
  // second copy — attaching the same linked media twice should be idempotent.
  // Checked once here so the common re-attach never touches the disk, and
  // again under the lock so a concurrent attach can't slip a copy past us.
  const preexisting = contentHash
    ? await findProjectAssetByContentHash(root, project.assets, contentHash)
    : undefined;
  let candidate = preexisting ? undefined : await buildAsset(contentHash);

  // Serialize the read-merge-write so concurrent attaches can't clobber each
  // other; the copy + hash above are done outside the lock.
  let effectiveAsset: VideoProject['assets'][number] | undefined;
  const next = await updateProjectDocument(projectId, async (current) => {
    const duplicate = contentHash
      ? await findProjectAssetByContentHash(root, current.assets, contentHash)
      : undefined;
    if (duplicate && materializedPath) {
      await fs.rm(materializedPath, { force: true }).catch(() => {});
      materializedPath = undefined;
    }
    let attached = duplicate ?? candidate;
    if (!attached) {
      // The pre-check matched an asset that went away before we took the lock.
      candidate = await buildAsset(contentHash);
      attached = candidate;
    }
    effectiveAsset = attached;
    if (duplicate && !input.sceneId) return current;

    const patchedProject: VideoProject = {
      ...current,
      assets: duplicate ? current.assets : [...current.assets, attached],
      storyboard: input.sceneId
        ? patchStoryboardScene(current.storyboard, input.sceneId, attached.id)
        : current.storyboard,
      scenes: input.sceneId
        ? (current.scenes ?? []).map((scene) =>
            scene.id === input.sceneId
              ? {
                  ...scene,
                  clips: [{ id: randomUUID(), mediaId: attached.id }],
                }
              : scene,
          )
        : current.scenes,
      updatedAt: new Date().toISOString(),
    };
    return input.sceneId
      ? rebuildTimelineFromStoryboard(patchedProject)
      : patchedProject;
  });
  if (!effectiveAsset) {
    throw new Error('Linked asset attach resolved no media item');
  }
  markLinkedAssetOpened(projectId, assetId);
  return { project: next, asset: effectiveAsset };
}

async function linkedAssetDestination(
  projectId: string,
  asset: LinkedAsset,
): Promise<string> {
  const dir = getVideoAssetsDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(asset.name) || extensionFromMime(asset.mime);
  const safeName = path
    .basename(asset.name, path.extname(asset.name))
    .replaceAll('\u0000', '_')
    .replace(/[/\\]/g, '_')
    .slice(0, 80);
  return path.join(dir, `linked-${asset.id}-${safeName || 'asset'}${ext}`);
}

function patchStoryboardScene(
  storyboard: VideoProject['storyboard'],
  sceneId: string,
  assetId: string,
): VideoProject['storyboard'] {
  if (!storyboard) return storyboard;
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((scene) =>
      scene.id === sceneId
        ? { ...scene, assetPlan: { kind: 'existing', assetId } }
        : scene,
    ),
  };
}

async function markLinkedSourceIndex(
  projectId: string,
  sourceId: string,
  index: Partial<LinkedSource['index']>,
): Promise<VideoProject> {
  const project = await getProject(projectId);
  const now = new Date().toISOString();
  let found = false;
  const linkedSources = (project.linkedSources ?? []).map((source) => {
    if (source.id !== sourceId) return source;
    found = true;
    return {
      ...source,
      index: {
        ...source.index,
        ...index,
      },
      updatedAt: now,
    };
  });
  if (!found) throw new Error('Linked source not found');
  const next = { ...project, linkedSources, updatedAt: now };
  await writeProject(next);
  return next;
}

function findLinkedSource(
  project: VideoProject,
  sourceId: string,
): LinkedSource {
  const source = (project.linkedSources ?? []).find(
    (item) => item.id === sourceId,
  );
  if (!source) throw new Error('Linked source not found');
  return source;
}

function insertVideoJob(job: VideoJob): void {
  getDatabase()
    .prepare(
      `INSERT INTO video_jobs
        (id, project_id, kind, status, payload_json, result_json,
         started_at, finished_at, cost_cents, caller)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      job.id,
      job.projectId,
      job.kind,
      job.status,
      JSON.stringify(job.payload),
      JSON.stringify(job.result ?? {}),
      job.startedAt ?? null,
      job.finishedAt ?? null,
      job.costCents ?? 0,
      job.caller,
    );
}

/**
 * Deletes previously indexed rows that the crawler now rejects as filesystem
 * noise. Narrow by construction: it only matches names no crawl would index
 * today, so it can never drop real media.
 */
function purgeIndexedFilesystemNoise(
  projectId: string,
  sourceId: string,
): void {
  const db = getDatabase();
  const stale = db
    .prepare(
      `SELECT id, name FROM linked_assets WHERE project_id = ? AND source_id = ?`,
    )
    .all(projectId, sourceId) as Array<{ id: string; name: string }>;
  const ids = stale
    .filter((row) => isFilesystemNoise(row.name))
    .map((row) => row.id);
  if (ids.length === 0) return;

  const placeholders = ids.map(() => '?').join(',');
  try {
    db.prepare(
      `DELETE FROM vec_linked_assets WHERE linked_asset_id IN (${placeholders})`,
    ).run(...ids);
  } catch {
    // sqlite-vec may be unavailable.
  }
  db.prepare(`DELETE FROM linked_assets WHERE id IN (${placeholders})`).run(
    ...ids,
  );
}

function deleteLinkedAssetsForSource(
  projectId: string,
  sourceId: string,
): void {
  try {
    getDatabase()
      .prepare(
        `DELETE FROM vec_linked_assets
         WHERE linked_asset_id IN (
           SELECT id FROM linked_assets WHERE project_id = ? AND source_id = ?
         )`,
      )
      .run(projectId, sourceId);
  } catch {
    // sqlite-vec may be unavailable.
  }
  getDatabase()
    .prepare(`DELETE FROM linked_assets WHERE project_id = ? AND source_id = ?`)
    .run(projectId, sourceId);
}

function normalizeFilters(
  filters: LinkedSource['filters'] | undefined,
): LinkedSource['filters'] | undefined {
  if (!filters) return undefined;
  return {
    types: filters.types?.length ? [...new Set(filters.types)] : undefined,
    extensions: filters.extensions?.length
      ? [...new Set(filters.extensions.map((item) => item.toLowerCase()))]
      : undefined,
    maxDepth: clampInteger(filters.maxDepth, 0, 12),
    minDurationMs: clampInteger(filters.minDurationMs, 0, 24 * 60 * 60 * 1000),
    maxDurationMs: clampInteger(filters.maxDurationMs, 0, 24 * 60 * 60 * 1000),
  };
}

function normalizeBudget(
  budget: LinkedSource['budget'] | undefined,
): LinkedSource['budget'] {
  return {
    maxFiles:
      clampInteger(budget?.maxFiles, 1, 100_000) ?? DEFAULT_BUDGET.maxFiles,
    maxBytes:
      clampInteger(budget?.maxBytes, 1024 * 1024, 10 * 1024 * 1024 * 1024) ??
      DEFAULT_BUDGET.maxBytes,
    ttlSec:
      clampInteger(budget?.ttlSec, 60, 30 * 24 * 60 * 60) ??
      DEFAULT_BUDGET.ttlSec,
    captionUsd: clampInteger(budget?.captionUsd, 0, 10_000),
  };
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function defaultDisplayName(rootPath: string): string {
  return path.basename(rootPath) || rootPath;
}
