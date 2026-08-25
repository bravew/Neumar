import { EventType } from '@ag-ui/core';
import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '../../src/core/agent/types';
import { AGUIEmitter } from '../../src/shared/services/ag-ui/emitter';

async function collectEvents(messages: AgentMessage[]) {
  const emitter = new AGUIEmitter('thread-1', 'run-1');
  async function* source() {
    yield* messages;
  }
  const events = [];
  for await (const event of emitter.transform(source())) {
    events.push(event);
  }
  return events;
}

describe('AGUIEmitter', () => {
  it('emits a normalized turn budget on every result (P2-5)', async () => {
    const events = await collectEvents([
      {
        type: 'result',
        subtype: 'error_max_turns',
        maxTurns: 60,
      } as AgentMessage,
    ]);
    const budget = events.find(
      (event) =>
        event.type === EventType.CUSTOM &&
        (event as { name?: string }).name === 'neuma.turn_budget',
    );
    expect(budget).toBeDefined();
    expect((budget as { value?: unknown }).value).toMatchObject({
      reason: 'max_steps',
      exhausted: true,
      limit: 60,
    });
  });

  it('passes an adapter-supplied turn budget through unchanged', async () => {
    const events = await collectEvents([
      {
        type: 'result',
        subtype: 'success',
        turnBudget: { reason: 'refusal', exhausted: false },
      } as AgentMessage,
    ]);
    const budget = events.find(
      (event) =>
        event.type === EventType.CUSTOM &&
        (event as { name?: string }).name === 'neuma.turn_budget',
    );
    expect((budget as { value?: unknown }).value).toMatchObject({
      reason: 'refusal',
    });
  });

  it('turns an explicit abort into one cancellation terminal event', async () => {
    const emitter = new AGUIEmitter('thread-abort', 'run-abort');
    async function* source() {
      yield { type: 'text' as const, content: 'started' };
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }

    const events = [];
    for await (const event of emitter.transform(source())) events.push(event);

    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      code: 'USER_CANCELLED',
      message: 'Run stopped by user',
    });
    expect(
      events.filter(
        (event) =>
          event.type === EventType.RUN_ERROR ||
          event.type === EventType.RUN_FINISHED,
      ),
    ).toHaveLength(1);
  });

  it('keeps permission approval in the durable AG-UI event stream', async () => {
    const emitter = new AGUIEmitter('thread-permission', 'run-permission');
    async function* source() {
      yield {
        type: 'permission_request' as const,
        permission: {
          id: 'permission-1',
          tool: 'render',
          description: 'Render the approved cut',
        },
      };
    }

    const events = [];
    for await (const event of emitter.transform(source())) events.push(event);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: EventType.CUSTOM,
        name: 'permission_request',
        value: {
          permission: expect.objectContaining({ id: 'permission-1' }),
        },
      }),
    );
  });

  it('wraps run with RUN_STARTED / RUN_FINISHED', async () => {
    const events = await collectEvents([]);
    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
  });

  it('emits post-tool continuation attempts as durable custom events', async () => {
    const events = await collectEvents([
      {
        type: 'system',
        subtype: 'post_tool_continuation',
        attempt: 1,
        isProgress: true,
      },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: EventType.CUSTOM,
        name: 'continuation_attempt',
        value: { attempt: 1, kind: 'post_tool_completion' },
      }),
    );
  });

  it('attaches monotonic seq and timestamp to every event', async () => {
    const events = await collectEvents([]);
    for (let i = 0; i < events.length; i++) {
      const e = events[i] as Record<string, unknown>;
      expect(e.seq).toBe(i);
      expect(typeof e.timestamp).toBe('number');
    }
  });

  it('maps text messages with proper lifecycle', async () => {
    const events = await collectEvents([
      { type: 'text', id: 'msg-1', content: 'Hello' },
      { type: 'text', id: 'msg-1', content: ' world' },
    ]);
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.TEXT_MESSAGE_START);
    expect(types).toContain(EventType.TEXT_MESSAGE_CONTENT);
    expect(types).toContain(EventType.TEXT_MESSAGE_END);
    // Only one TEXT_MESSAGE_START for consecutive text messages sharing the same id path
    expect(types.filter((t) => t === EventType.TEXT_MESSAGE_START).length).toBe(
      1,
    );
    // Two TEXT_MESSAGE_CONTENT chunks
    expect(
      types.filter((t) => t === EventType.TEXT_MESSAGE_CONTENT).length,
    ).toBe(2);
  });

  it('maps tool_use/tool_result to full tool call lifecycle', async () => {
    const events = await collectEvents([
      {
        type: 'tool_use',
        id: 'tc-1',
        name: 'read_file',
        input: { path: '/foo' },
      },
      { type: 'tool_result', toolUseId: 'tc-1', output: 'file content' },
    ]);
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.TOOL_CALL_START);
    expect(types).toContain(EventType.TOOL_CALL_ARGS);
    expect(types).toContain(EventType.TOOL_CALL_END);
    expect(types).toContain(EventType.TOOL_CALL_RESULT);
  });

  it('preserves tool failure evidence in the durable result event', async () => {
    const events = await collectEvents([
      { type: 'tool_use', id: 'tc-failed', name: 'write', input: {} },
      {
        type: 'tool_result',
        toolUseId: 'tc-failed',
        output: 'write failed',
        isError: true,
      },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: 'tc-failed',
        isError: true,
      }),
    );
  });

  it('closes open text message before tool_use', async () => {
    const events = await collectEvents([
      { type: 'text', id: 'msg-1', content: 'Thinking...' },
      { type: 'tool_use', id: 'tc-1', name: 'search', input: { q: 'test' } },
    ]);
    const types = events.map((e) => e.type);
    const endIdx = types.indexOf(EventType.TEXT_MESSAGE_END);
    const startIdx = types.indexOf(EventType.TOOL_CALL_START);
    expect(endIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeGreaterThan(endIdx);
  });

  it('maps thinking to REASONING_MESSAGE lifecycle', async () => {
    const events = await collectEvents([
      { type: 'thinking', content: 'Let me reason...' },
    ]);
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.REASONING_MESSAGE_START);
    expect(types).toContain(EventType.REASONING_MESSAGE_CONTENT);
    expect(types).toContain(EventType.REASONING_MESSAGE_END);
  });

  it('maps plan to CUSTOM event with name "plan"', async () => {
    const events = await collectEvents([
      {
        type: 'plan',
        plan: {
          id: 'plan-1',
          goal: 'Do something',
          steps: [{ id: 's1', description: 'Step 1', status: 'pending' }],
          createdAt: new Date(),
        },
      },
    ]);
    const custom = events.find((e) => e.type === EventType.CUSTOM) as Record<
      string,
      unknown
    >;
    expect(custom).toBeDefined();
    expect(custom?.name).toBe('plan');
  });

  it('maps error message to RUN_ERROR', async () => {
    const events = await collectEvents([
      { type: 'error', message: 'Something broke' },
    ]);
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.RUN_ERROR);
    // Should NOT also emit RUN_FINISHED after an inline error
  });

  it('emits RUN_ERROR (not RUN_FINISHED) when generator throws', async () => {
    const emitter = new AGUIEmitter('thread-1', 'run-err');
    async function* failingSource(): AsyncGenerator<AgentMessage> {
      yield { type: 'text', content: 'partial' };
      throw new Error('generator error');
    }
    const events = [];
    for await (const event of emitter.transform(failingSource())) {
      events.push(event);
    }
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.RUN_ERROR);
    expect(types).not.toContain(EventType.RUN_FINISHED);
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types[types.length - 1]).toBe(EventType.RUN_ERROR);
  });

  it('closes orphaned tool calls on error', async () => {
    const emitter = new AGUIEmitter('thread-1', 'run-orphan');
    async function* orphanSource(): AsyncGenerator<AgentMessage> {
      // tool_use starts but no tool_result before error
      yield {
        type: 'tool_use',
        id: 'tc-orphan',
        name: 'bash',
        input: { cmd: 'ls' },
      };
      throw new Error('mid-tool error');
    }
    const events = [];
    for await (const event of emitter.transform(orphanSource())) {
      events.push(event);
    }
    const types = events.map((e) => e.type);
    // TOOL_CALL_END should appear (from normal tool_use flow)
    // and RUN_ERROR at the end
    expect(types).toContain(EventType.RUN_ERROR);
  });

  it('maps step_started / step_finished to STEP events', async () => {
    const events = await collectEvents([
      { type: 'step_started', stepName: 'planning' },
      { type: 'text', content: 'Planning...' },
      { type: 'step_finished', stepName: 'planning' },
    ]);
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.STEP_STARTED);
    expect(types).toContain(EventType.STEP_FINISHED);
  });

  it('RUN_STARTED is always first, terminal event is always last', async () => {
    const events = await collectEvents([
      { type: 'text', content: 'Hello' },
      { type: 'tool_use', id: 'tc-1', name: 'read', input: {} },
      { type: 'tool_result', toolUseId: 'tc-1', output: 'result' },
    ]);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
  });

  it('maps tool_use_args_delta to TOOL_CALL_ARGS (Phase 5 progressive streaming)', async () => {
    const events = await collectEvents([
      { type: 'tool_use', id: 'tc-ps', name: 'bash', input: null },
      { type: 'tool_use_args_delta', id: 'tc-ps', content: '{"cmd"' },
      { type: 'tool_use_args_delta', id: 'tc-ps', content: ':"ls"}' },
      { type: 'tool_result', toolUseId: 'tc-ps', output: 'ok' },
    ]);
    const argsEvents = events.filter(
      (e) => e.type === EventType.TOOL_CALL_ARGS,
    );
    // Two deltas plus the initial empty args chunk from tool_use (no input)
    expect(argsEvents.length).toBeGreaterThanOrEqual(2);
    const deltas = argsEvents.map(
      (e) => (e as Record<string, unknown>).delta as string,
    );
    expect(deltas).toContain('{"cmd"');
    expect(deltas).toContain(':"ls"}');
  });

  it('emits STATE_SNAPSHOT after RUN_STARTED when context is provided', async () => {
    const emitter = new AGUIEmitter('thread-state', 'run-state', {
      workspaceRoot: '/home/user/workspace',
      taskTitle: 'Test task',
    });
    async function* source(): AsyncGenerator<AgentMessage> {}
    const events = [];
    for await (const event of emitter.transform(source())) {
      events.push(event);
    }
    const types = events.map((e) => e.type);
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types[1]).toBe(EventType.STATE_SNAPSHOT);
    const snapshot = events[1] as Record<string, unknown>;
    const snapshotData = snapshot.snapshot as Record<string, unknown>;
    expect((snapshotData.workspace as Record<string, unknown>).path).toBe(
      '/home/user/workspace',
    );
    expect((snapshotData.workspace as Record<string, unknown>).name).toBe(
      'workspace',
    );
    expect((snapshotData.task as Record<string, unknown>).title).toBe(
      'Test task',
    );
  });

  it('does not emit STATE_SNAPSHOT when no context is provided', async () => {
    const events = await collectEvents([]);
    const types = events.map((e) => e.type);
    expect(types).not.toContain(EventType.STATE_SNAPSHOT);
  });

  it('emits STATE_SNAPSHOT with usage fields from result messages', async () => {
    const events = await collectEvents([
      {
        type: 'result',
        usage: { input_tokens: 1000, output_tokens: 250 },
        cost: 0.0042,
      },
    ]);
    const snapshot = events.find(
      (e) => e.type === EventType.STATE_SNAPSHOT,
    ) as Record<string, unknown>;
    expect(snapshot).toBeDefined();
    const snapshotData = snapshot?.snapshot as Record<string, unknown>;
    const usage = snapshotData?.usage as Record<string, unknown>;
    expect(usage?.inputTokens).toBe(1000);
    expect(usage?.outputTokens).toBe(250);
    expect(usage?.cost).toBe(0.0042);
  });
});
