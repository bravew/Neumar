/**
 * Gate-tier eval suite. Each case in the registry that is tagged `gate`
 * runs as a deterministic vitest test. No network or LLM access is
 * required; results are written under `~/.neuma/evals/<run-id>/`.
 */
import { describe, expect, it } from 'vitest';

import { redactValue } from '@/shared/utils/logger';

import { casesByTier } from './registry';
import { writeEvalResult } from './result-store';

const RUN_ID = `gate-${new Date().toISOString().replace(/[:.]/g, '-')}`;

describe('[gate] deterministic eval cases', () => {
  const cases = casesByTier('gate');

  if (cases.length === 0) {
    it('registry has at least one gate case', () => {
      throw new Error(
        'No gate eval cases registered. Add at least one to src-api/test/evals/registry.ts.',
      );
    });
    return;
  }

  for (const evalCase of cases) {
    it(
      `[gate] ${evalCase.id} — ${evalCase.name}`,
      async () => {
        const startedAt = new Date();
        const result = await evalCase.run({
          caseId: evalCase.id,
          artifactsDir: RUN_ID,
          redact: redactValue,
        });
        const endedAt = new Date();

        writeEvalResult(RUN_ID, evalCase, result, startedAt, endedAt);

        expect(
          result.passed,
          `[${evalCase.id}] ${result.notes ?? 'eval failed'}`,
        ).toBe(true);
      },
      evalCase.budget.timeoutMs,
    );
  }
});
