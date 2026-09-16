import { describe, expect, it } from 'vitest';

import {
  renderReferenceAnalysisMarkdown,
  renderReferenceTimelineMarkdown,
} from '@/shared/video/reference/markdown';
import type {
  ReferenceAnalysis,
  ReferenceTimelineArtifact,
} from '@/shared/video/types';
import { REFERENCE_READING_PROMPT_VERSION } from '@/shared/video/types';

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

const TIMELINE: ReferenceTimelineArtifact = {
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
    },
  ],
  coverage: {
    totalMs: 3000,
    sampleCount: 3,
    maxGapMs: 1000,
    thinRanges: [],
  },
  promptVersion: REFERENCE_READING_PROMPT_VERSION,
};

describe('reference reading markdown', () => {
  it('renders ANALYSIS.md from the JSON', () => {
    const markdown = renderReferenceAnalysisMarkdown(ANALYSIS);
    expect(markdown).toMatchSnapshot();
    expect(markdown).toContain('# Reference analysis');
    expect(markdown).toContain('## Observed');
    expect(markdown).toContain('## Inferred');
    expect(markdown).toContain('sys-caption');
  });

  it('renders TIMELINE.md from the JSON', () => {
    const markdown = renderReferenceTimelineMarkdown(TIMELINE);
    expect(markdown).toMatchSnapshot();
    expect(markdown).toContain('# Reference timeline');
    expect(markdown).toContain('## The hook');
    expect(markdown).toContain('0–2000ms');
  });
});
