import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

process.env.HOME = mkdtempSync(join(tmpdir(), 'neumar-exporter-'));

import { getDatabase } from '@/shared/db';
import {
  _resetTraceExporters,
  registerTraceExporter,
} from '@/shared/observability/exporters/registry';
import { recordTraceEvent } from '@/shared/observability/trace';

afterEach(() => {
  _resetTraceExporters();
});

describe('trace exporter registry', () => {
  it('is a no-op when no exporters are registered', () => {
    const taskId = `exp-noop-${crypto.randomUUID()}`;
    getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO tasks (id, prompt, status, started_at)
         VALUES (?, 'noop', 'running', datetime('now'))`,
      )
      .run(taskId);
    expect(() =>
      recordTraceEvent({ taskId, kind: 'tool_call', tool: 'NoOp' }),
    ).not.toThrow();
  });

  it('forwards events to registered exporters and survives failures', async () => {
    const taskId = `exp-call-${crypto.randomUUID()}`;
    getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO tasks (id, prompt, status, started_at)
         VALUES (?, 'call', 'running', datetime('now'))`,
      )
      .run(taskId);

    const seen: string[] = [];
    registerTraceExporter({
      name: 'capture',
      async export(event) {
        seen.push(event.id);
      },
    });
    registerTraceExporter({
      name: 'broken',
      async export() {
        throw new Error('boom');
      },
    });

    const event = recordTraceEvent({
      taskId,
      kind: 'tool_call',
      tool: 'Bash',
    });

    // Drain microtasks deterministically — exporters dispatch via
    // queueMicrotask. Two awaits cover the export call and its catch handler.
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toContain(event.id);
  });
});
