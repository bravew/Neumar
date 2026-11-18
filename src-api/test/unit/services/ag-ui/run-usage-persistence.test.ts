import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { BaseEvent } from '@ag-ui/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRunTree, rollupRunTree } from '@/app/api/runs';

import type { AgentMessage } from '@/core/agent/types';

import { closeDatabase } from '@/shared/db';
import {
  createSession,
  createTask,
  getAgentRun,
  getAgentRunsByTaskId,
} from '@/shared/db/operations';
import { AGUIEmitter } from '@/shared/services/ag-ui/emitter';
import { AGUIEventPersister } from '@/shared/services/ag-ui/persistence';

const TASK_ID = 'task-run-usage';

let tempHome = '';

async function emit(
  runId: string,
  messages: AgentMessage[],
  fail?: Error,
): Promise<BaseEvent[]> {
  const emitter = new AGUIEmitter('thread-1', runId, {
    workspaceRoot: tempHome,
    provider: 'claude',
    model: 'claude-x',
  });
  async function* source() {
    yield* messages;
    if (fail) throw fail;
  }
  const events: BaseEvent[] = [];
  for await (const event of emitter.transform(source())) events.push(event);
  return events;
}

function persister(runId: string) {
  return new AGUIEventPersister(
    TASK_ID,
    runId,
    tempHome,
    path.join(tempHome, 'session'),
    'claude',
  );
}

async function persistRun(
  runId: string,
  messages: AgentMessage[],
  fail?: Error,
) {
  const events = await emit(runId, messages, fail);
  const target = persister(runId);
  for (const event of events) target.handleEvent(event);
  return { events, row: getAgentRun(runId) };
}

describe('run usage persistence', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), 'neumar-run-usage-'));
    vi.stubEnv('HOME', tempHome);
    closeDatabase();
    createSession({ id: 'session-run-usage', prompt: 'test' });
    createTask({
      id: TASK_ID,
      session_id: 'session-run-usage',
      task_index: 0,
      prompt: 'test',
      work_dir: tempHome,
    });
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = '';
  });

  it('stores the terminal event usage, with cache subsets and run spend', async () => {
    const { row } = await persistRun('run-ok', [
      {
        type: 'result',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 100,
          input_includes_cache: false,
        },
        cost: 3,
        costDelta: 0.5,
      },
    ]);
    expect(row?.status).toBe('completed');
    expect(row?.tokens_in).toBe(110);
    expect(row?.tokens_out).toBe(5);
    expect(row?.cost_usd).toBe(0.5);
    expect(JSON.parse(row?.usage_json ?? 'null')).toEqual({
      usage: [
        {
          provider: 'claude',
          model: 'claude-x',
          inputTokens: 110,
          outputTokens: 5,
          totalTokens: 115,
          cachedInputTokens: 100,
        },
      ],
      costUsd: 0.5,
    });
  });

  it('keeps a model breakdown for a multi-model run', async () => {
    const { row } = await persistRun('run-multi', [
      { type: 'result', usage: { input_tokens: 2, output_tokens: 1 } },
      {
        type: 'result',
        model: 'other',
        usage: { input_tokens: 4, output_tokens: 3 },
      },
    ]);
    const stored = JSON.parse(row?.usage_json ?? 'null');
    expect(stored.usage.map((entry: { model: string }) => entry.model)).toEqual(
      ['claude-x', 'other'],
    );
    expect(row?.tokens_in).toBe(6);
  });

  it('records partial spend on a failed run', async () => {
    const { row } = await persistRun(
      'run-failed',
      [{ type: 'result', usage: { input_tokens: 7, output_tokens: 2 } }],
      new Error('upstream died'),
    );
    expect(row?.status).toBe('failed');
    expect(row?.tokens_in).toBe(7);
    expect(JSON.parse(row?.usage_json ?? 'null').usage[0]).toMatchObject({
      inputTokens: 7,
    });
  });

  it('leaves usage NULL, not zero, when the provider reported nothing', async () => {
    const { row } = await persistRun(
      'run-silent',
      [{ type: 'text', content: 'hello' }],
      new Error('failed before any usage'),
    );
    expect(row?.status).toBe('failed');
    expect(row?.usage_json).toBeNull();
    const [node] = buildRunTree(getAgentRunsByTaskId(TASK_ID));
    expect(node?.usage).toBeNull();
  });

  it('is idempotent when the same terminal events are replayed', async () => {
    const messages: AgentMessage[] = [
      {
        type: 'result',
        usage: { input_tokens: 10, output_tokens: 5 },
        cost: 1,
      },
    ];
    const { events } = await persistRun('run-replay', messages);
    const before = getAgentRun('run-replay');
    const replay = persister('run-replay');
    for (const event of events) replay.handleEvent(event);
    for (const event of events) replay.handleEvent(event);
    expect(getAgentRun('run-replay')).toEqual(before);
    expect(rollupRunTree(getAgentRunsByTaskId(TASK_ID))).toMatchObject({
      totalTokensIn: 10,
      totalTokensOut: 5,
      totalCostUsd: 1,
    });
  });

  it('counts a resumed run only for its own calls', async () => {
    await persistRun('run-first', [
      {
        type: 'result',
        usage: { input_tokens: 10, output_tokens: 5 },
        cost: 1,
      },
    ]);
    // The SDK reports a session total of 1.75 after the resume; this run's own
    // spend is the 0.75 delta, and the tokens are its own call only.
    await persistRun('run-resumed', [
      {
        type: 'result',
        usage: { input_tokens: 4, output_tokens: 2 },
        cost: 1.75,
        costDelta: 0.75,
      },
    ]);
    expect(rollupRunTree(getAgentRunsByTaskId(TASK_ID))).toMatchObject({
      totalTokensIn: 14,
      totalTokensOut: 7,
      totalCostUsd: 1.75,
    });
  });
});
