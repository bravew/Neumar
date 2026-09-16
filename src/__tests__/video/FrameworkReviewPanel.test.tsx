import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FrameworkReviewPanel } from '@/components/video/reference/FrameworkReviewPanel';
import type { VideoFramework } from '@/shared/types/video';

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      video: {
        reference: {
          framework: {
            empty: 'No framework yet.',
            stale: 'This framework is stale after a reading change.',
            confidence: 'Confidence',
            slots: 'Slots',
            systems: 'Systems',
            none: 'None',
            roles: {
              hook: 'Hook',
              premise: 'Premise',
              context: 'Context',
              proof: 'Proof',
              escalation: 'Escalation',
              turn: 'Turn',
              demonstration: 'Demonstration',
              payoff: 'Payoff',
              cta: 'Call to action',
              outro: 'Outro',
            },
          },
        },
      },
    },
  }),
}));

const framework: VideoFramework = {
  id: 'fw-1',
  version: 1,
  displayName: 'Explainer spine',
  category: 'explainer',
  hook: 'cold-open',
  pace: 'medium',
  aspectRatios: ['16:9'],
  totalDuration: { typicalMs: 1000, minMs: 600, maxMs: 1800 },
  sections: [
    {
      id: 'fw-sec-1',
      role: 'hook',
      purpose: 'Orient the viewer.',
      timing: { proportion: 1, minMs: 600, maxMs: 1800, observedMs: 1000 },
      slots: [
        {
          id: 'slot-1',
          kind: 'a-roll',
          constraints: {},
          fallback: { kind: 'ask-user' },
          required: true,
        },
      ],
      systemIds: ['sys-caption'],
      pacing: { cutsPerMinute: 0, shortestHoldMs: 1000, longestHoldMs: 1000 },
      confidence: 0.8,
      derivedFromSectionIds: ['sec-1'],
    },
  ],
  systems: [
    {
      id: 'sys-caption',
      role: 'caption',
      behavior: { entry: 'in', active: 'hold', exit: 'out' },
      spans: ['fw-sec-1'],
    },
  ],
  provenance: {
    referenceId: 'ref-1',
    derivedFromArtifacts: ['analysis'],
    extractedBy: 'test',
    extractedAt: '2026-09-15T00:00:00.000Z',
  },
  confidence: 0.8,
};

describe('FrameworkReviewPanel', () => {
  it('renders sections and lets the user correct a role', async () => {
    const user = userEvent.setup();
    const onChangeRole = vi.fn();
    render(
      <FrameworkReviewPanel
        framework={framework}
        onChangeRole={onChangeRole}
      />,
    );
    expect(screen.getByText(/Explainer spine/)).toBeTruthy();
    expect(screen.getByText(/Orient the viewer/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Premise' }));
    expect(onChangeRole).toHaveBeenCalledWith('fw-sec-1', 'premise');
  });
});
