import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AssetRegistry,
  AssetsError,
  getAssetMaterializeStatus,
  getAssetMaterializer,
  type Asset,
  type MaterializeResult,
} from '@/shared/assets';
import { validateInputFile } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';
import { extensionFromMime } from '@/shared/utils/mime-extension';

import {
  getProject,
  getVideoAssetsDir,
  getVideoProjectRoot,
  getVideoWorkspaceRoot,
  mediaItemFromPath,
  updateProjectDocument,
} from './store';
import type {
  MediaItem,
  MediaProxy,
  VideoProject,
  VideoTimeline,
} from './types';

const logger = createLogger('VideoCatalogAssets');

export type CatalogAttachHydrateMode = 'none' | 'proxy' | 'full';

export interface AttachCatalogAssetInput {
  role?: string;
  sessionId?: string;
  clientRequestId?: string;
  // 'none' creates a reference-only MediaItem with no bytes on disk
  // (the iconic File-Provider "dataless" placeholder). Hydration is then
  // deferred to a use-site (drop-on-timeline, agent transcode, manual
  // download from the tile). 'proxy' / 'full' fall through to the legacy
  // eager path and are kept so the older agent flows and tests keep
  // working without churn. Default for the picker is 'none'.
  hydrate?: CatalogAttachHydrateMode;
}

// `path` scheme stamped on a reference-only MediaItem. The
// frontend detects this prefix to swap to the catalog thumbnail URL and
// to gate timeline/agent reads behind `hydrateProjectAsset`.
export const REFERENCED_ASSET_PATH_PREFIX = 'catalog:';

const catalogAttachLocks = new Map<string, Promise<unknown>>();

export function isReferencedProjectAsset(
  asset: Pick<MediaItem, 'materializationState' | 'path'>,
): boolean {
  return (
    asset.materializationState === 'referenced' ||
    asset.path.startsWith(REFERENCED_ASSET_PATH_PREFIX)
  );
}

export function shouldHydrateProjectAsset(
  projectId: string,
  asset: MediaItem,
): boolean {
  if (isReferencedProjectAsset(asset)) return true;
  if (!asset.provenance?.catalogAssetId) return false;
  try {
    validateInputFile(asset.path, getVideoProjectRoot(projectId));
    return false;
  } catch (error) {
    return isInputFileNotFoundError(error);
  }
}

export async function attachCatalogAssetToProject(
  projectId: string,
  assetId: string,
  input: AttachCatalogAssetInput = {},
): Promise<{
  project: VideoProject;
  asset: MediaItem;
  materialization?: MaterializeResult;
}> {
  return withCatalogAttachLock(projectId, assetId, () =>
    attachCatalogAssetToProjectUnlocked(projectId, assetId, input),
  );
}

async function attachCatalogAssetToProjectUnlocked(
  projectId: string,
  assetId: string,
  input: AttachCatalogAssetInput,
): Promise<{
  project: VideoProject;
  asset: MediaItem;
  materialization?: MaterializeResult;
}> {
  const registry = new AssetRegistry();
  const catalogAsset = registry.get(assetId);
  if (!catalogAsset) throw new AssetsError('Asset not found', 404);
  if (!isVideoMediaKind(catalogAsset.kind)) {
    throw new AssetsError('Asset kind is not supported by Video Mode', 400);
  }

  const project = await getProject(projectId);
  const hydrate = input.hydrate ?? 'none';
  const existing = findCatalogProjectAsset(project.assets, assetId);
  if (existing) {
    registry.attach(
      assetId,
      { scope: 'video_project', scopeId: projectId },
      input.role ?? 'asset',
    );
    if (hydrate === 'none' || !shouldHydrateProjectAsset(projectId, existing)) {
      return { project, asset: existing };
    }
    return hydrateProjectAsset(projectId, existing.id, {
      sessionId: input.sessionId,
      clientRequestId: input.clientRequestId,
      role: input.role ?? 'asset',
    });
  }

  if (hydrate === 'none') {
    let mediaItem = buildReferencedMediaItem(catalogAsset, assetId);
    const next = await updateProjectDocument(projectId, (current) => {
      const currentExisting = findCatalogProjectAsset(current.assets, assetId);
      if (currentExisting) {
        mediaItem = currentExisting;
        return current;
      }
      return {
        ...current,
        assets: [...current.assets, mediaItem],
        updatedAt: new Date().toISOString(),
      };
    });
    registry.attach(
      assetId,
      { scope: 'video_project', scopeId: projectId },
      input.role ?? 'asset',
    );
    return { project: next, asset: mediaItem };
  }

  const materializer = getAssetMaterializer();
  const materialization = await materializer.materialize({
    assetId,
    scope: 'video_project',
    scopeId: projectId,
    reason: 'video_attach',
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
    role: input.role ?? 'asset',
    proxies: hydrate === 'full' ? [] : ['edit_1080p'],
  });
  const destination = await catalogAssetDestination(
    projectId,
    catalogAsset,
    materialization.activePath,
  );
  await materializer.copyInto(materialization, destination);

  // Tag the new MediaItem as "downloaded" rather than the default "user" so
  // the inspector and provenance dialog stop labelling Immich/Drive/Box
  // attachments as if the user had uploaded them manually. The richer
  // provenance block below carries the actual upstream provider + web URL
  // so the UI can render an "Open in Immich" (or Drive / Box / …) link.
  const mediaItem = await mediaItemFromPath(
    destination,
    'downloaded',
    getVideoProjectRoot(projectId),
  );
  const derivatives = await readyCatalogDerivatives(
    projectId,
    assetId,
    catalogAsset,
  );
  const catalogCapturedAt = catalogCapturedAtIso(catalogAsset);
  if (catalogCapturedAt) mediaItem.metadata.capturedAt = catalogCapturedAt;
  const attachGps = catalogGps(catalogAsset);
  if (attachGps) mediaItem.metadata.gps = attachGps;
  const catalogProvenance = parseCatalogProvenance(catalogAsset.provenance);
  mediaItem.provenance = {
    provider: catalogProvenance.provider ?? catalogAsset.source ?? 'assets',
    sourceUrl: catalogProvenance.webUrl ?? `asset:${assetId}`,
    sourceDisplayName:
      catalogAsset.title ?? catalogAsset.storagePath ?? catalogAsset.id,
    connectionId: catalogAsset.connectionId ?? undefined,
    sourceId: catalogAsset.sourceId ?? undefined,
    thumbnailUrl: catalogProvenance.thumbnailUrl,
    attribution: materialization.license?.attribution ?? catalogAsset.source,
    license: materialization.license?.licenseCode,
    attributionRequired: materialization.license?.attributionRequired ?? false,
    // Catalog id is the key the materialization SSE feed broadcasts
    // events under. Persisting it on the MediaItem lets the rail/tile
    // correlate a project-side asset back to its in-flight (or
    // historical) materialization progress without re-walking the
    // registry on every render.
    catalogAssetId: assetId,
  };
  mediaItem.proxy = derivatives.proxy;
  mediaItem.filmstripUrl = derivatives.filmstripUrl;
  mediaItem.waveformUrl = derivatives.waveformUrl;

  const next = await updateProjectDocument(projectId, (current) => ({
    ...current,
    assets: [...current.assets, mediaItem],
    updatedAt: new Date().toISOString(),
  }));
  registry.attach(
    assetId,
    { scope: 'video_project', scopeId: projectId },
    input.role ?? 'asset',
  );
  const nextAsset = findCatalogProjectAsset(next.assets, assetId) ?? mediaItem;
  return { project: next, asset: nextAsset, materialization };
}

export async function hydrateReferencedProjectAssets(
  projectId: string,
  mediaItemIds: Iterable<string>,
  input: {
    sessionId?: string;
    clientRequestId?: string;
    role?: string;
  } = {},
): Promise<{
  project: VideoProject;
  assets: MediaItem[];
  materializations: MaterializeResult[];
}> {
  let project = await getProject(projectId);
  const hydratedAssets: MediaItem[] = [];
  const materializations: MaterializeResult[] = [];
  const requested = [...new Set(mediaItemIds)];

  for (const mediaItemId of requested) {
    const current = project.assets.find((row) => row.id === mediaItemId);
    if (!current || !isReferencedProjectAsset(current)) continue;
    const result = await hydrateProjectAsset(projectId, mediaItemId, input);
    project = result.project;
    hydratedAssets.push(result.asset);
    if (result.materialization) materializations.push(result.materialization);
  }

  return { project, assets: hydratedAssets, materializations };
}

// Build a placeholder MediaItem that carries every piece of catalog
// metadata the editor needs to render the rail tile and hover preview,
// but has zero bytes on disk. The frontend differentiates by
// `materializationState === 'referenced'` and the `catalog:<id>` path
// scheme. Hydration uses the catalog asset id stamped in `provenance`
// to flip the row to `materialized` and copy bytes into the project.
function buildReferencedMediaItem(asset: Asset, assetId: string): MediaItem {
  const kind: MediaItem['kind'] =
    asset.kind === 'image'
      ? 'image'
      : asset.kind === 'video'
        ? 'video'
        : 'audio';
  const provenance = parseCatalogProvenance(asset.provenance);
  return {
    id: randomUUID(),
    kind,
    source: 'downloaded',
    path: `${REFERENCED_ASSET_PATH_PREFIX}${assetId}`,
    materializationState: 'referenced',
    bytesTotal: asset.bytes,
    metadata: {
      durationMs: asset.durationMs ?? 0,
      width: asset.width ?? undefined,
      height: asset.height ?? undefined,
      fileSize: asset.bytes,
      // Capture date + GPS come straight from the catalog, so a still-
      // referenced (undownloaded) asset is already orderable/analyzable.
      capturedAt: catalogCapturedAtIso(asset),
      gps: catalogGps(asset),
    },
    provenance: {
      provider: provenance.provider ?? asset.source ?? 'assets',
      sourceUrl: provenance.webUrl ?? `asset:${assetId}`,
      sourceDisplayName: asset.title ?? asset.storagePath ?? asset.id,
      connectionId: asset.connectionId ?? undefined,
      sourceId: asset.sourceId ?? undefined,
      thumbnailUrl: provenance.thumbnailUrl,
      catalogAssetId: assetId,
    },
  };
}

function findCatalogProjectAsset(
  assets: MediaItem[],
  assetId: string,
): MediaItem | undefined {
  const directPath = `${REFERENCED_ASSET_PATH_PREFIX}${assetId}`;
  const matches = assets.filter(
    (asset) =>
      asset.provenance?.catalogAssetId === assetId || asset.path === directPath,
  );
  return matches.reduce<MediaItem | undefined>((best, asset) => {
    if (!best) return asset;
    return catalogProjectAssetScore(asset) > catalogProjectAssetScore(best)
      ? asset
      : best;
  }, undefined);
}

function catalogProjectAssetScore(asset: MediaItem): number {
  let score = asset.materializationState === 'ready' ? 8 : 0;
  if (asset.provenance?.connectionId && asset.provenance.sourceId) score += 4;
  if (asset.provenance?.thumbnailUrl) score += 2;
  if (asset.provenance?.sourceDisplayName) score += 1;
  return score;
}

function withCatalogAttachLock<T>(
  projectId: string,
  assetId: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = `${projectId}:${assetId}`;
  const previous = catalogAttachLocks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  catalogAttachLocks.set(key, next);
  return next.finally(() => {
    if (catalogAttachLocks.get(key) === next) {
      catalogAttachLocks.delete(key);
    }
  });
}

// Use-site hydration. Looks up the project, finds the referenced
// MediaItem, downloads bytes via the materializer (which itself
// in-process singleflights concurrent calls — see `materializer.ts`),
// then rewrites the MediaItem in place so the timeline / agent see it
// as a normal local asset on the next read. Safe to call repeatedly:
// already-ready items short-circuit and return the existing row.
export async function hydrateProjectAsset(
  projectId: string,
  mediaItemId: string,
  input: {
    sessionId?: string;
    clientRequestId?: string;
    role?: string;
  } = {},
): Promise<{
  project: VideoProject;
  asset: MediaItem;
  materialization?: MaterializeResult;
}> {
  const project = await getProject(projectId);
  const existing = project.assets.find((row) => row.id === mediaItemId);
  if (!existing) throw new AssetsError('MediaItem not found', 404);
  if (!shouldHydrateProjectAsset(projectId, existing)) {
    return { project, asset: existing };
  }
  const catalogAssetId = existing.provenance?.catalogAssetId;
  if (!catalogAssetId) {
    throw new AssetsError(
      'MediaItem has no catalog backlink; cannot hydrate',
      400,
    );
  }
  const registry = new AssetRegistry();
  const catalogAsset = registry.get(catalogAssetId);
  if (!catalogAsset) throw new AssetsError('Asset not found', 404);

  const materializer = getAssetMaterializer();
  const materialization = await materializer.materialize({
    assetId: catalogAssetId,
    scope: 'video_project',
    scopeId: projectId,
    reason: 'video_hydrate',
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
    role: input.role ?? 'asset',
    proxies: ['edit_1080p'],
  });
  const destination = await catalogAssetDestination(
    projectId,
    catalogAsset,
    materialization.activePath,
  );
  await materializer.copyInto(materialization, destination);

  // Rebuild the MediaItem against the now-local file so kind / metadata
  // / proxy / filmstrip / waveform all reflect ground truth. The id
  // stays stable so timeline clips that already reference this asset
  // (e.g. an agent that pre-arranged a clip pre-hydration) keep working.
  const hydrated = await mediaItemFromPath(
    destination,
    'downloaded',
    getVideoProjectRoot(projectId),
  );
  hydrated.id = existing.id;
  const derivatives = await readyCatalogDerivatives(
    projectId,
    catalogAssetId,
    catalogAsset,
  );
  const catalogProvenance = parseCatalogProvenance(catalogAsset.provenance);
  hydrated.materializationState = 'ready';
  hydrated.bytesTotal = catalogAsset.bytes;
  // Prefer the catalog's capture date (Immich EXIF takenAt / createdAt) over
  // the local probe — it covers photos too, where the downloaded file often
  // carries no `creation_time` tag. Drives chronological montage ordering.
  const catalogCapturedAt = catalogCapturedAtIso(catalogAsset);
  if (catalogCapturedAt) hydrated.metadata.capturedAt = catalogCapturedAt;
  const hydratedGps = catalogGps(catalogAsset);
  if (hydratedGps) hydrated.metadata.gps = hydratedGps;
  hydrated.provenance = {
    provider: catalogProvenance.provider ?? catalogAsset.source ?? 'assets',
    sourceUrl: catalogProvenance.webUrl ?? `asset:${catalogAssetId}`,
    sourceDisplayName:
      catalogAsset.title ?? catalogAsset.storagePath ?? catalogAsset.id,
    connectionId: catalogAsset.connectionId ?? undefined,
    sourceId: catalogAsset.sourceId ?? undefined,
    thumbnailUrl: catalogProvenance.thumbnailUrl,
    attribution: materialization.license?.attribution ?? catalogAsset.source,
    license: materialization.license?.licenseCode,
    attributionRequired: materialization.license?.attributionRequired ?? false,
    catalogAssetId,
  };
  hydrated.proxy = derivatives.proxy;
  hydrated.filmstripUrl = derivatives.filmstripUrl;
  hydrated.waveformUrl = derivatives.waveformUrl;

  let nextAsset = hydrated;
  const next = await updateProjectDocument(projectId, (current) => {
    const currentRow = current.assets.find((row) => row.id === mediaItemId);
    if (!currentRow) throw new AssetsError('MediaItem not found', 404);
    if (!shouldHydrateProjectAsset(projectId, currentRow)) {
      nextAsset = currentRow;
      return current;
    }
    return {
      ...current,
      assets: current.assets.map((row) =>
        row.id === mediaItemId ? hydrated : row,
      ),
      updatedAt: new Date().toISOString(),
    };
  });
  return { project: next, asset: nextAsset, materialization };
}

// Cancel an in-flight hydration. Looks up the catalog backlink on the
// MediaItem (the materializer keys its single-flight registry on the
// catalog asset id, not the project-side id) and fires the abort
// signal on the in-flight download. Returns true when something was
// actually cancelled. Safe to call when nothing is in flight — the
// frontend uses it from a hover-reveal X on the progress badge.
export function cancelProjectAssetHydration(
  projectId: string,
  catalogAssetId: string,
  role: string = 'asset',
): boolean {
  return getAssetMaterializer().cancel({
    assetId: catalogAssetId,
    scope: 'video_project',
    scopeId: projectId,
    role,
  });
}

// In-process guard so a burst of timeline saves doesn't launch duplicate
// downloads for the same asset. The materializer already singleflights the
// actual transfer, but this also skips the redundant project-document reads.
const timelineHydrationInFlight = new Set<string>();

// Normalize the catalog asset's epoch-ms capture date to an ISO string,
// rejecting null / non-positive / placeholder (<=1971) values.
export function catalogCapturedAtIso(
  asset: Pick<Asset, 'capturedAt'>,
): string | undefined {
  const ms = asset.capturedAt;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0)
    return undefined;
  const date = new Date(ms);
  if (date.getUTCFullYear() <= 1971) return undefined;
  return date.toISOString();
}

// Pull a valid lat/lng off the catalog asset (Immich EXIF GPS), rejecting
// null / non-finite / out-of-range values and the 0,0 null-island default.
export function catalogGps(
  asset: Pick<Asset, 'gpsLat' | 'gpsLng'>,
): { lat: number; lng: number } | undefined {
  const lat = asset.gpsLat;
  const lng = asset.gpsLng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  if (lat === 0 && lng === 0) return undefined;
  return { lat, lng };
}

function collectTimelineAssetIds(
  timeline: VideoTimeline | undefined,
): string[] {
  if (!timeline) return [];
  const ids = new Set<string>();
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.sourceRef.kind === 'asset') ids.add(clip.sourceRef.assetId);
    }
  }
  return [...ids];
}

// Proactively download any reference-only asset that has been placed on the
// timeline so its bytes are local before the user renders or scrubs the
// clip — instead of failing lazily at use-site. Fire-and-forget: call it
// after any timeline mutation. Already-materialized assets short-circuit,
// in-flight ones are de-duped, and assets with no catalog backlink (so
// nothing to download) are skipped.
export function ensureTimelineAssetsHydrated(project: VideoProject): void {
  for (const assetId of collectTimelineAssetIds(project.timeline)) {
    const asset = project.assets.find((row) => row.id === assetId);
    if (!asset) continue;
    if (!shouldHydrateProjectAsset(project.id, asset)) continue;
    if (!asset.provenance?.catalogAssetId) continue;
    const key = `${project.id}:${assetId}`;
    if (timelineHydrationInFlight.has(key)) continue;
    timelineHydrationInFlight.add(key);
    void hydrateProjectAsset(project.id, assetId, { role: 'asset' })
      .then(() => {
        logger.info('video.asset.timeline_hydrate_done', {
          project_id: project.id,
          asset_id: assetId,
        });
      })
      .catch((error) => {
        logger.warn('video.asset.timeline_hydrate_failed', {
          project_id: project.id,
          asset_id: assetId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        timelineHydrationInFlight.delete(key);
      });
  }
}

async function catalogAssetDestination(
  projectId: string,
  asset: Asset,
  sourcePath: string,
): Promise<string> {
  const dir = getVideoAssetsDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(sourcePath) || extensionFromMime(asset.mime);
  // Strip any extension the catalog title already carries (Immich's
  // `originalFileName` / Drive's `name` typically end in `.mp4`, `.jpg`,
  // …). Without this the destination becomes `…-VID.mp4.mp4`, which then
  // confuses every downstream `path.extname` consumer — including
  // `inferKind`, which mis-classifies kind from the doubled `.mp4` tail.
  const rawTitle = asset.title ?? path.basename(sourcePath, ext);
  const trimmedTitle = rawTitle
    ? path.basename(rawTitle, path.extname(rawTitle))
    : 'asset';
  const safeTitle = trimmedTitle
    .replaceAll('\u0000', '_')
    .replace(/[/\\]/g, '_')
    .slice(0, 80);
  const prefix = randomUUID().replace(/-/g, '').slice(0, 8);
  return path.join(dir, `catalog-${prefix}-${safeTitle || 'asset'}${ext}`);
}

interface CatalogProvenanceShape {
  provider?: string;
  webUrl?: string;
  thumbnailUrl?: string;
}

// `asset.provenance` is a JSON blob the catalog stores opaquely. For
// Immich / Box / Drive / Dropbox / OneDrive rows it carries the upstream
// provider id and the original web URL (set by `cloudFileToRemoteAsset`).
// Read them out safely without trusting the shape.
function parseCatalogProvenance(value: unknown): CatalogProvenanceShape {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const provider =
    typeof record.provider === 'string' ? record.provider : undefined;
  const webUrl =
    typeof record.webUrl === 'string' && /^https?:\/\//i.test(record.webUrl)
      ? record.webUrl
      : undefined;
  const thumbnailUrl =
    typeof record.thumbnailUrl === 'string' ? record.thumbnailUrl : undefined;
  return { provider, webUrl, thumbnailUrl };
}

function isVideoMediaKind(kind: Asset['kind']): boolean {
  return kind === 'image' || kind === 'video' || kind === 'audio';
}

function isInputFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith('Input file not found:')
  );
}

async function readyCatalogDerivatives(
  projectId: string,
  assetId: string,
  asset: Asset,
): Promise<{
  proxy?: MediaProxy;
  filmstripUrl?: string;
  waveformUrl?: string;
}> {
  const status = getAssetMaterializeStatus({
    assetId,
    scope: 'video_project',
    scopeId: projectId,
  });
  const proxyRow = status.proxies.find(
    (row) => row.preset === 'edit_1080p' && row.url,
  );
  const proxy = proxyRow
    ? await catalogProxyFromStatusRow(asset, proxyRow)
    : undefined;
  return {
    ...(proxy ? { proxy } : {}),
    ...readyArtifactUrl(status.artifacts, 'filmstrip', 'filmstripUrl'),
    ...readyArtifactUrl(status.artifacts, 'waveform', 'waveformUrl'),
  };
}

async function catalogProxyFromStatusRow(
  asset: Asset,
  row: ReturnType<typeof getAssetMaterializeStatus>['proxies'][number],
): Promise<MediaProxy | undefined> {
  const relativePath = await relativeWorkspacePath(row.proxy_path);
  if (!relativePath) return undefined;
  const durationMs = row.duration_ms ?? asset.durationMs ?? 0;
  return {
    path: relativePath,
    source: 'asset_catalog',
    url: row.url ?? undefined,
    widthPx: row.width ?? asset.width ?? 0,
    heightPx: row.height ?? asset.height ?? 0,
    bitrateBps: bitrateFromBytes(row.bytes, durationMs),
    createdAt: new Date(row.generated_at).toISOString(),
  };
}

async function relativeWorkspacePath(filePath: string): Promise<string | null> {
  const root = await fs
    .realpath(getVideoWorkspaceRoot())
    .catch(() => getVideoWorkspaceRoot());
  const realPath = await fs.realpath(filePath).catch(() => null);
  if (!realPath) return null;
  const relative = path.relative(root, realPath);
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return relative;
}

function readyArtifactUrl<TKey extends 'filmstripUrl' | 'waveformUrl'>(
  artifacts: ReturnType<typeof getAssetMaterializeStatus>['artifacts'],
  kind: 'filmstrip' | 'waveform',
  key: TKey,
): Partial<Record<TKey, string>> {
  const artifact = artifacts.find((row) => row.kind === kind && row.url);
  return artifact?.url ? ({ [key]: artifact.url } as Record<TKey, string>) : {};
}

function bitrateFromBytes(bytes: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.round((bytes * 8 * 1000) / durationMs);
}
