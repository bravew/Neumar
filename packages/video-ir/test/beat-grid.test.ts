import { describe, expect, it } from 'vitest';

import { deriveBeatTimelinePoints } from '../src/beat-grid.js';

const grid = {
  schema: 'neuma.video.beat-grid.v1' as const,
  sourceMediaId: 'source-1',
  contentHash: 'hash-1',
  tempoBpm: 120,
  points: [
    { sourceMs: 0, confidence: 0.8 },
    { sourceMs: 500, confidence: 0.9 },
    { sourceMs: 1_000, confidence: 0.95 },
    { sourceMs: 1_500, confidence: 0.9 },
  ],
};

describe('beat grid timeline derivation', () => {
  it('follows clip moves, trims, and speed without re-analysis', () => {
    expect(
      deriveBeatTimelinePoints(grid, {
        startMs: 2_000,
        durationMs: 500,
        trimStartMs: 500,
        trimEndMs: 1_500,
        playback: { speed: 2, reverse: false },
      }).map((point) => point.timelineMs),
    ).toEqual([2_000, 2_250, 2_500]);
  });

  it('derives reverse playback positions from trim end', () => {
    expect(
      deriveBeatTimelinePoints(grid, {
        startMs: 1_000,
        durationMs: 1_000,
        trimStartMs: 500,
        trimEndMs: 1_500,
        playback: { speed: 1, reverse: true },
      }).map((point) => point.timelineMs),
    ).toEqual([2_000, 1_500, 1_000]);
  });
});
