import { describe, expect, it } from 'vitest';

import { createDegradedCritiqueAdapter } from '@/shared/services/design-mode/critique/adapters/degraded';

describe('critique degraded adapter', () => {
  it('preserves the transcript shape and annotates the fallback reason', async () => {
    const adapter = createDegradedCritiqueAdapter('designer');

    const result = await adapter.run({
      runId: 'jury_degraded1',
      projectId: 'project_1',
      role: 'designer',
      round: 1,
      artifactPath: 'artifacts/index.html',
      artifactContent: '<main><h1>Prototype</h1></main>',
      fallbackReason: 'timeout',
      roleScore: {
        role: 'designer',
        score: 6,
        evidence: 'Hierarchy is usable but uneven.',
        mustFix: ['Improve the primary action placement.'],
        quickWins: ['Tighten section spacing.'],
      },
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      ok: true,
      transcript: {
        role: 'designer',
        round: 1,
        score: 6,
        passes: false,
        parserWarnings: ['degraded:timeout'],
      },
    });
  });

  it('returns a structured failure when aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      createDegradedCritiqueAdapter('critic').run({
        runId: 'jury_degraded2',
        projectId: 'project_1',
        role: 'critic',
        round: 1,
        artifactPath: 'artifacts/index.html',
        artifactContent: '<main><h1>Prototype</h1></main>',
        roleScore: {
          role: 'critic',
          score: 7,
          evidence: 'Specific enough.',
          mustFix: [],
          quickWins: [],
        },
        signal: controller.signal,
      }),
    ).resolves.toEqual({ ok: false, reason: 'aborted' });
  });
});
