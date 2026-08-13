import type { VideoTimelineTrack } from '@/shared/types/video';

import { EXTRA_TIMELINE_WIDTH, RULER_HEIGHT } from './timelineLayout';
import { msToPixels } from './timelineMath';

export function getTimelineCanvasMetrics(
  durationMs: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  tracks: VideoTimelineTrack[],
  getTrackHeight: (track: VideoTimelineTrack) => number,
) {
  const timelineDurationMs = Math.max(durationMs, 10_000);
  const timelineWidth = Math.max(
    viewportWidth,
    msToPixels(timelineDurationMs, pixelsPerSecond) + EXTRA_TIMELINE_WIDTH,
  );
  const tracksHeightSum = tracks.reduce(
    (sum, track) => sum + getTrackHeight(track),
    0,
  );
  return {
    timelineDurationMs,
    timelineWidth,
    totalHeight: Math.max(RULER_HEIGHT + tracksHeightSum, 160),
  };
}
