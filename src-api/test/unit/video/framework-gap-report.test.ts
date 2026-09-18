import { describe, expect, it } from 'vitest';

import { bindFrameworkSlots } from '@/shared/video/reference/bind';
import { reportFrameworkGaps } from '@/shared/video/reference/gap-report';
import type {
  MediaItem,
  VideoFramework,
  VideoProject,
} from '@/shared/video/types';

const FRAMEWORK: VideoFramework = {
  id: 'fw-gap',
  version: 1,
  displayName: 'Gap spine',
  category: 'explainer',
  hook: 'cold-open',
  pace: 'medium',
  aspectRatios: ['16:9'],
  totalDuration: { typicalMs: 4000, minMs: 2000, maxMs: 8000 },
  sections: [
    {
      id: 'sec-hook',
      role: 'hook',
      purpose: 'Open',
      timing: { proportion: 1, minMs: 1000, maxMs: 4000, observedMs: 2000 },
      slots: [
        {
          id: 'slot-aroll',
          kind: 'a-roll',
          constraints: {},
          fallback: { kind: 'ask-user' },
          required: true,
        },
        {
          id: 'slot-broll',
          kind: 'b-roll',
          constraints: {},
          fallback: {
            kind: 'broll-search',
            queryTemplate: 'product close-up',
          },
          required: false,
        },
      ],
      systemIds: [],
      pacing: { cutsPerMinute: 0, shortestHoldMs: 1000, longestHoldMs: 2000 },
      confidence: 0.8,
      derivedFromSectionIds: ['sec-1'],
    },
  ],
  systems: [],
  provenance: {
    referenceId: 'ref-1',
    derivedFromArtifacts: ['analysis'],
    extractedBy: 'test',
    extractedAt: '2026-09-15T00:00:00.000Z',
  },
  confidence: 0.8,
};

describe('reportFrameworkGaps', () => {
  it('lists unfilled slots with fallback cost', () => {
    const project: VideoProject = {
      id: 'project-gap',
      name: 'Gap',
      template: 'explainer',
      prompt: '',
      assets: [
        {
          id: 'asset-audio',
          kind: 'audio',
          source: 'user',
          path: 'assets/vo.wav',
          metadata: { durationMs: 4000 },
        } satisfies MediaItem,
      ],
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
    };
    const gaps = reportFrameworkGaps(bindFrameworkSlots(project, FRAMEWORK));
    expect(gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: 'slot-aroll',
          required: true,
          estimatedCents: 0,
          fallback: { kind: 'ask-user' },
        }),
        expect.objectContaining({
          slotId: 'slot-broll',
          required: false,
          estimatedCents: 5,
        }),
      ]),
    );
  });
});
