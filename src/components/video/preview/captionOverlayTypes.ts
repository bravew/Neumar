import type {
  VideoAspectRatio,
  VideoSubtitleStyle,
} from '@/shared/types/video';

export interface CaptionLike {
  id: string;
  text: string;
  style?: VideoSubtitleStyle;
  /**
   * 'primary' = scene.caption, 'overlay' = entry in scene.overlayCaptions,
   * 'timelineClip' = caption clip on the timeline (read via the timeline
   * editor store, persisted with `updateClip`).
   */
  kind: 'primary' | 'overlay' | 'timelineClip';
  /** Only set when kind is 'timelineClip'. */
  clipId?: string;
}

export interface CanvasBounds {
  /** Pixel x/y/w/h of the actual video frame inside the container,
   * letterboxing accounted for. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export const SNAP_TOLERANCE = 0.02; // 2% of canvas
export const SNAP_X = [0.5];
export const SNAP_Y = [0.08, 0.46, 0.82];
export const DEFAULT_FONT_SIZE = 32;

export const ASPECT_RATIO_VALUE: Record<VideoAspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
};
