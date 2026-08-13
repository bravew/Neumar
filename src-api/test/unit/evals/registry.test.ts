import { describe, expect, it } from 'vitest';

import { ALL_CASES, casesByTier } from '../../evals/registry';

describe('eval registry', () => {
  it('exports a non-empty registry', () => {
    expect(ALL_CASES.length).toBeGreaterThan(0);
  });

  it('has at least three deterministic gate cases', () => {
    expect(casesByTier('gate').length).toBeGreaterThanOrEqual(3);
  });

  it('all gate cases declare a $0 budget', () => {
    for (const c of casesByTier('gate')) {
      expect(c.budget.maxUsd, `${c.id} must be free`).toBe(0);
    }
  });

  it('case ids are unique', () => {
    const ids = ALL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
