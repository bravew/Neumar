import '../setup';
import { getDatabase } from '@/shared/db';
import { getCostRollup, recordTraceEvent } from '@/shared/observability/trace';

import type { EvalCase } from '../types';

const evalCase: EvalCase = {
  id: 'trace-cost-rollup',
  name: 'Trace cost rollup stays consistent',
  tier: 'gate',
  touchfiles: [
    'src-api/src/shared/observability/**',
    'src-api/src/app/api/observability.ts',
  ],
  budget: { maxUsd: 0, timeoutMs: 10_000 },
  run: () => {
    const taskId = `eval-cost-${crypto.randomUUID()}`;
    getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO tasks (id, prompt, status, started_at)
         VALUES (?, 'cost rollup eval', 'running', datetime('now'))`,
      )
      .run(taskId);

    const now = Date.now();
    recordTraceEvent({
      taskId,
      kind: 'model_call',
      provider: 'eval-provider',
      model: 'eval-model-1',
      startedAt: now,
      endedAt: now + 200,
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.05,
    });
    recordTraceEvent({
      taskId,
      kind: 'model_call',
      provider: 'eval-provider',
      model: 'eval-model-2',
      startedAt: now + 100,
      endedAt: now + 300,
      inputTokens: 500,
      outputTokens: 100,
      costUsd: 0.03,
    });

    const rollup = getCostRollup('7d', 'model');
    const evalGroups = rollup.groups.filter((group) =>
      group.key.startsWith('eval-model-'),
    );
    const groupedTotal = evalGroups.reduce((sum, g) => sum + g.costUsd, 0);

    const passed =
      evalGroups.length === 2 && Math.abs(groupedTotal - 0.08) < 1e-6;

    return {
      passed,
      score: passed ? 1 : 0,
      notes: passed
        ? `2 grouped models, total $${groupedTotal.toFixed(4)}`
        : `expected 2 model groups summing to $0.08, got ${evalGroups.length} totalling $${groupedTotal.toFixed(4)}`,
      metrics: {
        groupCount: evalGroups.length,
        groupedTotalUsd: groupedTotal,
      },
    };
  },
};

export default evalCase;
