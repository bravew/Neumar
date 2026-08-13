import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCritiqueConformance } from '@/shared/services/design-mode/critique/conformance/runner';

describe('critique conformance runner', () => {
  it('produces a green structured report for replay fixtures', async () => {
    const report = await runCritiqueConformance({
      fixturesRoot: path.resolve(
        'src-api/test/fixtures/design-mode/critique/conformance',
      ),
    });

    expect(report.summary).toMatchObject({
      total: 2,
      passed: 2,
      failed: 0,
    });
    expect(report.checks.every((check) => check.ok)).toBe(true);
    expect(report.adapters.length).toBeGreaterThanOrEqual(10);
  });
});
