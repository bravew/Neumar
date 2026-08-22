import { describe, expect, it } from 'vitest';

import type { VideoProject } from '@/shared/types/video';
import { deriveProjectBeatTimelineMs } from '@/shared/video/beatGrid';

describe('project beat grid', () => {
  it('maps a source artifact through the current audio clip timing', () => {
    const project: VideoProject = {
      ...baseProject(),
      sources: [
        {
          id: 'source-1',
          mediaItemId: 'asset-1',
          origin: 'upload',
          contentHash: 'hash-1',
          analysisStatus: 'done',
          createdAt: '2026-08-22T00:00:00.000Z',
        },
      ],
      analysisArtifacts: [
        {
          id: 'beats-1',
          kind: 'beat-markers',
          metadata: {
            beatGrid: {
              schema: 'neuma.video.beat-grid.v1',
              sourceMediaId: 'source-1',
              contentHash: 'hash-1',
              points: [
                { sourceMs: 500, confidence: 0.8 },
                { sourceMs: 1_000, confidence: 0.9 },
              ],
            },
          },
          generatedAt: '2026-08-22T00:00:00.000Z',
        },
      ],
      timeline: {
        schema: 'neuma.video.timeline.v1',
        fps: 30,
        durationMs: 3_000,
        tracks: [
          {
            id: 'music',
            kind: 'audio-music',
            name: 'Music',
            muted: false,
            locked: false,
            order: 0,
            clips: [
              {
                id: 'music-clip',
                kind: 'audio',
                sourceRef: { kind: 'asset', assetId: 'asset-1' },
                startMs: 2_000,
                durationMs: 500,
                trimStartMs: 500,
                trimEndMs: 1_500,
                playback: { speed: 2, reverse: false },
              },
            ],
          },
        ],
      },
    };
    expect(deriveProjectBeatTimelineMs(project)).toEqual([2_000, 2_250]);
  });

  it('invalidates the grid when the source clip is absent', () => {
    expect(
      deriveProjectBeatTimelineMs({
        ...baseProject(),
        analysisArtifacts: [],
        timeline: {
          schema: 'neuma.video.timeline.v1',
          fps: 30,
          durationMs: 1_000,
          tracks: [],
        },
      }),
    ).toEqual([]);
  });
});

function baseProject(): VideoProject {
  return {
    id: 'project-1',
    name: 'Beat project',
    template: 'custom',
    prompt: '',
    assets: [],
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
}
