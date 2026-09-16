import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { detectBoundaries } from '@/shared/video/analysis/boundaries';
import { REFERENCE_BOUNDARY_CAVEAT } from '@/shared/video/types';

const FIXTURES = fileURLToPath(
  new URL('../../fixtures/video/reference', import.meta.url),
);

describe('detectBoundaries', () => {
  it('yields no candidates on a still clip', async () => {
    const result = await detectBoundaries({
      mediaPath: path.join(FIXTURES, 'still-8s.mp4'),
      workDir: FIXTURES,
      threshold: 0.2,
    });
    expect(result.candidates).toEqual([]);
    expect(result.caveat).toBe(REFERENCE_BOUNDARY_CAVEAT);
  });

  it('finds hard cuts within 100ms and is monotonic in threshold', async () => {
    const mediaPath = path.join(FIXTURES, 'hard-cuts-12s.mp4');
    const loose = await detectBoundaries({
      mediaPath,
      workDir: FIXTURES,
      threshold: 0.2,
    });
    const tight = await detectBoundaries({
      mediaPath,
      workDir: FIXTURES,
      threshold: 0.4,
    });
    expect(tight.candidates.length).toBeLessThanOrEqual(
      loose.candidates.length,
    );
    expect(loose.candidates.length).toBeGreaterThan(0);
    const knownCuts = [3000, 6000, 9000];
    for (const candidate of loose.candidates) {
      expect(
        knownCuts.some((cut) => Math.abs(candidate.atMs - cut) <= 100),
      ).toBe(true);
    }
    expect(
      knownCuts.filter((cut) =>
        loose.candidates.some(
          (candidate) => Math.abs(candidate.atMs - cut) <= 100,
        ),
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(loose.capped).toBe(false);
  });
});
