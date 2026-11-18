import { HttpAgent } from '@ag-ui/client';
import { EventType, type BaseEvent } from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '../../../../src/core/agent/types';
import { AGUIEmitter } from '../../../../src/shared/services/ag-ui/emitter';

const ACTIVITY_ID = 'planning-status-run-1';

async function collect(
  source: () => AsyncGenerator<AgentMessage>,
): Promise<BaseEvent[]> {
  const emitter = new AGUIEmitter('thread-1', 'run-1');
  const events: BaseEvent[] = [];
  for await (const event of emitter.transform(source())) events.push(event);
  return events;
}

const fromMessages = (messages: AgentMessage[]) =>
  collect(async function* () {
    yield* messages;
  });

const heartbeat = (elapsedMs: number): AgentMessage => ({
  type: 'planning_status',
  content: `Planning ${elapsedMs}`,
  elapsedMs,
});

const activityEvents = (events: BaseEvent[]) =>
  events.filter(
    (event) =>
      event.type === EventType.ACTIVITY_SNAPSHOT ||
      event.type === EventType.ACTIVITY_DELTA,
  ) as unknown as Array<{
    type: EventType;
    messageId: string;
    activityType: string;
    content?: Record<string, unknown>;
    patch?: Array<{ op: string; path: string; value: unknown }>;
  }>;

/** The final phase patch the emitter sent for the planning widget. */
const finalPhase = (events: BaseEvent[]) =>
  activityEvents(events)
    .flatMap((event) => event.patch ?? [])
    .filter((operation) => operation.path === '/phase')
    .map((operation) => operation.value);

/**
 * Plays the events through a real HttpAgent: its verifier rejects an invalid
 * sequence, and its own JSON Patch library applies the deltas, which is an
 * independent check on the patches the emitter writes.
 */
async function runThroughClient(events: BaseEvent[]) {
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
  return agent.messages;
}

describe('planning progress as a standard AG-UI activity', () => {
  it('opens one status activity, patches it per heartbeat, and settles it on the plan', async () => {
    const events = await fromMessages([
      heartbeat(1000),
      heartbeat(2000),
      heartbeat(3000),
      { type: 'plan', plan: { id: 'plan-1', goal: 'g', steps: [] } } as never,
    ]);

    const activity = activityEvents(events);
    expect(activity.map((event) => event.type)).toEqual([
      EventType.ACTIVITY_SNAPSHOT,
      EventType.ACTIVITY_DELTA,
      EventType.ACTIVITY_DELTA,
      EventType.ACTIVITY_DELTA,
    ]);
    expect(new Set(activity.map((event) => event.messageId))).toEqual(
      new Set([ACTIVITY_ID]),
    );
    expect(activity[0]).toMatchObject({
      activityType: 'status',
      content: { phase: 'planning', message: 'Planning 1000', elapsedMs: 1000 },
    });
    expect(finalPhase(events)).toEqual(['done']);
  });

  it('keeps the legacy planning_status event for the legacy runtime', async () => {
    const events = await fromMessages([heartbeat(1000), heartbeat(2000)]);

    const custom = events.filter(
      (event) =>
        event.type === EventType.CUSTOM &&
        (event as unknown as { name: string }).name === 'planning_status',
    );
    expect(custom).toHaveLength(2);
  });

  it('emits nothing when no planning heartbeat was sent', async () => {
    const events = await fromMessages([{ type: 'text', content: 'hi' }]);

    expect(activityEvents(events)).toEqual([]);
  });

  it.each([
    [
      'direct answer',
      [{ type: 'direct_answer', content: 'Just this' }],
      'done',
    ],
    ['work starting', [{ type: 'text', content: 'Working' }], 'done'],
    ['the run ending with no plan', [], 'done'],
  ] as const)('settles as done on %s', async (_name, after, phase) => {
    const events = await fromMessages([
      heartbeat(1000),
      ...(after as unknown as AgentMessage[]),
    ]);

    expect(finalPhase(events)).toEqual([phase]);
  });

  it('settles as failed when the adapter reports an error', async () => {
    const events = await fromMessages([
      heartbeat(1000),
      { type: 'error', message: 'boom' },
    ]);

    expect(finalPhase(events)).toEqual(['failed']);
    const types = events.map((event) => event.type);
    expect(types.indexOf(EventType.ACTIVITY_DELTA)).toBeLessThan(
      types.indexOf(EventType.RUN_ERROR),
    );
  });

  it('settles as failed when the stream throws', async () => {
    const events = await collect(async function* () {
      yield heartbeat(1000);
      throw new Error('upstream died');
    });

    expect(finalPhase(events)).toEqual(['failed']);
  });

  it('settles as cancelled when the user stops the run', async () => {
    const events = await collect(async function* () {
      yield heartbeat(1000);
      throw Object.assign(new Error('stopped'), { name: 'AbortError' });
    });

    expect(finalPhase(events)).toEqual(['cancelled']);
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      outcome: { type: 'cancelled' },
    });
  });

  it('is accepted by the AG-UI client, which applies the patches itself', async () => {
    const events = await fromMessages([
      heartbeat(1000),
      heartbeat(2000),
      { type: 'text', content: 'Done planning' },
    ]);

    const messages = await runThroughClient(events);

    const widgets = messages.filter((message) => message.role === 'activity');
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({
      id: ACTIVITY_ID,
      activityType: 'status',
      content: { phase: 'done', message: 'Planning 2000', elapsedMs: 2000 },
    });
  });

  it('keeps a second planning heartbeat from creating a second widget', async () => {
    const events = await fromMessages([
      heartbeat(1000),
      { type: 'text', content: 'step' },
      heartbeat(5000),
    ]);

    const messages = await runThroughClient(events);

    expect(
      messages.filter((message) => message.role === 'activity'),
    ).toHaveLength(1);
  });
});
