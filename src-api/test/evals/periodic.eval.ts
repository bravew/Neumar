/**
 * Periodic-tier evals. These can call external providers and are
 * intended to be invoked manually or by the scheduled workflow with
 * `EVALS_TIER=periodic`. They are skipped in any other environment so
 * `pnpm test:fast` and `pnpm test:gate` never trigger paid runs.
 */
import { describe, it } from 'vitest';

import { redactValue } from '@/shared/utils/logger';

import { casesByTier } from './registry';
import { writeEvalResult } from './result-store';

const RUN_ID = `periodic-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const ACTIVE = process.env.EVALS_TIER === 'periodic';

describe.skipIf(!ACTIVE)('[periodic] LLM-judge eval cases', () => {
  const cases = casesByTier('periodic');

  if (cases.length === 0) {
    it.skip('no periodic cases registered yet', () => {});
    return;
  }

  for (const evalCase of cases) {
    it(
      `[periodic] ${evalCase.id} — ${evalCase.name}`,
      async () => {
        const startedAt = new Date();
        const result = await evalCase.run({
          caseId: evalCase.id,
          artifactsDir: RUN_ID,
          redact: redactValue,
        });
        const endedAt = new Date();
        writeEvalResult(RUN_ID, evalCase, result, startedAt, endedAt);
      },
      evalCase.budget.timeoutMs,
    );
  }
});
