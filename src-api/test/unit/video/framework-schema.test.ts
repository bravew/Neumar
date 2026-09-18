import { describe, expect, it } from 'vitest';

import { videoFrameworkSchema } from '@/shared/video/reference/framework-schema';

const valid = {
  id: 'fw-1',
  version: 1 as const,
  displayName: 'Explainer spine',
  category: 'explainer' as const,
  hook: 'cold-open' as const,
  pace: 'medium' as const,
  aspectRatios: ['16:9' as const],
  totalDuration: { typicalMs: 4000, minMs: 2400, maxMs: 7200 },
  sections: [
    {
      id: 'fw-sec-1',
      role: 'hook' as const,
      purpose: 'Orient the viewer.',
      timing: { proportion: 1, minMs: 600, maxMs: 1800, observedMs: 1000 },
      slots: [
        {
          id: 'slot-1',
          kind: 'a-roll',
          constraints: {},
          fallback: { kind: 'ask-user' as const },
          required: true,
        },
      ],
      systemIds: [],
      pacing: { cutsPerMinute: 0, shortestHoldMs: 1000, longestHoldMs: 1000 },
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

describe('videoFrameworkSchema', () => {
  it('round-trips a valid framework', () => {
    const parsed = videoFrameworkSchema.parse(valid);
    expect(parsed.sections[0]?.role).toBe('hook');
    expect(parsed.version).toBe(1);
  });

  it('rejects an unknown section role', () => {
    expect(() =>
      videoFrameworkSchema.parse({
        ...valid,
        sections: [{ ...valid.sections[0], role: 'cold-open' }],
      }),
    ).toThrow();
  });
});
