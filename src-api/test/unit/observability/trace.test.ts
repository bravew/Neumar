import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

process.env.HOME = mkdtempSync(join(tmpdir(), 'neumar-trace-'));

import { getDatabase } from '@/shared/db';
import {
  getCostRollup,
  listTraceEvents,
  listTraceEventsForRun,
  recordTraceEvent,
} from '@/shared/observability/trace';

describe('trace events', () => {
  const taskId = `trace-task-${crypto.randomUUID()}`;

  beforeEach(() => {
    getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO tasks (id, prompt, status, started_at)
         VALUES (?, 'trace test', 'running', datetime('now'))`,
      )
      .run(taskId);
  });

  it('records redacted trace payloads ordered by start time', () => {
    recordTraceEvent({
      id: 'trace-b',
      taskId,
      kind: 'tool_call',
      tool: 'Bash',
      startedAt: 200,
      endedAt: 250,
      attrs: { apiKey: 'sk-test-secret-value-1234567890' },
    });
    recordTraceEvent({
      id: 'trace-a',
      taskId,
      kind: 'model_call',
      provider: 'openai',
      model: 'gpt-test',
      startedAt: 100,
      endedAt: 180,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
    });

    const events = listTraceEvents(taskId);
    expect(events.map((event) => event.id)).toEqual(['trace-a', 'trace-b']);
    expect(events[1]?.duration_ms).toBe(50);
    expect(events[1]?.attrs_json).toContain('[REDACTED]');
  });

  it('records run-scoped traces for a non-Task mode owner', () => {
    const projectId = `design-project-${crypto.randomUUID()}`;
    recordTraceEvent({
      id: 'design-trace',
      taskId: projectId,
      sessionId: 'design-run-1',
      kind: 'model_call',
      provider: 'codex',
    });

    expect(listTraceEventsForRun(projectId, 'design-run-1')).toMatchObject([
      { id: 'design-trace', task_id: projectId },
    ]);
  });

  it('returns same-timestamp events after a sinceEventId cursor', () => {
    const isoTaskId = `trace-task-cursor-${crypto.randomUUID()}`;
    getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO tasks (id, prompt, status, started_at)
         VALUES (?, 'cursor test', 'running', datetime('now'))`,
      )
      .run(isoTaskId);

    recordTraceEvent({
      id: 'cur-a',
      taskId: isoTaskId,
      kind: 'model_call',
      startedAt: 1000,
      endedAt: 1050,
    });
    recordTraceEvent({
      id: 'cur-b',
      taskId: isoTaskId,
      kind: 'tool_call',
      startedAt: 1000,
      endedAt: 1080,
    });
    recordTraceEvent({
      id: 'cur-c',
      taskId: isoTaskId,
      kind: 'tool_call',
      startedAt: 1000,
      endedAt: 1090,
    });

    const incremental = listTraceEvents(isoTaskId, { sinceEventId: 'cur-a' });
    const ids = incremental.map((event) => event.id);
    expect(ids).toContain('cur-b');
    expect(ids).toContain('cur-c');
    expect(ids).not.toContain('cur-a');
  });

  it('rolls up model call cost from trace events', () => {
    const now = Date.now();
    recordTraceEvent({
      id: 'trace-cost',
      taskId,
      kind: 'model_call',
      provider: 'anthropic',
      model: 'claude-test',
      startedAt: now,
      endedAt: now + 100,
      inputTokens: 100,
      outputTokens: 25,
      costUsd: 0.12,
    });

    const rollup = getCostRollup('7d', 'provider');
    expect(rollup.summary.costUsd).toBeGreaterThanOrEqual(0.12);
    expect(rollup.groups.some((group) => group.key === 'anthropic')).toBe(true);
  });
});
