import '../setup';
import { getDatabase } from '@/shared/db';
import {
  listTraceEvents,
  recordTraceEvent,
} from '@/shared/observability/trace';

import type { EvalCase } from '../types';

const SECRET_PATTERNS = [
  'sk-test-secret-value-1234567890',
  'AKIAIOSFODNN7EXAMPLE',
  'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
];

const evalCase: EvalCase = {
  id: 'trace-redaction',
  name: 'Trace event payloads redact secret-shaped values',
  tier: 'gate',
  touchfiles: [
    'src-api/src/shared/observability/**',
    'src-api/src/shared/utils/logger.ts',
  ],
  budget: { maxUsd: 0, timeoutMs: 5_000 },
  run: () => {
    const taskId = `eval-redact-${crypto.randomUUID()}`;
    getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO tasks (id, prompt, status, started_at)
         VALUES (?, 'redaction eval', 'running', datetime('now'))`,
      )
      .run(taskId);

    recordTraceEvent({
      taskId,
      kind: 'tool_call',
      tool: 'Bash',
      startedAt: 1_000,
      attrs: {
        apiKey: SECRET_PATTERNS[0],
        env: { AWS_ACCESS_KEY_ID: SECRET_PATTERNS[1] },
        token: SECRET_PATTERNS[2],
      },
    });

    const events = listTraceEvents(taskId);
    const blob = events.map((event) => event.attrs_json ?? '').join('\n');
    const leaks = SECRET_PATTERNS.filter((pattern) => blob.includes(pattern));
    const passed = leaks.length === 0;

    return {
      passed,
      score: passed ? 1 : 0,
      notes: passed
        ? 'no secret-shaped values leaked'
        : `leaks: ${leaks.length}`,
      metrics: { events: events.length, leaks: leaks.length },
    };
  },
};

export default evalCase;
