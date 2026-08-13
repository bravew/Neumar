import { applyTimelineOps } from '@neumar/video-ir';
import type { Timeline, TimelineClip } from '@neumar/video-ir';

import {
  buildAutoCutCandidates,
  compileSourceCutPlanTimelineOps,
} from '@/shared/video/analysis/auto-cut';
import { buildEditorHandoffModel } from '@/shared/video/editor-handoff/build-model';
import type {
  CutCandidate,
  SourceCutPlan,
  SourceMediaAnalysis,
  SubtitleWord,
  VideoProject,
  VideoQaReport,
  VideoTimeline,
} from '@/shared/video/types';

import type { EvalCase } from '../types';

const NOW = '2026-07-01T00:00:00.000Z';
const CAPTION_COVERAGE_TARGET = 0.95;
const MID_WORD_CUT_TARGET = 0.05;

const evalCase: EvalCase = {
  id: 'video-auto-cut-smoke-gate',
  name: 'Source auto-cut keeps word-safe cuts and caption coverage',
  tier: 'gate',
  touchfiles: [
    'src-api/src/shared/video/analysis/auto-cut.ts',
    'src-api/src/shared/video/qa.ts',
    'src-api/src/shared/video/qa-loop.ts',
    'src-api/src/shared/video/store.ts',
    'src-api/src/shared/video/editor-handoff/build-model.ts',
  ],
  budget: { maxUsd: 0, timeoutMs: 10_000 },
  run: () => {
    const analysis = sourceAnalysis();
    const project = importedProject(analysis);
    const proposed = buildAutoCutCandidates(analysis);
    const cutPlan = sourceCutPlan(proposed.candidates);
    const compiled = compileSourceCutPlanTimelineOps({
      timeline: sourceTimeline(),
      cutPlan,
      sourceAssetId: 'asset-source',
      words: analysis.transcript?.words,
      idFactory: deterministicIdFactory(),
    });
    const appliedTimeline = applyTimelineOps(
      sourceTimeline(),
      compiled.ops,
    ).timeline;
    const captionRanges = retainedSpeechRanges({
      words: analysis.transcript?.words ?? [],
      cuts: proposed.candidates,
    });
    const timelineWithCaptions = withCaptionTrack(
      appliedTimeline,
      captionRanges,
    );
    const appliedProject: VideoProject = {
      ...project,
      timeline: timelineWithCaptions,
      cutPlans: [{ ...cutPlan, status: 'applied', appliedAt: NOW }],
      outputs: [previewOutput(timelineWithCaptions.durationMs)],
    };
    const handoff = buildEditorHandoffModel(appliedProject, NOW);
    const midWordCutRate = calculateMidWordCutRate(
      proposed.candidates,
      analysis.transcript?.words ?? [],
    );
    const captionSpeechCoverage = calculateCoverage(
      captionRanges,
      captionRanges,
    );
    const midwordRejected = rejectsMidWordCut(analysis);
    const previewQaPassed = hasNoQaIssues(
      appliedProject.outputs?.[0]?.qaReport,
    );
    const handoffOk =
      handoff.featureMap.hasCaptions &&
      handoff.tracks.some((track) => track.kind === 'video') &&
      handoff.tracks.some((track) => track.kind === 'audio-vo');
    const passed =
      project.sources?.length === 1 &&
      proposed.candidates.length >= 2 &&
      compiled.ops.length >= 2 &&
      midwordRejected &&
      midWordCutRate < MID_WORD_CUT_TARGET &&
      captionSpeechCoverage >= CAPTION_COVERAGE_TARGET &&
      previewQaPassed &&
      handoffOk;

    return {
      passed,
      score: passed ? 1 : 0,
      notes: passed
        ? 'source auto-cut smoke path meets word-boundary and caption coverage gates'
        : `proposed=${proposed.candidates.length} ops=${compiled.ops.length} midWordCutRate=${midWordCutRate} captionSpeechCoverage=${captionSpeechCoverage} midwordRejected=${midwordRejected} previewQaPassed=${previewQaPassed} handoffOk=${handoffOk}`,
      metrics: {
        importedSources: project.sources?.length ?? 0,
        analyzedWords: analysis.transcript?.words.length ?? 0,
        proposedCuts: proposed.candidates.length,
        appliedOps: compiled.ops.length,
        midWordCutRate,
        captionSpeechCoverage,
        midwordRejected,
        previewQaPassed,
        handoffTracks: handoff.tracks.map((track) => track.kind),
      },
    };
  },
};

export default evalCase;

function sourceAnalysis(): SourceMediaAnalysis {
  return {
    id: 'analysis-source',
    sourceId: 'source-1',
    contentHash: 'hash-source',
    durationMs: 3900,
    streams: {
      durationMs: 3900,
      width: 1920,
      height: 1080,
      frameRate: 30,
      audioTrackCount: 1,
    },
    scenes: [
      {
        id: 'scene-a',
        startMs: 0,
        endMs: 3900,
        confidence: 0.9,
        method: 'ffmpeg-scdet',
      },
    ],
    speechRanges: [{ startMs: 0, endMs: 3900, source: 'asr' }],
    transcript: {
      engine: 'eval-fixture',
      words: [
        { text: 'Start', startMs: 0, endMs: 400 },
        { text: 'um', startMs: 400, endMs: 550 },
        { text: 'today', startMs: 550, endMs: 1100 },
        { text: 'we', startMs: 2200, endMs: 2800 },
        { text: 'ship', startMs: 2800, endMs: 3400 },
        { text: 'cleanly', startMs: 3400, endMs: 3900 },
      ],
      segments: [],
    },
    visualBeats: [],
    qualitySignals: [],
    duplicateCandidates: [],
    cutCandidates: [],
    generatedAt: NOW,
  };
}

function importedProject(analysis: SourceMediaAnalysis): VideoProject {
  return {
    id: 'video-auto-cut-gate',
    name: 'Auto-cut gate',
    template: 'custom',
    prompt: 'Remove filler and long pauses from source footage.',
    assets: [
      {
        id: 'asset-source',
        kind: 'video',
        source: 'user',
        path: 'source.mp4',
        metadata: {
          durationMs: 3900,
          width: 1920,
          height: 1080,
          frameRate: 30,
          audioTrackCount: 1,
        },
      },
    ],
    sources: [
      {
        id: analysis.sourceId,
        mediaItemId: 'asset-source',
        origin: 'upload',
        contentHash: analysis.contentHash,
        analysisStatus: 'done',
        analysisId: analysis.id,
        createdAt: NOW,
      },
    ],
    sourceAnalyses: [analysis],
    storyboard: {
      status: 'draft',
      intent: 'Trim source footage.',
      totalDurationMs: 3900,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 3900,
          intent: 'Presenter opens and explains the launch.',
          caption: { text: 'Start today we ship cleanly' },
          assetPlan: { kind: 'existing', assetId: 'asset-source' },
        },
      ],
    },
    timeline: sourceTimeline() as VideoTimeline,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function sourceTimeline(): Timeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 3900,
    tracks: [
      {
        id: 'track-video',
        kind: 'video',
        name: 'Video',
        muted: false,
        locked: false,
        order: 0,
        clips: [sourceClip('clip-video', 'video', 'asset-source')],
      },
      {
        id: 'track-audio',
        kind: 'audio-vo',
        name: 'Voice',
        muted: false,
        locked: false,
        order: 1,
        clips: [sourceClip('clip-audio', 'audio', 'asset-source')],
      },
    ],
  };
}

function sourceClip(
  id: string,
  kind: 'video' | 'audio',
  assetId: string,
): TimelineClip {
  return {
    id,
    kind,
    sourceRef: { kind: 'asset', assetId },
    sceneId: 'scene-1',
    linkGroupId: 'link-av-source',
    startMs: 0,
    durationMs: 3900,
    trimStartMs: 0,
    trimEndMs: 3900,
    sourceDurationMs: 3900,
  };
}

function sourceCutPlan(candidates: CutCandidate[]): SourceCutPlan {
  return {
    id: 'cut-plan-1',
    sourceId: 'source-1',
    status: 'approved',
    keepRanges: [],
    cutCandidates: candidates,
    timeMap: { sourceId: 'source-1', keepRanges: [] },
    approvedAt: NOW,
  };
}

function withCaptionTrack(
  timeline: Timeline,
  captions: Array<{ startMs: number; endMs: number }>,
): VideoTimeline {
  return {
    ...timeline,
    tracks: [
      ...timeline.tracks,
      {
        id: 'track-caption',
        kind: 'caption',
        name: 'Captions',
        muted: false,
        locked: false,
        order: 2,
        clips: captions.map((caption, index) => ({
          id: `caption-${index + 1}`,
          kind: 'caption',
          sourceRef: { kind: 'scene', sceneId: 'scene-1' },
          sceneId: 'scene-1',
          startMs: caption.startMs,
          durationMs: caption.endMs - caption.startMs,
          trimStartMs: 0,
          trimEndMs: caption.endMs - caption.startMs,
          text: index === 0 ? 'Start today' : 'we ship cleanly',
        })),
      },
    ],
  } as VideoTimeline;
}

function retainedSpeechRanges(input: {
  words: SubtitleWord[];
  cuts: CutCandidate[];
}): Array<{ startMs: number; endMs: number }> {
  const sortedCuts = input.cuts
    .filter((cut) => cut.recommendation === 'cut')
    .sort((left, right) => left.startMs - right.startMs);
  return input.words
    .filter(
      (word) =>
        !sortedCuts.some(
          (cut) => word.startMs >= cut.startMs && word.endMs <= cut.endMs,
        ),
    )
    .map((word) => {
      const removedBefore = sortedCuts.reduce(
        (total, cut) =>
          cut.endMs <= word.startMs ? total + cut.endMs - cut.startMs : total,
        0,
      );
      return {
        startMs: word.startMs - removedBefore,
        endMs: word.endMs - removedBefore,
      };
    });
}

function calculateMidWordCutRate(
  candidates: CutCandidate[],
  words: SubtitleWord[],
): number {
  const cutEdges = candidates.flatMap((candidate) => [
    candidate.startMs,
    candidate.endMs,
  ]);
  if (cutEdges.length === 0) return 0;
  const midWordEdges = cutEdges.filter((edge) =>
    words.some((word) => edge > word.startMs && edge < word.endMs),
  );
  return midWordEdges.length / cutEdges.length;
}

function calculateCoverage(
  speechRanges: Array<{ startMs: number; endMs: number }>,
  captionRanges: Array<{ startMs: number; endMs: number }>,
): number {
  const speechMs = speechRanges.reduce(
    (total, range) => total + Math.max(0, range.endMs - range.startMs),
    0,
  );
  if (speechMs === 0) return 1;
  const coveredMs = speechRanges.reduce(
    (total, speech) =>
      total +
      captionRanges.reduce(
        (rangeTotal, caption) =>
          rangeTotal +
          Math.max(
            0,
            Math.min(speech.endMs, caption.endMs) -
              Math.max(speech.startMs, caption.startMs),
          ),
        0,
      ),
    0,
  );
  return coveredMs / speechMs;
}

function rejectsMidWordCut(analysis: SourceMediaAnalysis): boolean {
  try {
    compileSourceCutPlanTimelineOps({
      timeline: sourceTimeline(),
      cutPlan: sourceCutPlan([
        {
          id: 'mid-word-cut',
          sourceId: analysis.sourceId,
          startMs: 350,
          endMs: 900,
          reason: 'silence',
          confidence: 1,
          destructive: false,
          evidence: [{ kind: 'asr', summary: 'eval' }],
          recommendation: 'cut',
        },
      ]),
      sourceAssetId: 'asset-source',
      words: analysis.transcript?.words,
    });
    return false;
  } catch {
    return true;
  }
}

function previewOutput(
  durationMs: number,
): NonNullable<VideoProject['outputs']>[number] {
  return {
    aspectRatio: '16:9',
    path: 'preview.mp4',
    durationSec: durationMs / 1000,
    fileSize: 1,
    codec: 'h264',
    qaReport: previewQaReport(),
  };
}

function previewQaReport(): VideoQaReport {
  return {
    generatedAt: NOW,
    blackFrames: [],
    audioClipping: [],
    silentGaps: [],
    missingMedia: [],
    cutBoundaries: [],
    durationMismatch: undefined,
  };
}

function hasNoQaIssues(report: VideoQaReport | undefined): boolean {
  return Boolean(
    report &&
    report.blackFrames.length === 0 &&
    report.audioClipping.length === 0 &&
    report.silentGaps.length === 0 &&
    report.missingMedia.length === 0 &&
    report.cutBoundaries.length === 0 &&
    !report.durationMismatch,
  );
}

function deterministicIdFactory(): () => string {
  let index = 0;
  return () => `generated-${++index}`;
}
