import type { PackedTranscriptPayload } from '@/shared/video/analysis/pack-transcript';
import type {
  EvidenceItem,
  ReferenceAnalysis,
  ReferenceCoverage,
  ReferenceTimelineArtifact,
} from '@/shared/video/types';

export const DEFAULT_THIN_GAP_MS = 2000;

export class ReferenceReadingValidationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'out-of-range'
      | 'evidence-overlap'
      | 'unknown-system'
      | 'thin-ranges'
      | 'confidence'
      | 'schema' = 'schema',
    readonly anchor?: string,
  ) {
    super(message);
    this.name = 'ReferenceReadingValidationError';
  }
}

export function computeReferenceCoverage(input: {
  durationMs: number;
  evidence: EvidenceItem[];
  packed?: PackedTranscriptPayload | null;
  thinGapMs?: number;
}): ReferenceCoverage {
  const samples = [
    ...new Set(
      input.evidence
        .flatMap((item) => item.sampledAtMs)
        .filter(Number.isFinite),
    ),
  ].sort((left, right) => left - right);
  const thinGapMs = input.thinGapMs ?? DEFAULT_THIN_GAP_MS;
  const thinRanges: Array<{ startMs: number; endMs: number }> = [];
  let maxGapMs = 0;
  let cursor = 0;
  for (const atMs of samples) {
    const gap = atMs - cursor;
    maxGapMs = Math.max(maxGapMs, gap);
    if (gap > thinGapMs) {
      thinRanges.push({ startMs: cursor, endMs: atMs });
    }
    cursor = atMs;
  }
  const tail = input.durationMs - cursor;
  maxGapMs = Math.max(maxGapMs, tail);
  if (tail > thinGapMs) {
    thinRanges.push({ startMs: cursor, endMs: input.durationMs });
  }
  const transcriptCoveredMs = input.packed
    ? input.packed.phrases.reduce(
        (sum, phrase) => sum + Math.max(0, phrase.endMs - phrase.startMs),
        0,
      )
    : undefined;
  return {
    totalMs: input.durationMs,
    sampleCount: samples.length,
    maxGapMs,
    thinRanges,
    ...(transcriptCoveredMs !== undefined ? { transcriptCoveredMs } : {}),
  };
}

export function validateReferenceAnalysis(
  analysis: ReferenceAnalysis,
  input: {
    durationMs: number;
    evidence: EvidenceItem[];
  },
): void {
  if (analysis.observed.length === 0 && analysis.inferred.length === 0) {
    throw new ReferenceReadingValidationError(
      'Analysis must separate observed facts from inferences.',
      'schema',
      'observed',
    );
  }
  for (const system of analysis.systems) {
    assertConfidence(system.confidence, `system:${system.id}`);
    for (const occurrence of system.occurrences) {
      assertRange(occurrence.startMs, occurrence.endMs, input.durationMs, {
        code: 'out-of-range',
        anchor: `system:${system.id}`,
      });
    }
    assertEvidence(system.evidenceIds, system.occurrences, input.evidence, {
      anchor: `system:${system.id}`,
    });
  }
}

export function validateReferenceTimeline(
  timeline: ReferenceTimelineArtifact,
  input: {
    durationMs: number;
    evidence: EvidenceItem[];
    analysis: ReferenceAnalysis;
    computedCoverage: ReferenceCoverage;
  },
): void {
  const systemIds = new Set(input.analysis.systems.map((system) => system.id));
  for (const section of timeline.sections) {
    assertConfidence(section.confidence, `section:${section.id}`);
    assertRange(section.startMs, section.endMs, input.durationMs, {
      code: 'out-of-range',
      anchor: `section:${section.id}`,
    });
    for (const active of section.activeSystems) {
      if (!systemIds.has(active.systemId)) {
        throw new ReferenceReadingValidationError(
          `Unknown system id "${active.systemId}".`,
          'unknown-system',
          `section:${section.id}`,
        );
      }
    }
    assertEvidence(
      section.evidenceIds,
      [{ startMs: section.startMs, endMs: section.endMs }],
      input.evidence,
      { anchor: `section:${section.id}` },
    );
  }
  assertThinRanges(
    timeline.coverage.thinRanges,
    input.computedCoverage.thinRanges,
  );
}

function assertConfidence(value: number, anchor: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ReferenceReadingValidationError(
      `Confidence must be in [0, 1] at ${anchor}.`,
      'confidence',
      anchor,
    );
  }
}

function assertRange(
  startMs: number,
  endMs: number,
  durationMs: number,
  meta: { code: ReferenceReadingValidationError['code']; anchor: string },
): void {
  if (startMs < 0 || endMs > durationMs || endMs <= startMs) {
    throw new ReferenceReadingValidationError(
      `Time range ${startMs}-${endMs} is outside 0-${durationMs}.`,
      meta.code,
      meta.anchor,
    );
  }
}

function assertEvidence(
  evidenceIds: string[],
  claims: Array<{ startMs: number; endMs: number }>,
  evidence: EvidenceItem[],
  meta: { anchor: string },
): void {
  for (const id of evidenceIds) {
    const item = evidence.find((entry) => entry.id === id);
    if (!item) {
      throw new ReferenceReadingValidationError(
        `Evidence "${id}" does not resolve.`,
        'evidence-overlap',
        meta.anchor,
      );
    }
    const overlaps = claims.some((claim) => rangesOverlap(claim, item.range));
    if (!overlaps) {
      throw new ReferenceReadingValidationError(
        `Evidence "${id}" does not overlap the claim.`,
        'evidence-overlap',
        meta.anchor,
      );
    }
  }
}

function assertThinRanges(
  claimed: Array<{ startMs: number; endMs: number }>,
  computed: Array<{ startMs: number; endMs: number }>,
): void {
  for (const expected of computed) {
    const covered = claimed.some(
      (range) =>
        range.startMs <= expected.startMs && range.endMs >= expected.endMs,
    );
    if (!covered) {
      throw new ReferenceReadingValidationError(
        `thinRanges understated the ${expected.startMs}-${expected.endMs}ms gap.`,
        'thin-ranges',
        `thin:${expected.startMs}-${expected.endMs}`,
      );
    }
  }
}

function rangesOverlap(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}
