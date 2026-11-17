import { HttpAgent } from '@ag-ui/client';
import { EventType, type BaseEvent } from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '../../../../src/core/agent/types';
import { AGUIEmitter } from '../../../../src/shared/services/ag-ui/emitter';

async function collect(messages: AgentMessage[]): Promise<BaseEvent[]> {
  const emitter = new AGUIEmitter('thread-1', 'run-1');
  async function* source() {
    yield* messages;
  }
  const events: BaseEvent[] = [];
  for await (const event of emitter.transform(source())) {
    events.push(event);
  }
  return events;
}

/**
 * Sends the emitter's events over SSE to a real HttpAgent. The client parses
 * the stream and applies its event verifier, so a sequence the client would
 * reject makes runAgent reject.
 */
async function runThroughClient(events: BaseEvent[]): Promise<void> {
  const encoder = new EventEncoder({ accept: 'text/event-stream' });
  const body = events.map((event) => encoder.encode(event)).join('');
  const agent = new HttpAgent({
    url: 'http://localhost/ag-ui',
    threadId: 'thread-1',
    fetch: async () =>
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
  });
  await agent.runAgent({ runId: 'run-1' });
}

describe('sub-agent events satisfy the AG-UI client verifier', () => {
  it('accepts interleaved children with text, tool calls, nesting, finish, and error', async () => {
    const events = await collect([
      { type: 'text', content: 'parent' },
      {
        type: 'subagent_started',
        subagentRunId: 'task-a',
        subagentName: 'Scan',
        parentToolCallId: 'toolu_A',
      },
      {
        type: 'subagent_started',
        subagentRunId: 'task-n',
        subagentName: 'Nested',
        parentSubagentRunId: 'task-a',
        parentToolCallId: 'toolu_N',
      },
      { type: 'text', content: 'from a', subagentRunId: 'task-a' },
      {
        type: 'tool_use',
        id: 'tu-1',
        name: 'Read',
        input: { path: 'x' },
        subagentRunId: 'task-a',
      },
      {
        type: 'tool_result',
        id: 'tu-1',
        output: 'ok',
        subagentRunId: 'task-a',
      } as AgentMessage,
      { type: 'subagent_finished', subagentRunId: 'task-n', output: 'n' },
      { type: 'text', content: 'parent again' },
      { type: 'subagent_error', subagentRunId: 'task-a', message: 'boom' },
    ]);

    await expect(runThroughClient(events)).resolves.toBeUndefined();
  });

  it('accepts a run that ends with a child still open, closed as run_ended', async () => {
    const events = await collect([
      { type: 'subagent_started', subagentRunId: 'task-a' },
      { type: 'text', content: 'working', subagentRunId: 'task-a' },
    ]);

    expect(
      events.some(
        (event) =>
          event.type === EventType.SUBAGENT_ERROR &&
          (event as { code?: string }).code === 'run_ended',
      ),
    ).toBe(true);
    await expect(runThroughClient(events)).resolves.toBeUndefined();
  });

  it('rejects an invalid sequence, so the harness is actually verifying', async () => {
    const events = await collect([{ type: 'text', content: 'hello' }]);
    const withoutStart = events.filter(
      (event) => event.type !== EventType.TEXT_MESSAGE_START,
    );

    await expect(runThroughClient(withoutStart)).rejects.toThrow();
  });
});
