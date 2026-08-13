import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetCritiqueAdapterRegistry,
  getCritiqueAdapter,
  getDegradedFallback,
  listCritiqueAdapters,
  registerCritiqueAdapter,
} from '@/shared/services/design-mode/critique/adapters/registry';
import type { CritiquePanelistAdapter } from '@/shared/services/design-mode/critique/adapters/types';

describe('critique adapter registry', () => {
  afterEach(() => {
    __resetCritiqueAdapterRegistry();
  });

  it('registers one primary and one degraded adapter per role', () => {
    __resetCritiqueAdapterRegistry();

    const adapters = listCritiqueAdapters();

    expect(
      adapters.filter((adapter) => adapter.capability === 'primary'),
    ).toHaveLength(5);
    expect(
      adapters.filter((adapter) => adapter.capability === 'degraded'),
    ).toHaveLength(5);
    expect(getCritiqueAdapter('designer', 'primary')?.id).toBe(
      'scoreboard-primary-designer',
    );
    expect(getDegradedFallback('designer')?.id).toBe(
      'scoreboard-degraded-designer',
    );
  });

  it('rejects preferred fallbacks for the wrong role', () => {
    __resetCritiqueAdapterRegistry();

    expect(() =>
      getDegradedFallback('designer', 'scoreboard-degraded-critic'),
    ).toThrow(/must be a degraded adapter for designer/);
  });

  it('can reset to a test-only registry', async () => {
    __resetCritiqueAdapterRegistry(false);
    const adapter: CritiquePanelistAdapter = {
      id: 'test-primary-designer',
      role: 'designer',
      capability: 'primary',
      async run(context) {
        return {
          ok: true,
          transcript: {
            role: context.role,
            round: context.round,
            score: 9,
            passes: true,
            evidence: 'ok',
            mustFix: [],
            quickWins: [],
            parserWarnings: [],
          },
        };
      },
    };

    registerCritiqueAdapter(adapter);

    expect(getCritiqueAdapter('designer')?.id).toBe('test-primary-designer');
    expect(listCritiqueAdapters()).toEqual([
      {
        id: 'test-primary-designer',
        role: 'designer',
        capability: 'primary',
      },
    ]);
  });
});
