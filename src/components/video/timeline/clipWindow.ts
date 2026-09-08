import type { VideoTimelineClip } from '@/shared/types/video';

import { getVisibleTimeRange, pixelsToMs } from './timelineMath';

export interface ClipTimeWindow {
  startMs: number;
  endMs: number;
}

/**
 * Clips sorted by start, with a running maximum end time.
 *
 * The running maximum is what makes a window query cheap: once the search walks
 * back to a clip whose prefix maximum end is at or before the window start, no
 * earlier clip can reach into the window either, so the walk stops. Without it,
 * a long clip near the timeline start would force a full scan on every pointer
 * move, which is the cost this index exists to remove.
 */
export interface ClipIntervalIndex {
  clips: VideoTimelineClip[];
  /** `maxEndMs[i]` is the largest clip end among `clips[0..i]`. */
  maxEndMs: number[];
}

/**
 * Half-open intersection, matching `intersects()` in
 * `src-api/src/shared/video/timeline-window.ts` exactly. A clip that ends the
 * instant the window starts is outside it, on both sides of the app — a second,
 * subtly different definition here is precisely the drift the plan warns about.
 */
export function clipIntersectsWindow(
  clip: Pick<VideoTimelineClip, 'startMs' | 'durationMs'>,
  startMs: number,
  endMs: number,
): boolean {
  return clip.startMs < endMs && clip.startMs + clip.durationMs > startMs;
}

export function buildClipIntervalIndex(
  clips: readonly VideoTimelineClip[],
): ClipIntervalIndex {
  const sorted = [...clips].sort(
    (left, right) =>
      left.startMs - right.startMs || left.id.localeCompare(right.id),
  );
  const maxEndMs: number[] = new Array(sorted.length);
  let running = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < sorted.length; index += 1) {
    const clip = sorted[index]!;
    running = Math.max(running, clip.startMs + clip.durationMs);
    maxEndMs[index] = running;
  }
  return { clips: sorted, maxEndMs };
}

/**
 * The visible time window plus overscan, clamped to the timeline.
 *
 * Overscan is expressed in pixels rather than milliseconds so the same setting
 * keeps roughly one screen's worth of margin at every zoom level: at frame-level
 * zoom a fixed millisecond margin would be enormous, and at fit zoom it would be
 * a sliver.
 */
export function visibleClipWindow(input: {
  scrollX: number;
  viewportWidth: number;
  pixelsPerSecond: number;
  overscanPx: number;
  durationMs: number;
}): ClipTimeWindow {
  const visible = getVisibleTimeRange({
    scrollX: input.scrollX,
    viewportWidth: input.viewportWidth,
    pixelsPerSecond: input.pixelsPerSecond,
  });
  const overscanMs = pixelsToMs(input.overscanPx, input.pixelsPerSecond);
  return {
    startMs: Math.max(0, visible.startMs - overscanMs),
    // Not clamped to durationMs: a clip can extend past the declared duration
    // while it is being trimmed, and clipping the window would make it vanish
    // mid-drag.
    endMs: visible.endMs + overscanMs,
  };
}

/**
 * The clips a track should actually render: everything intersecting the window,
 * plus every pinned clip wherever it sits.
 *
 * Pinning is what keeps an interaction alive when it leaves the window — a clip
 * being dragged, trimmed, or held open by a context menu stays mounted until the
 * interaction ends, so the pointer never lands on an unmounted element.
 */
export function queryClipWindow(
  index: ClipIntervalIndex,
  window: ClipTimeWindow,
  pinnedClipIds?: ReadonlySet<string>,
): VideoTimelineClip[] {
  const { clips, maxEndMs } = index;
  if (clips.length === 0) return [];

  // First clip starting at or after the window end; nothing past it is visible.
  const end = lowerBound(clips, window.endMs);
  const visible: VideoTimelineClip[] = [];
  for (let cursor = end - 1; cursor >= 0; cursor -= 1) {
    if (maxEndMs[cursor]! <= window.startMs) break;
    const clip = clips[cursor]!;
    if (clipIntersectsWindow(clip, window.startMs, window.endMs)) {
      visible.push(clip);
    }
  }
  visible.reverse();

  if (!pinnedClipIds?.size) return visible;
  const present = new Set(visible.map((clip) => clip.id));
  const pinned = clips.filter(
    (clip) => pinnedClipIds.has(clip.id) && !present.has(clip.id),
  );
  if (pinned.length === 0) return visible;
  return [...visible, ...pinned].sort(
    (left, right) =>
      left.startMs - right.startMs || left.id.localeCompare(right.id),
  );
}

/** Index of the first clip whose `startMs` is at or after `ms`. */
function lowerBound(clips: readonly VideoTimelineClip[], ms: number): number {
  let low = 0;
  let high = clips.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (clips[mid]!.startMs < ms) low = mid + 1;
    else high = mid;
  }
  return low;
}
