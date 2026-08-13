import {
  isVisualTimelineTrack,
  type VideoMediaItem,
  type VideoProject,
  type VideoSourceMedia,
  type VideoTimeline,
  type VideoTimelineClip,
  type VideoTimelineTrack,
} from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';

import { getProjectTimeline } from './projectTimeline';

export interface ApplyCaptureTimelineInput {
  project: VideoProject;
  source: VideoSourceMedia;
  asset: VideoMediaItem;
  atMs: number;
  targetTrackId?: string | null;
  replaceClipId?: string | null;
  clipId?: string;
}

export interface ApplyCaptureTimelineResult {
  timeline: VideoTimeline;
  trackId: string;
  clipId: string;
  mode: 'insert' | 'replace';
}

export function applyCaptureToTimeline({
  project,
  source,
  asset,
  atMs,
  targetTrackId,
  replaceClipId,
  clipId,
}: ApplyCaptureTimelineInput): ApplyCaptureTimelineResult {
  const timeline = getProjectTimeline(project);
  const sourceDurationMs = captureDurationMs(asset);
  const id = clipId ?? `clip-capture-${source.id}-${randomUUID()}`;
  const sourceRef = { kind: 'asset' as const, assetId: asset.id };

  if (replaceClipId) {
    const replacement = findClip(timeline.tracks, replaceClipId);
    if (!replacement) throw new Error('Selected clip not found');
    if (!trackAcceptsAsset(replacement.track, asset)) {
      throw new Error('Selected track does not accept this capture');
    }
    const clip = buildCaptureClip({
      id,
      asset,
      source,
      startMs: replacement.clip.startMs,
      durationMs: sourceDurationMs,
      sourceDurationMs,
      sceneId: replacement.clip.sceneId,
      sourceRef,
    });
    const tracks = timeline.tracks.map((track) =>
      track.id === replacement.track.id
        ? replaceClipOnTrack(track, replaceClipId, clip)
        : track,
    );
    return {
      timeline: {
        ...timeline,
        tracks,
        durationMs: getTimelineDurationMs(tracks),
      },
      trackId: replacement.track.id,
      clipId: id,
      mode: 'replace',
    };
  }

  const { track, tracks } = resolveTargetTrack(
    timeline.tracks,
    asset,
    targetTrackId,
  );
  const clip = buildCaptureClip({
    id,
    asset,
    source,
    startMs: Math.max(0, Math.round(atMs)),
    durationMs: sourceDurationMs,
    sourceDurationMs,
    sourceRef,
  });
  const nextTracks = tracks.map((item) =>
    item.id === track.id
      ? ({ ...item, clips: [...item.clips, clip] } as VideoTimelineTrack)
      : item,
  );
  return {
    timeline: {
      ...timeline,
      tracks: nextTracks,
      durationMs: getTimelineDurationMs(nextTracks),
    },
    trackId: track.id,
    clipId: id,
    mode: 'insert',
  };
}

function buildCaptureClip(input: {
  id: string;
  asset: VideoMediaItem;
  source: VideoSourceMedia;
  startMs: number;
  durationMs: number;
  sourceDurationMs: number;
  sourceRef: { kind: 'asset'; assetId: string };
  sceneId?: string;
}): VideoTimelineClip {
  const base = {
    id: input.id,
    name: captureClipName(input.source, input.asset),
    sourceRef: input.sourceRef,
    sceneId: input.sceneId,
    startMs: input.startMs,
    durationMs: input.durationMs,
    trimStartMs: 0,
    trimEndMs: input.durationMs,
    sourceDurationMs: input.sourceDurationMs,
    params: {
      captureId: input.source.id,
      origin: 'capture',
    },
  };

  if (input.asset.kind === 'audio') {
    return {
      ...base,
      kind: 'audio',
      fadeInMs: 0,
      fadeOutMs: 0,
    };
  }

  return {
    ...base,
    kind: input.asset.kind === 'image' ? 'image' : 'video',
    muted: false,
  };
}

function resolveTargetTrack(
  tracks: VideoTimelineTrack[],
  asset: VideoMediaItem,
  targetTrackId?: string | null,
): { track: VideoTimelineTrack; tracks: VideoTimelineTrack[] } {
  const requested = targetTrackId
    ? tracks.find((track) => track.id === targetTrackId)
    : undefined;
  if (requested && trackAcceptsAsset(requested, asset)) {
    return { track: requested, tracks };
  }

  const existing = tracks.find((track) => trackAcceptsAsset(track, asset));
  if (existing) return { track: existing, tracks };

  const track = buildCaptureTrack(tracks, asset);
  return { track, tracks: [...tracks, track] };
}

function buildCaptureTrack(
  tracks: VideoTimelineTrack[],
  asset: VideoMediaItem,
): VideoTimelineTrack {
  const visual = asset.kind !== 'audio';
  return {
    id: uniqueTrackId(
      tracks,
      visual ? 'track-video-capture' : 'track-audio-capture',
    ),
    kind: visual ? 'video' : 'audio-vo',
    name: visual ? 'Captured Video' : 'Captured Audio',
    muted: false,
    locked: false,
    order: nextTrackOrder(tracks, visual),
    clips: [],
  } as VideoTimelineTrack;
}

function trackAcceptsAsset(
  track: VideoTimelineTrack,
  asset: VideoMediaItem,
): boolean {
  if (track.locked) return false;
  if (asset.kind === 'audio') return track.kind.startsWith('audio-');
  return isVisualTimelineTrack(track);
}

function replaceClipOnTrack(
  track: VideoTimelineTrack,
  replaceClipId: string,
  clip: VideoTimelineClip,
): VideoTimelineTrack {
  return {
    ...track,
    clips: track.clips.map((item) =>
      item.id === replaceClipId ? clip : item,
    ) as VideoTimelineTrack['clips'],
  } as VideoTimelineTrack;
}

function findClip(
  tracks: VideoTimelineTrack[],
  clipId: string,
): { track: VideoTimelineTrack; clip: VideoTimelineClip } | null {
  for (const track of tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function getTimelineDurationMs(tracks: VideoTimelineTrack[]): number {
  return Math.max(
    0,
    ...tracks.flatMap((track) =>
      track.clips.map((clip) => clip.startMs + clip.durationMs),
    ),
  );
}

function captureDurationMs(asset: VideoMediaItem): number {
  return Math.max(100, Math.round(asset.metadata.durationMs || 1000));
}

function captureClipName(
  source: VideoSourceMedia,
  asset: VideoMediaItem,
): string {
  const durationSec = Math.max(1, Math.round(captureDurationMs(asset) / 1000));
  return `Capture ${source.id.slice(0, 8)} (${durationSec}s)`;
}

function uniqueTrackId(tracks: VideoTimelineTrack[], baseId: string): string {
  const ids = new Set(tracks.map((track) => track.id));
  if (!ids.has(baseId)) return baseId;
  let index = 2;
  while (ids.has(`${baseId}-${index}`)) index += 1;
  return `${baseId}-${index}`;
}

function nextTrackOrder(tracks: VideoTimelineTrack[], visual: boolean): number {
  const matching = tracks.filter((track) =>
    visual ? isVisualTimelineTrack(track) : track.kind.startsWith('audio-'),
  );
  return Math.max(-10, ...matching.map((track) => track.order)) + 10;
}
