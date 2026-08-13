import '../setup';
import { getDatabase } from '@/shared/db';
import {
  listTraceEvents,
  recordTraceEvent,
} from '@/shared/observability/trace';

import type { EvalCase } from '../types';

const evalCase: EvalCase = {
  id: 'trace-cursor-stability',
  name: 'listTraceEvents cursor returns same-timestamp events',
  tier: 'gate',
  touchfiles: ['src-api/src/shared/observability/**'],
  budget: { maxUsd: 0, timeoutMs: 5_000 },
  run: () => {
    const taskId = `eval-cursor-${crypto.randomUUID()}`;
    getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO tasks (id, prompt, status, started_at)
         VALUES (?, 'cursor stability eval', 'running', datetime('now'))`,
      )
      .run(taskId);

    const cursorId = `eval-cur-a-${crypto.randomUUID()}`;
    const tailIds = [
      `eval-cur-b-${crypto.randomUUID()}`,
      `eval-cur-c-${crypto.randomUUID()}`,
    ];
    recordTraceEvent({
      id: cursorId,
      taskId,
      kind: 'model_call',
      startedAt: 5_000,
      endedAt: 5_010,
    });
    for (const id of tailIds) {
      recordTraceEvent({
        id,
        taskId,
        kind: 'tool_call',
        startedAt: 5_000,
        endedAt: 5_020,
      });
    }

    const incremental = listTraceEvents(taskId, { sinceEventId: cursorId });
    const ids = incremental.map((event) => event.id);
    const passed =
      tailIds.every((id) => ids.includes(id)) && !ids.includes(cursorId);

    return {
      passed,
      score: passed ? 1 : 0,
      notes: passed
        ? `cursor returned ${ids.length} same-timestamp events`
        : `cursor missed events. expected ${tailIds.join(',')} got ${ids.join(',')}`,
      metrics: { returned: ids.length },
    };
  },
};

export default evalCase;
