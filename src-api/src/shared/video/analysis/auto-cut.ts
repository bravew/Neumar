import { createHash, randomUUID } from 'node:crypto';

import { applyTimelineOp, compileTranscriptCut } from '@neumar/video-ir';
import type { Timeline, TimelineOp } from '@neumar/video-ir';

import type {
  CutCandidate,
  SourceCutPlan,
  SourceMediaAnalysis,
  SubtitleWord,
} from '../types';

const MIN_SILENCE_GAP_MS = 900;
const MIN_CUT_DURATION_MS = 120;
const MAX_AUTO_CANDIDATES = 40;
const FILLER_WORDS = new Set([
  'ah',
  'er',
  'erm',
  'hmm',
  'like',
  'uh',
  'um',
  'you know',
]);

export interface AutoCutCandidateBuildResult {
  candidates: CutCandidate[];
  degraded: boolean;
}

export interface CompileSourceCutPlanInput {
  timeline: Timeline;
  cutPlan: SourceCutPlan;
  sourceAssetId: string;
  words?: SubtitleWord[];
  idFactory?: () => string;
}

export interface CompileSourceCutPlanResult {
  ops: TimelineOp[];
  matchedCandidateIds: string[];
}

export function buildAutoCutCandidates(
  analysis: SourceMediaAnalysis,
): AutoCutCandidateBuildResult {
  const words = normalizeWords(analysis.transcript?.words ?? []);
  if (words.length === 0) {
    return { candidates: [], degraded: true };
  }

  const candidates = [
    ...silenceGapCandidates(analysis, words),
    ...fillerWordCandidates(analysis, words),
  ]
    .sort(
      (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
    )
    .slice(0, MAX_AUTO_CANDIDATES);

  return { candidates, degraded: false };
}

export function compileSourceCutPlanTimelineOps(
  input: CompileSourceCutPlanInput,
): CompileSourceCutPlanResult {
  const idFactory = input.idFactory ?? (() => randomUUID());
  const cuts = input.cutPlan.cutCandidates
    .filter((candidate) => candidate.recommendation === 'cut')
    .sort((left, right) => right.startMs - left.startMs);
  if (cuts.length === 0) return { ops: [], matchedCandidateIds: [] };

  let timeline = input.timeline;
  const ops: TimelineOp[] = [];
  const matchedCandidateIds: string[] = [];
  for (const candidate of cuts) {
    assertCandidateNotMidWord(candidate, input.words ?? []);
    const candidateOps = compileCandidateOps({
      timeline,
      candidate,
      sourceAssetId: input.sourceAssetId,
      idFactory,
    });
    if (candidateOps.length === 0) continue;
    matchedCandidateIds.push(candidate.id);
    for (const op of candidateOps) {
      timeline = applyTimelineOp(timeline, op).timeline;
      ops.push(op);
    }
  }

  return { ops, matchedCandidateIds };
}

function silenceGapCandidates(
  analysis: SourceMediaAnalysis,
  words: SubtitleWord[],
): CutCandidate[] {
  const candidates: CutCandidate[] = [];
  for (let index = 1; index < words.length; index++) {
    const previous = words[index - 1]!;
    const next = words[index]!;
    const gap = next.startMs - previous.endMs;
    if (gap < MIN_SILENCE_GAP_MS) continue;
    const startMs = previous.endMs;
    const endMs = next.startMs;
    if (endMs - startMs < MIN_CUT_DURATION_MS) continue;
    candidates.push({
      id: stableCandidateId(analysis.sourceId, 'silence', startMs, endMs),
      sourceId: analysis.sourceId,
      startMs,
      endMs,
      reason: 'silence',
      confidence: Math.min(0.95, 0.55 + gap / 4000),
      destructive: false,
      evidence: [
        {
          kind: 'asr',
          summary: `Transcript gap of ${gap}ms between words.`,
          score: Math.min(0.95, 0.55 + gap / 4000),
        },
      ],
      recommendation: 'cut',
    });
  }
  return candidates;
}

function fillerWordCandidates(
  analysis: SourceMediaAnalysis,
  words: SubtitleWord[],
): CutCandidate[] {
  return words.flatMap((word) => {
    const normalized = normalizeToken(word.text);
    if (!FILLER_WORDS.has(normalized)) return [];
    if (word.endMs - word.startMs < MIN_CUT_DURATION_MS) return [];
    return [
      {
        id: stableCandidateId(
          analysis.sourceId,
          'filler',
          word.startMs,
          word.endMs,
        ),
        sourceId: analysis.sourceId,
        startMs: word.startMs,
        endMs: word.endMs,
        reason: 'filler' as const,
        confidence: 0.7,
        destructive: false as const,
        evidence: [
          {
            kind: 'asr' as const,
            summary: `Filler word "${word.text}" detected in transcript.`,
            score: 0.7,
          },
        ],
        recommendation: 'cut' as const,
      },
    ];
  });
}

function compileCandidateOps(input: {
  timeline: Timeline;
  candidate: CutCandidate;
  sourceAssetId: string;
  idFactory: () => string;
}): TimelineOp[] {
  if (input.candidate.endMs - input.candidate.startMs < MIN_CUT_DURATION_MS) {
    return [];
  }
  return compileTranscriptCut({
    timeline: input.timeline,
    match: { assetIds: [input.sourceAssetId] },
    words: [{ startMs: input.candidate.startMs, endMs: input.candidate.endMs }],
    startIndex: 0,
    endIndex: 0,
    magnetic: true,
    idFactory: input.idFactory,
  });
}

function assertCandidateNotMidWord(
  candidate: Pick<CutCandidate, 'id' | 'startMs' | 'endMs'>,
  words: SubtitleWord[],
): void {
  const violations: string[] = [];
  for (const word of words) {
    const startInside =
      candidate.startMs > word.startMs && candidate.startMs < word.endMs;
    const endInside =
      candidate.endMs > word.startMs && candidate.endMs < word.endMs;
    if (startInside || endInside) {
      const edges = [
        startInside ? 'start' : undefined,
        endInside ? 'end' : undefined,
      ].filter(Boolean);
      violations.push(
        `${edges.join('/')} edge in "${word.text}" (${word.startMs}-${word.endMs}ms)`,
      );
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Cut candidate ${candidate.id} cuts through ${violations.length} word(s): ${violations.join('; ')}`,
    );
  }
}

function normalizeWords(words: SubtitleWord[]): SubtitleWord[] {
  return words
    .filter(
      (word) =>
        word.text.trim().length > 0 &&
        Number.isFinite(word.startMs) &&
        Number.isFinite(word.endMs) &&
        word.endMs >= word.startMs,
    )
    .map((word) => ({
      ...word,
      text: word.text.trim(),
      startMs: Math.round(word.startMs),
      endMs: Math.round(word.endMs),
    }))
    .sort(
      (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
    );
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function stableCandidateId(
  sourceId: string,
  reason: string,
  startMs: number,
  endMs: number,
): string {
  const digest = createHash('sha1')
    .update(`${sourceId}:${reason}:${startMs}:${endMs}`)
    .digest('hex')
    .slice(0, 12);
  return `cut-${digest}`;
}
