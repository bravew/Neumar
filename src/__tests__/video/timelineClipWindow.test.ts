import { describe, expect, it } from 'vitest';

import {
  buildClipIntervalIndex,
  clipIntersectsWindow,
  queryClipWindow,
  visibleClipWindow,
} from '@/components/video/timeline/clipWindow';
import type { VideoTimelineClip } from '@/shared/types/video';

function clip(id: string, startMs: number, durationMs: number) {
  return {
    id,
    kind: 'video',
    sourceRef: { kind: 'asset', assetId: 'asset-1' },
    startMs,
    durationMs,
    trimStartMs: 0,
    trimEndMs: durationMs,
    sourceDurationMs: durationMs,
  } as VideoTimelineClip;
}

describe('clipIntersectsWindow', () => {
  it('treats the window as half-open, like the API window query', () => {
    // A clip that ends exactly when the window starts is outside it.
    expect(clipIntersectsWindow(clip('a', 0, 1000), 1000, 2000)).toBe(false);
    // A clip that starts exactly when the window ends is outside it.
    expect(clipIntersectsWindow(clip('a', 2000, 1000), 1000, 2000)).toBe(false);
    expect(clipIntersectsWindow(clip('a', 900, 200), 1000, 2000)).toBe(true);
    expect(clipIntersectsWindow(clip('a', 1900, 200), 1000, 2000)).toBe(true);
  });

  it('includes a clip that spans the whole window', () => {
    expect(clipIntersectsWindow(clip('a', 0, 10_000), 1000, 2000)).toBe(true);
  });
});

describe('queryClipWindow', () => {
  const clips = [
    clip('c-0', 0, 500),
    clip('c-1', 1000, 500),
    clip('c-2', 2000, 500),
    clip('c-3', 3000, 500),
    clip('c-4', 4000, 500),
  ];
  const index = buildClipIntervalIndex(clips);

  it('returns only the clips inside the window, in timeline order', () => {
    expect(
      queryClipWindow(index, { startMs: 1200, endMs: 3200 }).map(
        (entry) => entry.id,
      ),
    ).toEqual(['c-1', 'c-2', 'c-3']);
  });

  it('returns nothing when the window falls in a gap', () => {
    expect(queryClipWindow(index, { startMs: 600, endMs: 900 })).toEqual([]);
  });

  it('finds a long clip that starts far before the window', () => {
    // The running maximum end is what lets the walk reach back this far.
    const longIndex = buildClipIntervalIndex([
      clip('long', 0, 60_000),
      ...clips,
    ]);

    expect(
      queryClipWindow(longIndex, { startMs: 50_000, endMs: 51_000 }).map(
        (entry) => entry.id,
      ),
    ).toEqual(['long']);
  });

  it('keeps a pinned clip mounted outside the window', () => {
    expect(
      queryClipWindow(
        index,
        { startMs: 1200, endMs: 1400 },
        new Set(['c-4']),
      ).map((entry) => entry.id),
    ).toEqual(['c-1', 'c-4']);
  });

  it('does not duplicate a pinned clip that is already visible', () => {
    expect(
      queryClipWindow(
        index,
        { startMs: 1200, endMs: 2200 },
        new Set(['c-1', 'c-2']),
      ).map((entry) => entry.id),
    ).toEqual(['c-1', 'c-2']);
  });

  it('handles an empty track', () => {
    expect(
      queryClipWindow(buildClipIntervalIndex([]), {
        startMs: 0,
        endMs: 1000,
      }),
    ).toEqual([]);
  });

  it('bounds the rendered count by the window, not the timeline size', () => {
    const many = Array.from({ length: 1000 }, (_, position) =>
      clip(`clip-${position}`, position * 1000, 800),
    );
    const manyIndex = buildClipIntervalIndex(many);

    const visible = queryClipWindow(manyIndex, {
      startMs: 500_000,
      endMs: 510_000,
    });

    expect(visible).toHaveLength(10);
    expect(visible[0]?.id).toBe('clip-500');
  });
});

describe('visibleClipWindow', () => {
  it('adds overscan on both sides in pixel terms', () => {
    expect(
      visibleClipWindow({
        scrollX: 800,
        viewportWidth: 800,
        pixelsPerSecond: 80,
        overscanPx: 400,
        durationMs: 60_000,
      }),
    ).toEqual({ startMs: 5000, endMs: 25_000 });
  });

  it('never starts before the timeline', () => {
    expect(
      visibleClipWindow({
        scrollX: 0,
        viewportWidth: 800,
        pixelsPerSecond: 80,
        overscanPx: 400,
        durationMs: 60_000,
      }).startMs,
    ).toBe(0);
  });

  it('keeps the same pixel margin at frame-level zoom', () => {
    const zoomed = visibleClipWindow({
      scrollX: 0,
      viewportWidth: 800,
      pixelsPerSecond: 800,
      overscanPx: 400,
      durationMs: 60_000,
    });

    // 400px at 800px/s is half a second, not the 5s it would be at 80px/s.
    expect(zoomed.endMs).toBe(1500);
  });

  it('does not clamp the end to the declared duration', () => {
    // A clip being trimmed can run past the declared end; clamping would
    // unmount it mid-drag.
    expect(
      visibleClipWindow({
        scrollX: 0,
        viewportWidth: 800,
        pixelsPerSecond: 80,
        overscanPx: 400,
        durationMs: 1000,
      }).endMs,
    ).toBe(15_000);
  });
});
