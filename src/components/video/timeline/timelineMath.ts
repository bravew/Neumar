import { frameToMs, msToFrame } from '@neumar/video-ir';

export const TIMELINE_ZOOM = {
  MIN: 0.5,
  DEFAULT: 80,
  MAX: 800,
  FIT_MARGIN_PX: 160,
} as const;

const MS_PER_SECOND = 1000;
const MIN_DISPLAY_DB = -40;
const WAVEFORM_BAR_EXPONENT = 1.5;

export interface VisibleTimeRange {
  startMs: number;
  endMs: number;
}

export function clampTimelineZoom(pixelsPerSecond: number): number {
  return Math.max(
    TIMELINE_ZOOM.MIN,
    Math.min(TIMELINE_ZOOM.MAX, pixelsPerSecond),
  );
}

export function msToPixels(ms: number, pixelsPerSecond: number): number {
  return (Math.max(0, ms) / MS_PER_SECOND) * pixelsPerSecond;
}

export function pixelsToMs(pixels: number, pixelsPerSecond: number): number {
  if (pixelsPerSecond <= 0) return 0;
  return Math.max(0, Math.round((pixels / pixelsPerSecond) * MS_PER_SECOND));
}

export function snapMsToFrame(
  ms: number,
  fps: number,
  durationMs: number,
): number {
  if (!Number.isFinite(ms) || !Number.isFinite(fps) || fps <= 0) {
    return 0;
  }
  const maxMs =
    Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 0;
  const snapped = msToFrame(Math.max(0, ms), fps);
  return Math.min(maxMs, Math.round(frameToMs(snapped, fps)));
}

export function getVisibleTimeRange(input: {
  scrollX: number;
  viewportWidth: number;
  pixelsPerSecond: number;
}): VisibleTimeRange {
  return {
    startMs: pixelsToMs(input.scrollX, input.pixelsPerSecond),
    endMs: pixelsToMs(
      input.scrollX + input.viewportWidth,
      input.pixelsPerSecond,
    ),
  };
}

export function zoomToFitTimeline(
  durationMs: number,
  viewportWidth: number,
): number {
  const availableWidth = Math.max(
    1,
    viewportWidth - TIMELINE_ZOOM.FIT_MARGIN_PX,
  );
  const durationSeconds = Math.max(1, durationMs / MS_PER_SECOND);
  return clampTimelineZoom(availableWidth / durationSeconds);
}

export function formatTimelineTime(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(totalMs / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / MS_PER_SECOND);
  const tenths = Math.floor((totalMs % MS_PER_SECOND) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

export function getWaveformBarFraction(outputAmplitude: number): number {
  if (outputAmplitude <= 0) return 0;
  const db = 20 * Math.log10(outputAmplitude);
  if (db <= MIN_DISPLAY_DB) return 0;
  return Math.min(
    1,
    ((db - MIN_DISPLAY_DB) / -MIN_DISPLAY_DB) ** WAVEFORM_BAR_EXPONENT,
  );
}
