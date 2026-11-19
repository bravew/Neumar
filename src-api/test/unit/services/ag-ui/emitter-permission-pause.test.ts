import { afterEach, describe, expect, it } from 'vitest';

import {
  openPermissionWait,
  resetPermissionWaitsForTest,
} from '@/core/agent/permission-waits';
import type { AgentMessage } from '@/core/agent/types';

import { AGUIEmitter } from '@/shared/services/ag-ui/emitter';
import { PausableSource } from '@/shared/services/ag-ui/pausable-source';

afterEach(() => resetPermissionWaitsForTest());

function openWait(taskId: string, id: string): () => void {
  return openPermissionWait({
    taskId,
    sessionId: 's',
    prompt: { id, tool: 'Bash', command: 'ls', description: 'd' },
    expiresAt: null,
  } as never);
}

/** Messages the test releases one at a time. */
function controlledAgent() {
  const queue: Array<AgentMessage | null> = [];
  const waiters: Array<() => void> = [];
  async function* generate(): AsyncGenerator<AgentMessage> {
    for (;;) {
      while (queue.length === 0) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      const next = queue.shift();
      if (next === null) return;
      yield next!;
    }
  }
  return {
    source: new PausableSource<AgentMessage>(generate()),
    push: (message: AgentMessage | null) => {
      queue.push(message);
      waiters.shift()?.();
    },
  };
}

async function collect(
  emitter: AGUIEmitter,
  source: PausableSource<AgentMessage>,
) {
  const events: Array<Record<string, unknown>> = [];
  for await (const event of emitter.transform(source)) {
    events.push(event as unknown as Record<string, unknown>);
  }
  return events;
}

const types = (events: Array<Record<string, unknown>>) =>
  events.map((event) => event.type);
const texts = (events: Array<Record<string, unknown>>) =>
  events
    .filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')
    .map((event) => event.delta);

describe('AGUIEmitter pause at a permission prompt', () => {
  it('ends with an interrupt outcome and leaves the source for the next run', async () => {
    const { source, push } = controlledAgent();
    const first = new AGUIEmitter('t1', 'r1', { taskId: 't1' });
    push({ type: 'text', content: 'before' });

    const running = collect(first, source);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const settle = openWait('t1', 'perm-1');
    const events = await running;

    expect(first.isPaused()).toBe(true);
    expect(texts(events)).toEqual(['before']);
    const finished = events.at(-1) as {
      type: string;
      outcome?: { type: string; interrupts: Array<{ id: string }> };
    };
    expect(finished.type).toBe('RUN_FINISHED');
    expect(finished.outcome?.type).toBe('interrupt');
    expect(finished.outcome?.interrupts.map((i) => i.id)).toEqual([
      'permission:perm-1',
    ]);

    // The agent answers, and the next run picks up exactly where it left off.
    settle();
    push({ type: 'text', content: 'after' });
    push(null);
    const second = new AGUIEmitter('t1', 'r2', { taskId: 't1' });
    const continued = await collect(second, source);

    expect(second.isPaused()).toBe(false);
    expect(texts(continued)).toEqual(['after']);
    expect(
      (continued.at(-1) as { outcome?: unknown } | undefined)?.outcome,
    ).toBeUndefined();
  });

  it('keeps a message that was in flight when the run paused', async () => {
    const { source, push } = controlledAgent();
    const first = new AGUIEmitter('t1', 'r1', { taskId: 't1' });

    const running = collect(first, source);
    await new Promise((resolve) => setTimeout(resolve, 5));
    openWait('t1', 'perm-1');
    // The agent speaks in the same turn the prompt opens.
    push({ type: 'text', content: 'raced' });
    await running;
    resetPermissionWaitsForTest();
    push(null);

    const continued = await collect(
      new AGUIEmitter('t1', 'r2', { taskId: 't1' }),
      source,
    );

    expect(texts(continued)).toEqual(['raced']);
  });

  it('pauses at once when a prompt is already open', async () => {
    const { source } = controlledAgent();
    openWait('t1', 'perm-1');
    const emitter = new AGUIEmitter('t1', 'r1', { taskId: 't1' });

    const events = await collect(emitter, source);

    expect(emitter.isPaused()).toBe(true);
    expect(types(events)).toEqual(['RUN_STARTED', 'RUN_FINISHED']);
  });

  it('does not pause a run with no task for a prompt it does not own', async () => {
    const { source, push } = controlledAgent();
    openWait('other', 'perm-1');
    push({ type: 'text', content: 'hi' });
    push(null);
    const noTask = new AGUIEmitter('t1', 'r1');

    const events = await collect(noTask, source);

    expect(noTask.isPaused()).toBe(false);
    expect(texts(events)).toEqual(['hi']);
  });

  it('answers in place, without ending the run, while a sub-agent is open', async () => {
    const { source, push } = controlledAgent();
    const emitter = new AGUIEmitter('t1', 'r1', { taskId: 't1' });
    push({
      type: 'subagent_started',
      subagentRunId: 'sub-1',
      subagentName: 'helper',
    });

    const running = collect(emitter, source);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const settle = openWait('t1', 'perm-1');
    await new Promise((resolve) => setTimeout(resolve, 10));
    settle();
    push({ type: 'text', content: 'still going' });
    push(null);
    const events = await running;

    expect(emitter.isPaused()).toBe(false);
    expect(texts(events)).toEqual(['still going']);
    const finished = events.at(-1) as { outcome?: unknown };
    expect(finished.outcome).toBeUndefined();
  });
});
