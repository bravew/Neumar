import { buildDeleteClipsOps, type TimelineOp } from '@neumar/video-ir';

import type { VideoTimeline } from '@/shared/types/video';

export function buildRemoveSelectedClipOps(
  timeline: VideoTimeline,
  selectedClipIds: Set<string>,
  ripple: boolean,
): TimelineOp[] {
  if (selectedClipIds.size === 0) return [];
  return buildDeleteClipsOps(timeline, {
    clipIds: [...selectedClipIds],
    ripple,
  }).ops;
}
