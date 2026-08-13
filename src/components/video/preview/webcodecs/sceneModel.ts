import {
  durationMsToFrames,
  localFrameToSourceFrame,
  normalizeClipPlayback,
} from '@neumar/video-ir';

import {
  normalizeVideoTransition,
  videoTransitionRegistryEntry,
  type VideoTransitionParamValue,
  type VideoTransitionDirection,
  type VideoTransitionKind,
  type VideoTransitionTiming,
} from '@/shared/types/video';

import type {
  RemotionPreviewData,
  RemotionVisualClip,
} from '../remotionPreviewData';

type WebCodecsVideoClip = RemotionVisualClip & {
  mediaKind: 'video';
  src: string;
};

type WebCodecsImageClip = RemotionVisualClip & {
  mediaKind: 'image';
  src: string;
};

export type WebCodecsVisualLayer =
  | {
      kind: 'video';
      clip: WebCodecsVideoClip;
      sourceTimeSec: number;
      timelineFrame: number;
    }
  | {
      kind: 'image';
      clip: WebCodecsImageClip;
      timelineFrame: number;
    };

export interface WebCodecsTransitionSeam {
  direction?: VideoTransitionDirection;
  fromClips: WebCodecsVisualLayer[];
  kind: VideoTransitionKind;
  params?: Record<string, VideoTransitionParamValue>;
  progress: number;
  timing?: VideoTransitionTiming;
  toClips: WebCodecsVisualLayer[];
}

interface VisualLayerRangeFrames {
  headFrames?: number;
  tailFrames?: number;
}

export function getActiveWebCodecsVisualLayers(
  data: RemotionPreviewData,
  timelineFrame: number,
): WebCodecsVisualLayer[] {
  const frame = clampFrame(timelineFrame, data.durationInFrames);
  return data.visualClips
    .filter((clip) => isRenderableVisualClipAtFrame(clip, frame))
    .sort((a, b) => a.layer - b.layer || a.id.localeCompare(b.id))
    .map((clip) => toWebCodecsVisualLayer(clip, frame, data.fps))
    .filter((layer): layer is WebCodecsVisualLayer => layer !== null);
}

export function getWebCodecsPreviewUnsupportedReason(
  _data: RemotionPreviewData,
): string | null {
  return null;
}

export function getTransitionSeamAtFrame(
  data: RemotionPreviewData,
  timelineFrame: number,
): WebCodecsTransitionSeam | null {
  const frame = clampFrame(timelineFrame, data.durationInFrames);
  const baseStack = getActiveWebCodecsVisualLayers(data, frame);

  for (const trackClips of visualClipsByTrack(data.visualClips)) {
    for (let index = 0; index < trackClips.length - 1; index += 1) {
      const fromClip = trackClips[index];
      const toClip = trackClips[index + 1];
      if (!fromClip || !toClip) continue;
      const transition = normalizeVideoTransition(fromClip.transitionToNext);
      if (transition.kind === 'cut') continue;

      const transitionFrames = transitionFramesForClip(
        fromClip,
        toClip,
        data.fps,
      );
      if (transitionFrames <= 0) continue;

      const seamFrame = fromClip.fromFrame + fromClip.durationInFrames;
      const overlapStart = seamFrame - transitionFrames / 2;
      const overlapEnd = seamFrame + transitionFrames / 2;
      if (frame < overlapStart || frame >= overlapEnd) continue;

      const handleFrames = Math.ceil(transitionFrames / 2);
      const fromLayer = toWebCodecsVisualLayer(fromClip, frame, data.fps, {
        tailFrames: handleFrames,
      });
      const toLayer = toWebCodecsVisualLayer(toClip, frame, data.fps, {
        headFrames: handleFrames,
      });
      if (!fromLayer || !toLayer) continue;

      return {
        direction: transition.direction,
        fromClips: mergeTransitionStack(baseStack, fromLayer, toClip.id),
        kind: transition.kind,
        ...(transition.params ? { params: transition.params } : {}),
        progress: clamp01((frame - overlapStart) / transitionFrames),
        ...(transition.timing ? { timing: transition.timing } : {}),
        toClips: mergeTransitionStack(baseStack, toLayer, fromClip.id),
      };
    }
  }

  return null;
}

export function transitionFramesForWebCodecsClip(
  clip: Pick<
    RemotionVisualClip,
    'durationInFrames' | 'fromFrame' | 'transitionToNext'
  >,
  nextClip:
    | Pick<RemotionVisualClip, 'durationInFrames' | 'fromFrame'>
    | undefined,
  fps: number,
): number {
  return transitionFramesForClip(clip, nextClip, fps);
}

function isRenderableVisualClipAtFrame(
  clip: RemotionVisualClip,
  frame: number,
): clip is WebCodecsVideoClip | WebCodecsImageClip {
  if (!clip.src || (clip.mediaKind !== 'video' && clip.mediaKind !== 'image')) {
    return false;
  }
  return (
    frame >= clip.fromFrame && frame < clip.fromFrame + clip.durationInFrames
  );
}

function isRenderableVisualClipForRange(
  clip: RemotionVisualClip,
  frame: number,
  range: VisualLayerRangeFrames = {},
): clip is WebCodecsVideoClip | WebCodecsImageClip {
  if (!clip.src || (clip.mediaKind !== 'video' && clip.mediaKind !== 'image')) {
    return false;
  }
  const headFrames = normalizeRangeFrames(range.headFrames);
  const tailFrames = normalizeRangeFrames(range.tailFrames);
  return (
    frame >= clip.fromFrame - headFrames &&
    frame < clip.fromFrame + clip.durationInFrames + tailFrames
  );
}

function toWebCodecsVisualLayer(
  clip: RemotionVisualClip,
  frame: number,
  fps: number,
  range: VisualLayerRangeFrames = {},
): WebCodecsVisualLayer | null {
  if (!isRenderableVisualClipForRange(clip, frame, range)) {
    return null;
  }
  if (clip.mediaKind === 'image') {
    return {
      kind: 'image',
      clip,
      timelineFrame: frame,
    };
  }
  const headFrames = normalizeRangeFrames(range.headFrames);
  const tailFrames = normalizeRangeFrames(range.tailFrames);
  const availableHeadFrames = Math.min(headFrames, clip.sourceStartFrame);
  const trimStartFrame = clip.sourceStartFrame - availableHeadFrames;
  const localFrame = Math.max(
    0,
    frame - (clip.fromFrame - availableHeadFrames),
  );
  return {
    kind: 'video',
    clip,
    sourceTimeSec:
      localFrameToSourceFrame(localFrame, {
        playback: normalizeClipPlayback(clip.playback),
        trimEndFrame: clip.sourceEndFrame + tailFrames,
        trimStartFrame,
      }) / fps,
    timelineFrame: frame,
  };
}

function visualClipsByTrack(
  clips: RemotionVisualClip[],
): RemotionVisualClip[][] {
  const byTrack = new Map<string, RemotionVisualClip[]>();
  for (const clip of clips) {
    byTrack.set(clip.trackId, [...(byTrack.get(clip.trackId) ?? []), clip]);
  }
  return [...byTrack.values()].map((trackClips) =>
    [...trackClips].sort(
      (a, b) => a.fromFrame - b.fromFrame || a.id.localeCompare(b.id),
    ),
  );
}

function transitionFramesForClip(
  clip: Pick<
    RemotionVisualClip,
    'durationInFrames' | 'fromFrame' | 'transitionToNext'
  >,
  nextClip:
    | Pick<RemotionVisualClip, 'durationInFrames' | 'fromFrame'>
    | undefined,
  fps: number,
): number {
  const transition = normalizeVideoTransition(clip.transitionToNext);
  if (!nextClip || transition.kind === 'cut') return 0;
  const contiguousGap =
    nextClip.fromFrame - (clip.fromFrame + clip.durationInFrames);
  if (Math.abs(contiguousGap) > 1) return 0;
  const entry = videoTransitionRegistryEntry(transition.kind);
  const requestedDurationMs = Math.min(
    transition.durationMs ?? entry.defaultDurationMs,
    entry.maxDurationMs,
  );
  const requestedFrames = Math.max(
    1,
    durationMsToFrames(requestedDurationMs, fps),
  );
  return Math.max(
    1,
    Math.min(
      requestedFrames,
      Math.floor(clip.durationInFrames / 2),
      Math.floor(nextClip.durationInFrames / 2),
    ),
  );
}

function mergeTransitionStack(
  baseStack: WebCodecsVisualLayer[],
  replacement: WebCodecsVisualLayer,
  omitClipId: string,
): WebCodecsVisualLayer[] {
  const merged = baseStack
    .filter((layer) => layer.clip.id !== omitClipId)
    .filter((layer) => layer.clip.id !== replacement.clip.id);
  return [...merged, replacement].sort(
    (a, b) => a.clip.layer - b.clip.layer || a.clip.id.localeCompare(b.clip.id),
  );
}

function clampFrame(frame: number, durationInFrames: number): number {
  const maxFrame =
    Number.isFinite(durationInFrames) && durationInFrames > 0
      ? durationInFrames - 1
      : 0;
  if (!Number.isFinite(frame)) return 0;
  return Math.min(Math.max(0, Math.round(frame)), maxFrame);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeRangeFrames(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}
