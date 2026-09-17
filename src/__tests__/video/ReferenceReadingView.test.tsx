import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReferenceReadingView } from '@/components/video/reference/ReferenceReadingView';
import type {
  VideoReferenceAnalysis,
  VideoReferenceArtifactEnvelope,
  VideoReferenceTimelineArtifact,
} from '@/shared/types/video';

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      video: {
        reference: {
          reading: {
            empty: 'No structured reading yet.',
            stale: 'This reading is stale after a method or evidence change.',
            coverage: 'Coverage',
            intent: 'Intent',
            openQuestions: 'Open questions',
            confidence: 'Confidence',
            none: 'None recorded.',
            playSection: 'Play section {phase}',
            stopSection: 'Stop playback',
            play: 'Play',
            pause: 'Pause',
            seek: 'Seek in the reference',
          },
        },
      },
    },
  }),
}));

const analysis: VideoReferenceArtifactEnvelope<VideoReferenceAnalysis> = {
  kind: 'analysis',
  referenceId: 'ref-1',
  sourceFingerprint: 'analysis-fp',
  derivedFrom: {},
  generatedAt: '2026-09-15T00:00:00.000Z',
  producer: 'test',
  data: {
    intent: 'Teach a workflow.',
    arc: 'Hook, demo, payoff.',
    thesis: 'Captions carry the argument.',
    systems: [
      {
        id: 'sys-caption',
        role: 'caption',
        content: 'titles',
        appearance: 'white',
        spatial: 'lower third',
        entry: 'fade in',
        behavior: 'updates',
        persistence: 'until payoff',
        exit: 'cut',
        function: 'names the claim',
        occurrences: [{ startMs: 0, endMs: 2000 }],
        evidenceIds: ['ev-1'],
        confidence: 0.8,
      },
    ],
    openQuestions: [{ question: 'Is the last beat a callback?', atMs: 2500 }],
    observed: ['White captions sit over a dark bed.'],
    inferred: ['The captions are the thesis.'],
    promptVersion: 'reference-reading.v1',
  },
};

const timeline: VideoReferenceArtifactEnvelope<VideoReferenceTimelineArtifact> =
  {
    kind: 'timeline',
    referenceId: 'ref-1',
    sourceFingerprint: 'timeline-fp',
    derivedFrom: { analysis: 'analysis-fp' },
    generatedAt: '2026-09-15T00:00:00.000Z',
    producer: 'test',
    data: {
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
        totalMs: 10000,
        sampleCount: 2,
        maxGapMs: 8000,
        thinRanges: [{ startMs: 2000, endMs: 10000 }],
      },
      promptVersion: 'reference-reading.v1',
    },
  };

describe('ReferenceReadingView', () => {
  it('renders sections, coverage, open questions, and confidence', () => {
    render(
      <ReferenceReadingView
        projectId="proj-1"
        referenceId="ref-1"
        mediaUrl="http://localhost/media.mp4"
        analysis={analysis}
        timeline={timeline}
        evidence={[
          {
            id: 'ev-1',
            range: { startMs: 0, endMs: 3000 },
            sampledAtMs: [0, 1000, 2000],
            paths: [],
          },
        ]}
        coverage={timeline.data.coverage}
      />,
    );
    // The phase now appears twice: in its row, and as the label for the
    // section the playhead is currently over.
    expect(screen.getAllByText('The hook')).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Play section The hook' }),
    ).toBeTruthy();
    expect(screen.getByText(/Confidence 0.70/)).toBeTruthy();
    expect(screen.getByText('Teach a workflow.')).toBeTruthy();
    expect(screen.getByText(/Is the last beat a callback/)).toBeTruthy();
    expect(screen.getByText(/Coverage/)).toBeTruthy();
    expect(screen.getByText('ev-1')).toBeTruthy();
  });

  it('shows the empty state when nothing is written', () => {
    render(
      <ReferenceReadingView
        projectId="proj-1"
        referenceId="ref-1"
        mediaUrl="http://localhost/media.mp4"
        analysis={null}
        timeline={null}
        evidence={[]}
        coverage={null}
      />,
    );
    expect(screen.getByText('No structured reading yet.')).toBeTruthy();
  });
});
