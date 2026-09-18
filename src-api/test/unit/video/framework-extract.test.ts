import { describe, expect, it } from 'vitest';

import {
  assertReadingReadyForFramework,
  derivePacing,
  FrameworkExtractError,
  normalizeProportions,
} from '@/shared/video/reference/framework-extract';
import type {
  FrameworkSection,
  ReferenceBoundaries,
  ReferenceTimelineArtifact,
} from '@/shared/video/types';
import { REFERENCE_READING_PROMPT_VERSION } from '@/shared/video/types';

function section(
  patch: Partial<FrameworkSection> & { observedMs: number },
): FrameworkSection {
  return {
    id: patch.id ?? 'sec',
    role: patch.role ?? 'context',
    purpose: 'Move the argument.',
    timing: {
      proportion: 0,
      minMs: 100,
      maxMs: 4000,
      observedMs: patch.observedMs,
    },
    slots: [
      {
        id: 'slot-1',
        kind: 'a-roll',
        constraints: {},
        fallback: { kind: 'ask-user' },
        required: true,
      },
    ],
    systemIds: [],
    pacing: { cutsPerMinute: 0, shortestHoldMs: 1, longestHoldMs: 1 },
    confidence: 0.8,
    derivedFromSectionIds: ['tl-1'],
    ...patch,
  };
}

describe('framework extract post-processing', () => {
  it('normalizes observed durations so proportions sum to 1', () => {
    const normalized = normalizeProportions([
      section({ id: 'a', observedMs: 1000 }),
      section({ id: 'b', observedMs: 3000 }),
    ]);
    const sum = normalized.reduce(
      (total, item) => total + item.timing.proportion,
      0,
    );
    expect(sum).toBeCloseTo(1, 10);
    expect(normalized[0]?.timing.proportion).toBeCloseTo(0.25, 10);
    expect(normalized[1]?.timing.proportion).toBeCloseTo(0.75, 10);
  });

  it('derives pacing from boundary candidates in range', () => {
    const boundaries: ReferenceBoundaries = {
      sampleRate: 0,
      threshold: 0.2,
      maxCandidates: 48,
      candidates: [
        { atMs: 500, score: 0.4, method: 'select' },
        { atMs: 1500, score: 0.5, method: 'select' },
      ],
      capped: false,
      caveat: 'Mechanical adjacent-frame change candidates. Not shot labels.',
    };
    const pacing = derivePacing({ startMs: 0, endMs: 2000 }, boundaries);
    expect(pacing.cutsPerMinute).toBeCloseTo(60, 5);
    expect(pacing.shortestHoldMs).toBe(500);
    expect(pacing.longestHoldMs).toBe(1000);
  });

  it('refuses a thinly sampled reading', () => {
    const timeline: ReferenceTimelineArtifact = {
      sections: [
        {
          id: 'sec-1',
          startMs: 0,
          endMs: 1000,
          phase: 'Hook',
          activeSystems: [{ systemId: 'sys', note: 'n' }],
          effect: 'Orients',
          evidenceIds: ['ev-1'],
          confidence: 0.9,
        },
      ],
      coverage: {
        totalMs: 10_000,
        sampleCount: 1,
        maxGapMs: 9000,
        thinRanges: [{ startMs: 1000, endMs: 10_000 }],
      },
      promptVersion: REFERENCE_READING_PROMPT_VERSION,
    };
    expect(() => assertReadingReadyForFramework(timeline)).toThrow(
      FrameworkExtractError,
    );
    try {
      assertReadingReadyForFramework(timeline);
    } catch (error) {
      expect(error).toMatchObject({ code: 'coverage' });
    }
  });

  it('refuses when too many sections sit below the confidence floor', () => {
    const timeline: ReferenceTimelineArtifact = {
      sections: [
        {
          id: 'a',
          startMs: 0,
          endMs: 1000,
          phase: 'A',
          activeSystems: [{ systemId: 'sys', note: 'n' }],
          effect: 'a',
          evidenceIds: ['ev-1'],
          confidence: 0.1,
        },
        {
          id: 'b',
          startMs: 1000,
          endMs: 2000,
          phase: 'B',
          activeSystems: [{ systemId: 'sys', note: 'n' }],
          effect: 'b',
          evidenceIds: ['ev-1'],
          confidence: 0.2,
        },
      ],
      coverage: {
        totalMs: 2000,
        sampleCount: 4,
        maxGapMs: 500,
        thinRanges: [],
      },
      promptVersion: REFERENCE_READING_PROMPT_VERSION,
    };
    try {
      assertReadingReadyForFramework(timeline);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'confidence' });
    }
  });
});
