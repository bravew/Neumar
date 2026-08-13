import type {
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

import type { TimelineSnapResult } from './timelineSnap';

export interface TimelineClientPoint {
  clientX: number;
  clientY: number;
  disableSnap?: boolean;
}

export interface TimelineClipMovePreview {
  clip: VideoTimelineClip;
  track: VideoTimelineTrack;
  baselineClip: VideoTimelineClip;
  deltaMs: number;
  clientX: number;
  clientY: number;
  disableSnap?: boolean;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface TimelineClipDropTarget {
  trackId: string;
  startMs: number;
  accepted: boolean;
}

export interface TimelineClipMoveOverlayState extends TimelineClipMovePreview {
  dropTarget: TimelineClipDropTarget | null;
  snap: TimelineSnapResult | null;
}
