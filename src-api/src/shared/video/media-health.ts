import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { validatePath } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';

import { isExternalAsset } from './asset-files';
import { assertSafeExternalMediaFile } from './linked-sources/local-fs';
import { getVideoProjectRoot } from './store';
import type { MediaItem, VideoProject } from './types';

const logger = createLogger('VideoMediaHealth');

export type MediaHealthState =
  /** Bytes are on disk and readable. */
  | 'ready'
  /** A catalog reference whose bytes have not been fetched yet. */
  | 'referenced'
  /** Bytes are being fetched right now. */
  | 'hydrating'
  /** The file the project points at is not there. */
  | 'missing'
  /** The path is outside what this asset is allowed to read. */
  | 'unreachable'
  /** A previous materialization failed and has not been retried. */
  | 'error';

export interface MediaHealthEntry {
  assetId: string;
  kind: MediaItem['kind'];
  path: string;
  origin: 'managed' | 'external';
  state: MediaHealthState;
  /** Set when the state is not `ready`; safe to show to a user. */
  detail?: string;
  sizeBytes?: number;
  /** True when this asset is referenced by a clip on the timeline. */
  onTimeline: boolean;
  hasMetadata: boolean;
  /** Whether a probe has recorded the asset's dimensions. */
  hasDimensions: boolean;
}

export interface MediaHealthReport {
  schema: 'neuma.video.media-health.v1';
  projectId: string;
  generatedAt: string;
  entries: MediaHealthEntry[];
  summary: {
    total: number;
    ready: number;
    /** Assets a render cannot proceed without: on the timeline and not ready. */
    blockingRender: number;
    missing: number;
    unreachable: number;
    pending: number;
  };
  /** True when nothing on the timeline is missing, unreachable, or pending. */
  renderReady: boolean;
}

/**
 * One media-health pass over a project.
 *
 * Deliberately one report rather than a check per surface: the editor badges,
 * the render-readiness gate, project open, and export all used to answer "is
 * this asset usable" separately, which is how they came to disagree. They now
 * read the same entries, and `blockingRender` is the number the render gate
 * cares about — an offline asset nothing references does not stop a render.
 */
export async function buildMediaHealthReport(
  project: VideoProject,
): Promise<MediaHealthReport> {
  const workspaceRoot = getVideoProjectRoot(project.id);
  const timelineAssetIds = assetIdsOnTimeline(project);

  const entries = await Promise.all(
    project.assets.map((asset) =>
      inspectAsset(asset, workspaceRoot, timelineAssetIds.has(asset.id)),
    ),
  );

  const blocking = entries.filter(
    (entry) => entry.onTimeline && entry.state !== 'ready',
  );
  return {
    schema: 'neuma.video.media-health.v1',
    projectId: project.id,
    generatedAt: new Date().toISOString(),
    entries,
    summary: {
      total: entries.length,
      ready: entries.filter((entry) => entry.state === 'ready').length,
      blockingRender: blocking.length,
      missing: entries.filter((entry) => entry.state === 'missing').length,
      unreachable: entries.filter((entry) => entry.state === 'unreachable')
        .length,
      pending: entries.filter(
        (entry) => entry.state === 'referenced' || entry.state === 'hydrating',
      ).length,
    },
    renderReady: blocking.length === 0,
  };
}

function assetIdsOnTimeline(project: VideoProject): Set<string> {
  const ids = new Set<string>();
  for (const track of project.timeline?.tracks ?? []) {
    for (const clip of track.clips) {
      if (clip.sourceRef.kind === 'asset') ids.add(clip.sourceRef.assetId);
    }
  }
  return ids;
}

async function inspectAsset(
  asset: MediaItem,
  workspaceRoot: string,
  onTimeline: boolean,
): Promise<MediaHealthEntry> {
  const base = {
    assetId: asset.id,
    kind: asset.kind,
    path: asset.path,
    origin: (asset.origin ?? 'managed') as 'managed' | 'external',
    onTimeline,
    hasMetadata: Boolean(asset.metadata?.durationMs),
    hasDimensions: Boolean(asset.metadata?.width && asset.metadata?.height),
  };

  // A materialization state the store already tracks wins: the bytes are known
  // not to be here yet, and probing the filesystem would only confirm it.
  if (asset.materializationState === 'referenced') {
    return { ...base, state: 'referenced', detail: 'Not downloaded yet' };
  }
  if (asset.materializationState === 'hydrating') {
    return { ...base, state: 'hydrating', detail: 'Downloading' };
  }
  if (asset.materializationState === 'error') {
    return { ...base, state: 'error', detail: 'Last download failed' };
  }

  // Existence first, then trust. The trust helpers also require the file to be
  // there, so checking them first would report every moved external master as
  // "not allowed" when the truth is "not found" — two states a user resolves in
  // completely different ways.
  const candidatePath = isExternalAsset(asset)
    ? asset.path
    : path.resolve(workspaceRoot, asset.path);
  let stat: Stats;
  try {
    stat = await fs.stat(candidatePath);
  } catch {
    return {
      ...base,
      state: 'missing',
      detail: isExternalAsset(asset)
        ? 'The original file has moved or the drive is not mounted'
        : 'The file is not in the project folder',
    };
  }
  if (!stat.isFile()) {
    return { ...base, state: 'missing', detail: 'Not a file' };
  }

  try {
    // project.json is editable, so a path that was allowed when it was written
    // may not be allowed now.
    if (isExternalAsset(asset)) assertSafeExternalMediaFile(asset.path);
    else validatePath(asset.path, workspaceRoot, 'read');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn(`Asset ${asset.id} is not reachable: ${detail}`);
    return {
      ...base,
      state: 'unreachable',
      detail: isExternalAsset(asset)
        ? 'This file is outside the folders the app is allowed to read'
        : detail,
    };
  }

  return { ...base, state: 'ready', sizeBytes: stat.size };
}
