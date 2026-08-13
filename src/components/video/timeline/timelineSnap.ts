import type {
  VideoTimelineMarker,
  VideoTimelineTrack,
} from '@/shared/types/video';

import { pixelsToMs } from './timelineMath';

export type TimelineSnapEdge = 'start' | 'end';
export type TimelineSnapTargetKind =
  | 'clip-end'
  | 'clip-start'
  | 'marker'
  | 'playhead'
  | 'timeline-end'
  | 'timeline-start';

export interface TimelineSnapTarget {
  timeMs: number;
  kind: TimelineSnapTargetKind;
}

export interface TimelineSnapResult {
  target: TimelineSnapTarget;
  edge: TimelineSnapEdge;
  deltaMs: number;
}

export function computeTimelineSnap(input: {
  candidateStartMs: number;
  durationMs: number;
  targets: TimelineSnapTarget[];
  toleranceMs: number;
}): TimelineSnapResult | null {
  const edges: Array<{ edge: TimelineSnapEdge; timeMs: number }> = [
    { edge: 'start', timeMs: input.candidateStartMs },
    { edge: 'end', timeMs: input.candidateStartMs + input.durationMs },
  ];
  let best: TimelineSnapResult | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const edge of edges) {
    for (const target of input.targets) {
      const deltaMs = target.timeMs - edge.timeMs;
      const distance = Math.abs(deltaMs);
      if (distance > input.toleranceMs || distance >= bestDistance) continue;
      bestDistance = distance;
      best = { target, edge: edge.edge, deltaMs };
    }
  }

  return best;
}

export function getTimelineSnapToleranceMs(
  snapTolerancePx: number,
  pixelsPerSecond: number,
): number {
  return pixelsToMs(snapTolerancePx, pixelsPerSecond);
}

export function buildTimelineSnapTargets(input: {
  tracks: VideoTimelineTrack[];
  movingClipIds: Set<string>;
  playheadMs: number;
  durationMs: number;
  markers?: VideoTimelineMarker[];
}): TimelineSnapTarget[] {
  const targets: TimelineSnapTarget[] = [
    { timeMs: 0, kind: 'timeline-start' },
    { timeMs: input.durationMs, kind: 'timeline-end' },
    { timeMs: input.playheadMs, kind: 'playhead' },
  ];
  for (const marker of input.markers ?? []) {
    targets.push({ timeMs: marker.timeMs, kind: 'marker' });
  }
  for (const track of input.tracks) {
    for (const clip of track.clips) {
      if (input.movingClipIds.has(clip.id)) continue;
      targets.push({ timeMs: clip.startMs, kind: 'clip-start' });
      targets.push({
        timeMs: clip.startMs + clip.durationMs,
        kind: 'clip-end',
      });
    }
  }
  return targets;
}
