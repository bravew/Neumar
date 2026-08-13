import type {
  VideoAspectRatio,
  VideoProject,
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';

import type { LinkedAssetDragPayload } from '../linkedAssetDrag';
import { inferDefaultVisualAssetTransform } from './visualAssetFit';

export type DroppableMediaKind = 'image' | 'video' | 'audio';
export const DEFAULT_IMAGE_CLIP_DURATION_MS = 5000;
export const DEFAULT_VIDEO_CLIP_DURATION_MS = 1000;
export const DEFAULT_AUDIO_CLIP_DURATION_MS = 1000;

interface DroppedAssetClipOptions {
  aspectRatio?: VideoAspectRatio;
  durationMs?: number;
}

export function linkedAssetKindMatchesTrack(
  kind: LinkedAssetDragPayload['kind'],
  track: VideoTimelineTrack,
): boolean {
  return mediaKindMatchesTrack(kind, track);
}

export function mediaKindMatchesTrack(
  kind: DroppableMediaKind,
  track: VideoTimelineTrack,
): boolean {
  if (kind === 'audio') {
    return (
      track.kind === 'audio-vo' ||
      track.kind === 'audio-music' ||
      track.kind === 'audio-sfx'
    );
  }
  return (
    track.kind === 'video' || track.kind === 'broll' || track.kind === 'overlay'
  );
}

export function timelineClipFromDroppedAsset(
  asset: VideoProject['assets'][number],
  track: VideoTimelineTrack,
  startMs: number,
  options: DroppedAssetClipOptions = {},
): VideoTimelineClip | null {
  const durationMs = defaultClipDurationMs(asset, options.durationMs);
  const base = {
    id: `clip-linked-${asset.id}-${randomUUID()}`,
    name: assetName(asset),
    sourceRef: { kind: 'asset' as const, assetId: asset.id },
    startMs: Math.max(0, Math.round(startMs)),
    durationMs,
    trimStartMs: 0,
    trimEndMs: durationMs,
    sourceDurationMs: durationMs,
  };

  if (
    (track.kind === 'video' ||
      track.kind === 'broll' ||
      track.kind === 'overlay') &&
    (asset.kind === 'image' || asset.kind === 'video')
  ) {
    const transforms = inferDefaultVisualAssetTransform(
      asset,
      options.aspectRatio ?? '16:9',
    );
    return {
      ...base,
      kind: asset.kind,
      ...(transforms ? { transforms } : {}),
      muted: false,
    };
  }

  if (
    (track.kind === 'audio-vo' ||
      track.kind === 'audio-music' ||
      track.kind === 'audio-sfx') &&
    asset.kind === 'audio'
  ) {
    return {
      ...base,
      kind: 'audio',
      fadeInMs: 30,
      fadeOutMs: 30,
    };
  }

  return null;
}

export function hydratedDroppedAssetDurationPatch(
  clip: VideoTimelineClip,
  asset: VideoProject['assets'][number],
): Partial<VideoTimelineClip> | null {
  if (clip.sourceRef.kind !== 'asset' || clip.sourceRef.assetId !== asset.id) {
    return null;
  }
  if (asset.kind === 'image') return null;
  const nextDurationMs = positiveDurationMs(asset.metadata.durationMs);
  if (!nextDurationMs) return null;
  const fallbackDurationMs =
    asset.kind === 'audio'
      ? DEFAULT_AUDIO_CLIP_DURATION_MS
      : DEFAULT_VIDEO_CLIP_DURATION_MS;
  const untouchedPlaceholder =
    clip.durationMs === fallbackDurationMs &&
    clip.sourceDurationMs === fallbackDurationMs &&
    clip.trimStartMs === 0 &&
    clip.trimEndMs === fallbackDurationMs;
  if (!untouchedPlaceholder || nextDurationMs === fallbackDurationMs) {
    return null;
  }
  return {
    durationMs: nextDurationMs,
    trimEndMs: nextDurationMs,
    sourceDurationMs: nextDurationMs,
  };
}

function defaultClipDurationMs(
  asset: VideoProject['assets'][number],
  preferredDurationMs?: number,
): number {
  const durationMs =
    positiveDurationMs(preferredDurationMs) ??
    positiveDurationMs(asset.metadata.durationMs);
  if (asset.kind === 'image')
    return Math.max(1000, durationMs ?? DEFAULT_IMAGE_CLIP_DURATION_MS);
  if (asset.kind === 'audio')
    return Math.max(100, durationMs ?? DEFAULT_AUDIO_CLIP_DURATION_MS);
  return Math.max(100, durationMs ?? DEFAULT_VIDEO_CLIP_DURATION_MS);
}

function assetName(asset: VideoProject['assets'][number]): string {
  const displayName = asset.provenance?.sourceDisplayName?.trim();
  const source = displayName || asset.path;
  return source.split(/[\\/]/).pop() ?? asset.id;
}

function positiveDurationMs(durationMs: number | undefined): number | null {
  return typeof durationMs === 'number' && durationMs > 0
    ? Math.round(durationMs)
    : null;
}

/**
 * Upload native OS files and return the timeline clips to insert on the given
 * track. Diffs against the existing asset list so we only insert the assets we
 * just uploaded. Returns an empty array if nothing matches the track kind.
 */
export async function uploadFilesAndBuildClips(
  files: File[],
  track: VideoTimelineTrack,
  startMs: number,
  project: VideoProject,
  uploadAssets: (files: FileList | File[]) => Promise<VideoProject | null>,
  options: DroppedAssetClipOptions = {},
): Promise<VideoTimelineClip[]> {
  if (files.length === 0) return [];
  const existingIds = new Set(project.assets.map((asset) => asset.id));
  const updated = await uploadAssets(files);
  if (!updated) return [];
  const out: VideoTimelineClip[] = [];
  let cursorMs = Math.max(0, Math.round(startMs));
  for (const asset of updated.assets) {
    if (existingIds.has(asset.id)) continue;
    const clip = timelineClipFromDroppedAsset(asset, track, cursorMs, options);
    if (!clip) continue;
    out.push(clip);
    cursorMs += clip.durationMs;
  }
  return out;
}
