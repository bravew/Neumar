import { describe, expect, it } from 'vitest';

import { computeSnapTargets, snapMs, type Timeline } from '../src';

describe('snap helpers', () => {
  it('computes deterministic snap targets and snaps within tolerance', () => {
    const targets = computeSnapTargets(timelineFixture(), {
      playheadMs: 505,
      rangeMs: [250, 750],
    });

    expect(targets).toEqual([
      { ms: 0, kind: 'clip-start', refId: 'clip-a' },
      { ms: 250, kind: 'range-edge' },
      { ms: 500, kind: 'marker', refId: 'marker-a' },
      { ms: 505, kind: 'playhead' },
      { ms: 750, kind: 'range-edge' },
      { ms: 1000, kind: 'clip-end', refId: 'clip-a' },
      { ms: 1200, kind: 'clip-start', refId: 'clip-b' },
      { ms: 2200, kind: 'clip-end', refId: 'clip-b' },
    ]);
    expect(snapMs(508, targets, 10)).toEqual({
      ms: 505,
      snappedTo: { ms: 505, kind: 'playhead' },
    });
    expect(snapMs(508, targets, 2)).toEqual({ ms: 508 });
  });
});

function timelineFixture(): Timeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 2200,
    markers: [{ id: 'marker-a', label: 'Beat', timeMs: 500 }],
    tracks: [
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
            startMs: 0,
            durationMs: 1000,
            trimStartMs: 0,
            trimEndMs: 1000,
          },
          {
            id: 'clip-b',
            kind: 'video',
            sourceRef: { kind: 'asset', assetId: 'asset-b' },
            startMs: 1200,
            durationMs: 1000,
            trimStartMs: 0,
            trimEndMs: 1000,
          },
        ],
      },
    ],
  };
}
