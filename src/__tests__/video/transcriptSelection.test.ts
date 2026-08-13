import { describe, expect, it } from 'vitest';

import {
  buildTranscriptTimingContexts,
  resolveTranscriptSelection,
} from '@/components/video/transcriptSelection';
import type { VideoProject } from '@/shared/types/video';

describe('transcript selection timing', () => {
  it('resolves scene selections through source word anchors', () => {
    const contexts = buildTranscriptTimingContexts({
      project: projectFixture(),
      sceneStartByIdMs: new Map([['scene-1', 0]]),
    });
    const selection = resolveTranscriptSelection(
      contexts.get('scene-1')!,
      'hello world',
      6,
      11,
    );

    expect(selection).toMatchObject({
      sceneId: 'scene-1',
      clipId: 'clip-video',
      sourceId: 'source-1',
      startMs: 2300,
      endMs: 2600,
      text: 'world',
      source: 'word',
      wordStartIndex: 1,
      wordEndIndex: 1,
    });
  });

  it('marks proportional timing as degraded when words are unavailable', () => {
    const selection = resolveTranscriptSelection(
      {
        sceneId: 'scene-1',
        sceneStartMs: 1000,
        sceneDurationMs: 2000,
      },
      'hello world',
      6,
      11,
    );

    expect(selection).toMatchObject({
      sceneId: 'scene-1',
      startMs: 2090,
      endMs: 3000,
      text: 'world',
      source: 'proportional',
      degraded: true,
    });
  });

  it('retains source clip context for degraded source selections', () => {
    const project = projectFixture();
    const analysis = project.sourceAnalyses?.[0];
    project.sourceAnalyses = analysis
      ? [{ ...analysis, transcript: { engine: 'fixture', words: [] } }]
      : [];
    const contexts = buildTranscriptTimingContexts({
      project,
      sceneStartByIdMs: new Map([['scene-1', 0]]),
    });
    const selection = resolveTranscriptSelection(
      contexts.get('scene-1')!,
      'hello world',
      0,
      5,
    );

    expect(selection).toMatchObject({
      sceneId: 'scene-1',
      clipId: 'clip-video',
      sourceId: 'source-1',
      text: 'hello',
      source: 'proportional',
      degraded: true,
    });
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Project',
    template: 'custom',
    prompt: '',
    assets: [
      {
        id: 'asset-source',
        kind: 'video',
        source: 'user',
        path: 'source.mp4',
        metadata: { durationMs: 1600 },
      },
    ],
    sources: [
      {
        id: 'source-1',
        mediaItemId: 'asset-source',
        origin: 'upload',
        contentHash: 'hash',
        analysisStatus: 'done',
        analysisId: 'analysis-1',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    sourceAnalyses: [
      {
        id: 'analysis-1',
        sourceId: 'source-1',
        durationMs: 1600,
        scenes: [],
        speechRanges: [],
        transcript: {
          engine: 'fixture',
          words: [
            { text: 'hello', startMs: 1000, endMs: 1300 },
            { text: 'world', startMs: 1300, endMs: 1600 },
          ],
        },
        cutCandidates: [],
      },
    ],
    storyboard: {
      status: 'draft',
      intent: '',
      totalDurationMs: 600,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: [
        {
          id: 'scene-1',
          intent: 'hello world',
          durationMs: 600,
          assetPlan: { kind: 'existing', assetId: 'asset-source' },
        },
      ],
    },
    timeline: {
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: 600,
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
              id: 'clip-video',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'asset-source' },
              sceneId: 'scene-1',
              startMs: 2000,
              durationMs: 600,
              trimStartMs: 1000,
              trimEndMs: 1600,
              sourceDurationMs: 1600,
            },
          ],
        },
      ],
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}
