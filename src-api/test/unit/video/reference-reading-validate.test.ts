import { describe, expect, it } from 'vitest';

import {
  computeReferenceCoverage,
  ReferenceReadingValidationError,
  validateReferenceAnalysis,
  validateReferenceTimeline,
} from '@/shared/video/reference/reading-validate';
import type {
  EvidenceItem,
  ReferenceAnalysis,
  ReferenceTimelineArtifact,
} from '@/shared/video/types';
import { REFERENCE_READING_PROMPT_VERSION } from '@/shared/video/types';

const EVIDENCE: EvidenceItem = {
  id: 'ev-1',
  kind: 'grid',
  name: 'coarse',
  range: { startMs: 0, endMs: 3000 },
  sampledAtMs: [0, 1000, 2000],
  paths: ['references/ref-1/evidence/grid.png'],
  labels: { time: true, words: false },
};

const ANALYSIS: ReferenceAnalysis = {
  intent: 'Teach a workflow.',
  arc: 'Hook, demo, payoff.',
  thesis: 'Captions carry the argument.',
  systems: [
    {
      id: 'sys-caption',
      role: 'caption',
      content: 'On-screen titles',
      appearance: 'White sans-serif',
      spatial: 'Lower third',
      entry: 'Fades in with the hook',
      behavior: 'Updates per beat',
      persistence: 'Stays until payoff',
      exit: 'Cuts with the last line',
      function: 'Names the claim',
      occurrences: [{ startMs: 0, endMs: 2000 }],
      evidenceIds: ['ev-1'],
      confidence: 0.8,
    },
  ],
  openQuestions: [{ question: 'Is the last beat a callback?', atMs: 2500 }],
  observed: ['White captions sit over a dark bed.'],
  inferred: ['The captions are the thesis, not decoration.'],
  promptVersion: REFERENCE_READING_PROMPT_VERSION,
};

describe('validateReferenceAnalysis', () => {
  it('rejects an out-of-range occurrence', () => {
    expect(() =>
      validateReferenceAnalysis(
        {
          ...ANALYSIS,
          systems: [
            {
              ...ANALYSIS.systems[0]!,
              occurrences: [{ startMs: 0, endMs: 9000 }],
            },
          ],
        },
        { durationMs: 3000, evidence: [EVIDENCE] },
      ),
    ).toThrow(ReferenceReadingValidationError);
    try {
      validateReferenceAnalysis(
        {
          ...ANALYSIS,
          systems: [
            {
              ...ANALYSIS.systems[0]!,
              occurrences: [{ startMs: 0, endMs: 9000 }],
            },
          ],
        },
        { durationMs: 3000, evidence: [EVIDENCE] },
      );
    } catch (error) {
      expect(error).toMatchObject({
        code: 'out-of-range',
        anchor: 'system:sys-caption',
      });
    }
  });

  it('rejects evidence that does not overlap the claim', () => {
    try {
      validateReferenceAnalysis(
        {
          ...ANALYSIS,
          systems: [
            {
              ...ANALYSIS.systems[0]!,
              occurrences: [{ startMs: 8000, endMs: 9000 }],
            },
          ],
        },
        { durationMs: 10000, evidence: [EVIDENCE] },
      );
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'evidence-overlap',
        anchor: 'system:sys-caption',
      });
    }
  });

  it('rejects missing confidence', () => {
    try {
      validateReferenceAnalysis(
        {
          ...ANALYSIS,
          systems: [{ ...ANALYSIS.systems[0]!, confidence: Number.NaN }],
        },
        { durationMs: 3000, evidence: [EVIDENCE] },
      );
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'confidence',
        anchor: 'system:sys-caption',
      });
    }
  });
});

describe('validateReferenceTimeline', () => {
  const coverage = computeReferenceCoverage({
    durationMs: 10000,
    evidence: [
      {
        ...EVIDENCE,
        sampledAtMs: [0, 2000],
        range: { startMs: 0, endMs: 10000 },
      },
    ],
  });

  const timeline = (
    patch: Partial<ReferenceTimelineArtifact['sections'][number]> = {},
    thinRanges = coverage.thinRanges,
  ): ReferenceTimelineArtifact => ({
    sections: [
      {
        id: 'sec-1',
        startMs: 0,
        endMs: 2000,
        phase: 'The hook',
        anchor: 'first line',
        activeSystems: [{ systemId: 'sys-caption', note: 'names the claim' }],
        effect: 'Orients the viewer',
        evidenceIds: ['ev-1'],
        confidence: 0.7,
        ...patch,
      },
    ],
    coverage: {
      totalMs: 10000,
      sampleCount: 2,
      maxGapMs: coverage.maxGapMs,
      thinRanges,
    },
    promptVersion: REFERENCE_READING_PROMPT_VERSION,
  });

  it('rejects an unknown system id', () => {
    try {
      validateReferenceTimeline(
        timeline({
          activeSystems: [{ systemId: 'sys-missing', note: 'ghost' }],
        }),
        {
          durationMs: 10000,
          evidence: [{ ...EVIDENCE, range: { startMs: 0, endMs: 10000 } }],
          analysis: ANALYSIS,
          computedCoverage: coverage,
        },
      );
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'unknown-system',
        anchor: 'section:sec-1',
      });
    }
  });

  it('rejects understated thinRanges', () => {
    try {
      validateReferenceTimeline(timeline({}, []), {
        durationMs: 10000,
        evidence: [{ ...EVIDENCE, range: { startMs: 0, endMs: 10000 } }],
        analysis: ANALYSIS,
        computedCoverage: coverage,
      });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'thin-ranges' });
    }
  });
});
