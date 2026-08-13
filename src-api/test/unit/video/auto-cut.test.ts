import { applyTimelineOps } from '@neumar/video-ir';
import type { Timeline } from '@neumar/video-ir';
import { describe, expect, it } from 'vitest';

import {
  buildAutoCutCandidates,
  compileSourceCutPlanTimelineOps,
} from '@/shared/video/analysis/auto-cut';
import type {
  CutCandidate,
  SourceCutPlan,
  SourceMediaAnalysis,
} from '@/shared/video/types';

describe('video auto-cut compiler', () => {
  it('builds transcript-backed silence and filler cut candidates', () => {
    const result = buildAutoCutCandidates(analysisFixture());

    expect(result.degraded).toBe(false);
    expect(result.candidates.map((candidate) => candidate.reason)).toEqual([
      'filler',
      'silence',
    ]);
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startMs: 500,
          endMs: 700,
          recommendation: 'cut',
          evidence: [expect.objectContaining({ kind: 'asr' })],
        }),
        expect.objectContaining({
          startMs: 1200,
          endMs: 2600,
          recommendation: 'cut',
          evidence: [expect.objectContaining({ kind: 'asr' })],
        }),
      ]),
    );
  });

  it('compiles approved source cuts into invertible timeline ops', () => {
    const timeline = timelineFixture();
    const cutPlan = cutPlanFixture([
      candidateFixture({ id: 'candidate-1', startMs: 1200, endMs: 2600 }),
    ]);

    const compiled = compileSourceCutPlanTimelineOps({
      timeline,
      cutPlan,
      sourceAssetId: 'asset-source',
      words: analysisFixture().transcript?.words,
      idFactory: () => 'clip-video-right',
    });

    expect(compiled.matchedCandidateIds).toEqual(['candidate-1']);
    expect(compiled.ops).toEqual([
      {
        kind: 'clip.removeTimeRange',
        trackId: 'track-video',
        startMs: 1200,
        endMs: 2600,
        magnetic: true,
        before: [timeline.tracks[0]!.clips[0]],
        after: [
          expect.objectContaining({
            id: 'clip-video',
            startMs: 0,
            durationMs: 1200,
            trimStartMs: 0,
            trimEndMs: 1200,
          }),
          expect.objectContaining({
            id: 'clip-video-right',
            startMs: 1200,
            durationMs: 2400,
            trimStartMs: 2600,
            trimEndMs: 5000,
          }),
        ],
      },
    ]);

    const applied = applyTimelineOps(timeline, compiled.ops).timeline;
    expect(applied.durationMs).toBe(3600);
    expect(applied.tracks[0]?.clips).toEqual([
      expect.objectContaining({ id: 'clip-video', durationMs: 1200 }),
      expect.objectContaining({
        id: 'clip-video-right',
        startMs: 1200,
        durationMs: 2400,
      }),
    ]);
  });

  it('rejects candidates whose edges cut through words', () => {
    expect(() =>
      compileSourceCutPlanTimelineOps({
        timeline: timelineFixture(),
        cutPlan: cutPlanFixture([
          candidateFixture({ id: 'candidate-mid', startMs: 250, endMs: 600 }),
        ]),
        sourceAssetId: 'asset-source',
        words: analysisFixture().transcript?.words,
      }),
    ).toThrow(
      'Cut candidate candidate-mid cuts through 2 word(s): start edge in "hello" (0-500ms); end edge in "um" (500-700ms)',
    );
  });

  it('keeps linked audio and video fragments in matching split link groups', () => {
    let idIndex = 0;
    const compiled = compileSourceCutPlanTimelineOps({
      timeline: linkedTimelineFixture(),
      cutPlan: cutPlanFixture([
        candidateFixture({ id: 'candidate-1', startMs: 1200, endMs: 2600 }),
      ]),
      sourceAssetId: 'asset-source',
      words: analysisFixture().transcript?.words,
      idFactory: () => `generated-${++idIndex}`,
    });

    expect(compiled.ops).toHaveLength(2);
    const videoAfter =
      compiled.ops[0]?.kind === 'clip.removeTimeRange'
        ? compiled.ops[0].after
        : [];
    const audioAfter =
      compiled.ops[1]?.kind === 'clip.removeTimeRange'
        ? compiled.ops[1].after
        : [];
    expect(videoAfter[0]?.linkGroupId).toBe('generated-1');
    expect(audioAfter[0]?.linkGroupId).toBe('generated-1');
    expect(videoAfter[1]?.linkGroupId).toBe('generated-2');
    expect(audioAfter[1]?.linkGroupId).toBe('generated-2');
  });
});

function analysisFixture(): SourceMediaAnalysis {
  return {
    id: 'analysis-1',
    sourceId: 'source-1',
    contentHash: 'hash1',
    durationMs: 5000,
    streams: { durationMs: 5000, audioTrackCount: 1 },
    scenes: [],
    speechRanges: [],
    transcript: {
      engine: 'Local:mock',
      words: [
        { text: 'hello', startMs: 0, endMs: 500 },
        { text: 'um', startMs: 500, endMs: 700 },
        { text: 'there', startMs: 700, endMs: 1200 },
        { text: 'again', startMs: 2600, endMs: 3200 },
      ],
      segments: [],
    },
    visualBeats: [],
    qualitySignals: [],
    duplicateCandidates: [],
    cutCandidates: [],
    generatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function cutPlanFixture(candidates: CutCandidate[]): SourceCutPlan {
  return {
    id: 'cut-plan-1',
    sourceId: 'source-1',
    status: 'approved',
    keepRanges: [],
    cutCandidates: candidates,
    timeMap: { sourceId: 'source-1', keepRanges: [] },
    approvedAt: '2026-07-01T00:00:00.000Z',
  };
}

function candidateFixture(input: {
  id: string;
  startMs: number;
  endMs: number;
}): CutCandidate {
  return {
    id: input.id,
    sourceId: 'source-1',
    startMs: input.startMs,
    endMs: input.endMs,
    reason: 'silence',
    confidence: 0.9,
    destructive: false,
    evidence: [{ kind: 'asr', summary: 'gap', score: 0.9 }],
    recommendation: 'cut',
  };
}

function timelineFixture(): Timeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 5000,
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
            startMs: 0,
            durationMs: 5000,
            trimStartMs: 0,
            trimEndMs: 5000,
            sourceDurationMs: 5000,
          },
        ],
      },
    ],
  };
}

function linkedTimelineFixture(): Timeline {
  return {
    ...timelineFixture(),
    tracks: [
      {
        ...timelineFixture().tracks[0]!,
        clips: [
          {
            ...timelineFixture().tracks[0]!.clips[0]!,
            linkGroupId: 'link-av',
          },
        ],
      },
      {
        id: 'track-audio',
        kind: 'audio-vo',
        name: 'Audio',
        muted: false,
        locked: false,
        order: 1,
        clips: [
          {
            id: 'clip-audio',
            kind: 'audio',
            sourceRef: { kind: 'asset', assetId: 'asset-audio' },
            linkGroupId: 'link-av',
            startMs: 0,
            durationMs: 5000,
            trimStartMs: 0,
            trimEndMs: 5000,
            sourceDurationMs: 5000,
          },
        ],
      },
    ],
  };
}
