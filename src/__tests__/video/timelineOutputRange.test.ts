import { describe, expect, it } from 'vitest';

import {
  countResnappedBoundaries,
  msToTimelineFrame,
  outputRangePixels,
  setOutputIn,
  setOutputOut,
  timelineFrameRate,
} from '@/components/video/timeline/outputRange';
import type { VideoTimeline } from '@/shared/types/video';

const RATE_30 = { num: 30, den: 1 };
const RATE_2997 = { num: 30_000, den: 1001 };

function timelineFixture(
  overrides: Partial<VideoTimeline> = {},
): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 10_000,
    fps: 30,
    tracks: [],
    ...overrides,
  };
}

describe('timelineFrameRate', () => {
  it('prefers the rational rate over the numeric compatibility field', () => {
    expect(timelineFrameRate({ fps: 29.97, frameRate: RATE_2997 })).toEqual(
      RATE_2997,
    );
  });

  it('falls back to the numeric fps, then to 30', () => {
    expect(timelineFrameRate({ fps: 25 })).toBe(25);
    expect(timelineFrameRate(undefined)).toBe(30);
  });
});

describe('outputRangePixels', () => {
  it('paints nothing when no range is set', () => {
    expect(outputRangePixels(timelineFixture())).toBeNull();
  });

  it('paints nothing when the range covers the whole timeline', () => {
    expect(
      outputRangePixels(
        timelineFixture({
          outputRange: { inFrame: 0, outFrameExclusive: 300 },
        }),
      ),
    ).toBeNull();
  });

  it('reports both excluded spans', () => {
    const pixels = outputRangePixels(
      timelineFixture({ outputRange: { inFrame: 30, outFrameExclusive: 240 } }),
    );

    expect(pixels).toEqual({
      inMs: 1000,
      outMs: 8000,
      headMs: 1000,
      tailMs: 2000,
    });
  });

  it('clamps a range that runs past the timeline end', () => {
    const pixels = outputRangePixels(
      timelineFixture({ outputRange: { inFrame: 30, outFrameExclusive: 900 } }),
    );

    expect(pixels?.outMs).toBe(10_000);
    expect(pixels?.tailMs).toBe(0);
  });
});

describe('setOutputIn and setOutputOut', () => {
  it('marks the frame under the playhead as the first rendered frame', () => {
    expect(setOutputIn(undefined, 2000, RATE_30, 10_000)).toEqual({
      inFrame: 60,
      outFrameExclusive: 300,
    });
  });

  it('includes the frame under the playhead when marking out', () => {
    expect(setOutputOut(undefined, 2000, RATE_30, 10_000)).toEqual({
      inFrame: 0,
      outFrameExclusive: 61,
    });
  });

  it('pushes the out point when an in point lands past it', () => {
    const range = { inFrame: 0, outFrameExclusive: 30 };

    expect(setOutputIn(range, 5000, RATE_30, 10_000)).toEqual({
      inFrame: 150,
      outFrameExclusive: 151,
    });
  });

  it('pulls the in point when an out point lands before it', () => {
    const range = { inFrame: 150, outFrameExclusive: 300 };

    expect(setOutputOut(range, 1000, RATE_30, 10_000)).toEqual({
      inFrame: 30,
      outFrameExclusive: 31,
    });
  });

  it('never lets the in point sit on the last frame with nothing after it', () => {
    const range = setOutputIn(undefined, 999_999, RATE_30, 10_000);

    expect(range.inFrame).toBe(299);
    expect(range.outFrameExclusive).toBe(300);
  });

  it('uses exact NTSC frame boundaries', () => {
    // One second at 30000/1001 is 29 whole frames, not 30.
    expect(msToTimelineFrame(1000, RATE_2997)).toBe(29);
    expect(setOutputIn(undefined, 1000, RATE_2997, 10_000).inFrame).toBe(29);
  });
});

describe('countResnappedBoundaries', () => {
  const tracks: VideoTimeline['tracks'] = [
    {
      id: 'track-video',
      kind: 'video',
      name: 'Video',
      muted: false,
      locked: false,
      order: 0,
      clips: [
        {
          id: 'clip-a',
          kind: 'video',
          sourceRef: { kind: 'asset', assetId: 'asset-a' },
          startMs: 1000,
          durationMs: 2000,
          trimStartMs: 0,
          trimEndMs: 2000,
          sourceDurationMs: 2000,
        },
      ],
    },
  ];

  it('reports nothing to re-snap when the rate is unchanged', () => {
    expect(
      countResnappedBoundaries({ tracks }, RATE_30, { num: 60, den: 2 }),
    ).toBe(0);
  });

  it('counts the boundaries an NTSC change would move', () => {
    // 1000ms and 3000ms are both whole frames at 30, neither at 30000/1001.
    expect(countResnappedBoundaries({ tracks }, RATE_30, RATE_2997)).toBe(2);
  });

  it('counts nothing when the boundaries already land on the new grid', () => {
    expect(
      countResnappedBoundaries({ tracks }, RATE_30, { num: 25, den: 1 }),
    ).toBe(0);
  });
});
