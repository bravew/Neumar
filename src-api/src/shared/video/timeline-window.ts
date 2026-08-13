import {
  deriveTimelineClipFrameFields,
  durationMsToFrames,
  msToFrame,
  normalizeFrameRate,
  type FrameRate,
} from '@neumar/video-ir';

import {
  vividOverlayContextSummary,
  type VividOverlayContextSummary,
} from '@/shared/video/overlays/context-summary';
import type {
  TimelineClip,
  TimelineTrack,
  VideoProject,
} from '@/shared/video/types';

export interface TimelineWindowInput {
  startMs: number;
  endMs: number;
  trackId?: string;
  limit?: number;
}

export interface TimelineClipSearchInput {
  query: string;
  trackId?: string;
  kind?: TimelineClip['kind'];
  limit?: number;
}

export interface CompactClip {
  id: string;
  k: TimelineClip['kind'];
  s: number;
  d: number;
  startFrame: number;
  durationFrames: number;
  endFrame: number;
  trim: [number, number];
  trimStartFrame: number;
  trimEndFrame: number;
  src: string;
  scene?: string;
  name?: string;
  text?: string;
  overlay?: VividOverlayContextSummary;
}

export interface CompactTrack {
  id: string;
  k: TimelineTrack['kind'];
  clips: CompactClip[];
  truncated: boolean;
}

const DEFAULT_WINDOW_LIMIT = 40;
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_TIMELINE_FPS = 30;

export function buildTimelineWindow(
  project: VideoProject,
  input: TimelineWindowInput,
) {
  assertRange(input.startMs, input.endMs);
  const timeline = project.timeline;
  if (!timeline) {
    return {
      schema: 'neuma.video.timeline-window.v1',
      projectId: project.id,
      timeline: null,
    };
  }
  const limit = clampLimit(input.limit, DEFAULT_WINDOW_LIMIT);
  const frameRate = normalizeFrameRate(
    timeline.frameRate ?? timeline.fps ?? DEFAULT_TIMELINE_FPS,
  );
  const tracks = filterTracks(timeline.tracks, input.trackId).map((track) => {
    const clips = track.clips
      .filter((clip) => intersects(clip, input.startMs, input.endMs))
      .sort((left, right) => left.startMs - right.startMs);
    return {
      id: track.id,
      k: track.kind,
      clips: clips.slice(0, limit).map((clip) => compactClip(clip, frameRate)),
      truncated: clips.length > limit,
    } satisfies CompactTrack;
  });

  return {
    schema: 'neuma.video.timeline-window.v1',
    projectId: project.id,
    range: [roundMs(input.startMs), roundMs(input.endMs)] as const,
    rangeFrames: [
      msToFrame(Math.max(0, input.startMs), frameRate),
      msToFrame(Math.max(0, input.endMs), frameRate),
    ] as const,
    fps: timeline.fps,
    frameRate,
    durationMs: roundMs(timeline.durationMs),
    durationFrames: durationMsToFrames(timeline.durationMs, frameRate),
    markers:
      timeline.markers
        ?.filter(
          (marker) =>
            marker.timeMs >= input.startMs && marker.timeMs <= input.endMs,
        )
        .map((marker) => ({
          id: marker.id,
          t: roundMs(marker.timeMs),
          label: marker.label,
          color: marker.color,
        })) ?? [],
    tracks,
  };
}

export function findTimelineClips(
  project: VideoProject,
  input: TimelineClipSearchInput,
) {
  const timeline = project.timeline;
  if (!timeline) {
    return {
      schema: 'neuma.video.timeline-clip-search.v1',
      projectId: project.id,
      clips: [],
    };
  }
  const query = input.query.trim().toLowerCase();
  const limit = clampLimit(input.limit, DEFAULT_SEARCH_LIMIT);
  const frameRate = normalizeFrameRate(
    timeline.frameRate ?? timeline.fps ?? DEFAULT_TIMELINE_FPS,
  );
  const clips = filterTracks(timeline.tracks, input.trackId)
    .flatMap((track) =>
      track.clips
        .filter((clip) => !input.kind || clip.kind === input.kind)
        .filter((clip) => clipMatches(clip, query))
        .map((clip) => ({
          track: { id: track.id, k: track.kind },
          clip: compactClip(clip, frameRate),
        })),
    )
    .sort((left, right) => left.clip.s - right.clip.s)
    .slice(0, limit);

  return {
    schema: 'neuma.video.timeline-clip-search.v1',
    projectId: project.id,
    query: input.query,
    fps: timeline.fps,
    frameRate,
    clips,
  };
}

function filterTracks(
  tracks: TimelineTrack[],
  trackId: string | undefined,
): TimelineTrack[] {
  return trackId ? tracks.filter((track) => track.id === trackId) : tracks;
}

function compactClip(clip: TimelineClip, frameRate: FrameRate): CompactClip {
  const frameFields = deriveTimelineClipFrameFields(clip, frameRate);
  const overlay = vividOverlayContextSummary(clip);
  return {
    id: clip.id,
    k: clip.kind,
    s: roundMs(clip.startMs),
    d: roundMs(clip.durationMs),
    startFrame: frameFields.startFrame,
    durationFrames: frameFields.durationFrames,
    endFrame: frameFields.endFrame,
    trim: [roundMs(clip.trimStartMs), roundMs(clip.trimEndMs)],
    trimStartFrame: frameFields.trimStartFrame,
    trimEndFrame: frameFields.trimEndFrame,
    src: compactSourceRef(clip.sourceRef),
    scene: clip.sceneId,
    name: clip.name,
    text: clipText(clip),
    ...(overlay ? { overlay } : {}),
  };
}

function compactSourceRef(sourceRef: TimelineClip['sourceRef']): string {
  switch (sourceRef.kind) {
    case 'asset':
      return `asset:${sourceRef.assetId}`;
    case 'linked':
      return `linked:${sourceRef.sourceId}:${sourceRef.externalId}`;
    case 'scene':
      return `scene:${sourceRef.sceneId}`;
    default: {
      const exhaustive: never = sourceRef;
      return exhaustive;
    }
  }
}

function clipText(clip: TimelineClip): string | undefined {
  if (clip.kind === 'caption') return clip.text;
  if (clip.kind === 'audio') return clip.transcriptText;
  return undefined;
}

function clipMatches(clip: TimelineClip, query: string): boolean {
  if (!query) return true;
  return [
    clip.id,
    clip.name,
    clip.sceneId,
    compactSourceRef(clip.sourceRef),
    clipText(clip),
    JSON.stringify(clip.params ?? {}),
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(query));
}

function intersects(clip: TimelineClip, startMs: number, endMsValue: number) {
  return clip.startMs < endMsValue && clip.startMs + clip.durationMs > startMs;
}

function assertRange(startMs: number, endMsValue: number): void {
  if (endMsValue <= startMs) {
    throw new Error('Timeline window endMs must be greater than startMs');
  }
}

function clampLimit(limit: number | undefined, fallback: number): number {
  return Math.min(Math.max(limit ?? fallback, 1), 100);
}

function roundMs(value: number): number {
  return Math.round(value);
}
