import type { ClipPlayback } from './timeline-types.js';

export interface BeatGridPoint {
  sourceMs: number;
  confidence: number;
  bar?: number;
  beat?: number;
}

export interface BeatGridArtifact {
  schema: 'neuma.video.beat-grid.v1';
  sourceMediaId: string;
  contentHash: string;
  tempoBpm?: number;
  points: BeatGridPoint[];
}

export interface BeatGridClipTiming {
  startMs: number;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  playback?: ClipPlayback;
}

export function deriveBeatTimelinePoints(
  grid: BeatGridArtifact,
  clip: BeatGridClipTiming,
): Array<BeatGridPoint & { timelineMs: number }> {
  const speed = clip.playback?.speed ?? 1;
  const reverse = clip.playback?.reverse === true;
  return grid.points.flatMap((point) => {
    const localSourceMs = reverse
      ? clip.trimEndMs - point.sourceMs
      : point.sourceMs - clip.trimStartMs;
    const timelineMs = clip.startMs + localSourceMs / speed;
    if (
      localSourceMs < 0 ||
      timelineMs < clip.startMs ||
      timelineMs > clip.startMs + clip.durationMs
    ) {
      return [];
    }
    return [{ ...point, timelineMs }];
  });
}
