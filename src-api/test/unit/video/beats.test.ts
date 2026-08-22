import { describe, expect, it } from 'vitest';

import {
  analyzeSourceBeats,
  detectBeatPoints,
} from '@/shared/video/analysis/beats';

describe('beat analysis', () => {
  it('detects bounded source-relative peaks and estimates tempo', () => {
    const peaks = Array.from({ length: 40 }, (_, index) =>
      index % 5 === 2 ? 0.9 : 0.1,
    );
    const points = detectBeatPoints({ bins: 40, durationMs: 4_000, peaks });
    expect(points.map((point) => point.sourceMs)).toEqual([
      250, 750, 1_250, 1_750, 2_250, 2_750, 3_250, 3_750,
    ]);
    expect(points[4]).toMatchObject({ bar: 2, beat: 1 });
  });

  it('creates a versioned artifact anchored to source identity', async () => {
    const result = await analyzeSourceBeats({
      source: {
        id: 'source-1',
        mediaItemId: 'asset-1',
        origin: 'upload',
        contentHash: 'hash-1',
        analysisStatus: 'done',
        createdAt: '2026-08-22T00:00:00.000Z',
      },
      asset: {
        id: 'asset-1',
        kind: 'audio',
        source: 'upload',
        path: 'music.wav',
        metadata: { durationMs: 2_000, audioTrackCount: 1 },
      },
      workspaceRoot: '/workspace',
      now: '2026-08-22T00:00:00.000Z',
      readPeaks: async () => ({
        bins: 20,
        durationMs: 2_000,
        peaks: Array.from({ length: 20 }, (_, index) =>
          index % 5 === 2 ? 0.9 : 0.1,
        ),
      }),
    });
    expect(result.grid).toMatchObject({
      schema: 'neuma.video.beat-grid.v1',
      sourceMediaId: 'source-1',
      contentHash: 'hash-1',
      tempoBpm: 120,
    });
    expect(result.artifact.metadata).toEqual({ beatGrid: result.grid });
  });
});
