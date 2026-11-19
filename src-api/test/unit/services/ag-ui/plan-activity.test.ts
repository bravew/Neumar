import { HttpAgent } from '@ag-ui/client';
import { EventType, type BaseEvent } from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import { describe, expect, it } from 'vitest';

import type { AgentMessage, TaskPlan } from '../../../../src/core/agent/types';
import {
  AGUIEmitter,
  type AGUIRunContext,
} from '../../../../src/shared/services/ag-ui/emitter';

const PLAN: TaskPlan = {
  id: 'plan-1',
  goal: 'Ship the widget',
  steps: [
    { id: 'step-1', description: 'Write it', status: 'completed' },
    { id: 'step-2', description: 'Test it', status: 'pending' },
  ],
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

async function collect(
  messages: AgentMessage[],
  context?: AGUIRunContext,
): Promise<BaseEvent[]> {
  const emitter = new AGUIEmitter('thread-1', 'run-1', context);
  const events: BaseEvent[] = [];
  for await (const event of emitter.transform(
    (async function* () {
      yield* messages;
    })(),
  )) {
    events.push(event);
  }
  return events;
}

interface ActivityEvent {
  type: EventType;
  messageId: string;
  activityType: string;
  content?: Record<string, unknown>;
  patch?: Array<{ op: string; path: string; value: unknown }>;
}

const planActivities = (events: BaseEvent[]) =>
  (
    events.filter(
      (event) =>
        event.type === EventType.ACTIVITY_SNAPSHOT ||
        event.type === EventType.ACTIVITY_DELTA,
    ) as unknown as ActivityEvent[]
  ).filter((event) => event.activityType === 'plan');

/** Every phase value the emitter wrote to the plan widget, in order. */
const planPhases = (events: BaseEvent[]) =>
  planActivities(events).flatMap((event) =>
    event.content && typeof event.content.phase === 'string'
      ? [event.content.phase]
      : (event.patch ?? [])
          .filter((operation) => operation.path === '/phase')
          .map((operation) => operation.value as string),
  );

/** Plays the events through a real HttpAgent, which applies the patches. */
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

describe('the plan checklist as a standard AG-UI activity', () => {
  it('opens one plan widget awaiting approval on the planning run', async () => {
    const events = await collect([{ type: 'plan', plan: PLAN }], {
      planInterrupt: true,
    });

    const [snapshot] = planActivities(events);
    expect(snapshot).toMatchObject({
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: 'plan-plan-1',
      activityType: 'plan',
      content: {
        phase: 'awaiting_approval',
        goal: 'Ship the widget',
        steps: [
          { id: 'step-1', description: 'Write it', status: 'completed' },
          { id: 'step-2', description: 'Test it', status: 'pending' },
        ],
      },
    });
    // The decision is the next run's starting point, so this run leaves the
    // phase alone instead of settling it as done.
    expect(planPhases(events)).toEqual(['awaiting_approval']);
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      outcome: {
        type: 'interrupt',
        interrupts: [{ id: 'plan:plan-1', reason: 'plan_approval' }],
      },
    });
  });

  it('reopens the same widget as running when the execution run reports the plan', async () => {
    const events = await collect([
      { type: 'plan_activity', plan: PLAN },
      { type: 'text', content: 'Working' },
    ]);

    expect(planActivities(events).map((event) => event.messageId)).toEqual([
      'plan-plan-1',
      'plan-plan-1',
    ]);
    expect(planPhases(events)).toEqual(['running', 'done']);
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      outcome: undefined,
    });
  });

  it('settles as failed when the execution run fails', async () => {
    const events = await collect([
      { type: 'plan_activity', plan: PLAN },
      { type: 'error', message: 'boom' },
    ]);

    expect(planPhases(events)).toEqual(['running', 'failed']);
  });

  it('settles as cancelled when the user stops the execution run', async () => {
    const emitter = new AGUIEmitter('thread-1', 'run-1', {
      signal: AbortSignal.abort(),
    });
    const events: BaseEvent[] = [];
    for await (const event of emitter.transform(
      (async function* () {
        yield { type: 'plan_activity', plan: PLAN } as AgentMessage;
        throw Object.assign(new Error('stopped'), { name: 'AbortError' });
      })(),
    )) {
      events.push(event);
    }

    expect(planPhases(events)).toEqual(['running', 'cancelled']);
  });

  it('opens no widget for a plan without an id', async () => {
    const events = await collect(
      [{ type: 'plan', plan: { ...PLAN, id: '' } }],
      { planInterrupt: true },
    );

    expect(planActivities(events)).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      code: 'INVALID_PLAN',
    });
  });

  it('settles an earlier plan when a later plan has no id', async () => {
    const events = await collect(
      [
        { type: 'plan', plan: PLAN },
        { type: 'plan', plan: { ...PLAN, id: '' } },
      ],
      { planInterrupt: true },
    );

    // The run fails, so the widget the first plan opened must not stay
    // awaiting an approval that can no longer be given.
    expect(planPhases(events)).toEqual(['awaiting_approval', 'failed']);
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      code: 'INVALID_PLAN',
    });
  });

  it('settles the plan a paused run left open when the continuation ends', async () => {
    // A permission continuation runs on a new emitter, which does not re-emit
    // the plan; it starts from the id the paused run kept open.
    const events = await collect([{ type: 'text', content: 'Resumed' }], {
      planActivityId: 'plan-plan-1',
    });

    expect(planActivities(events)).toEqual([
      expect.objectContaining({
        type: EventType.ACTIVITY_DELTA,
        messageId: 'plan-plan-1',
        patch: [{ op: 'replace', path: '/phase', value: 'done' }],
      }),
    ]);
  });

  it('settles the first widget when the run reports a second plan', async () => {
    const events = await collect([
      { type: 'plan_activity', plan: PLAN },
      {
        type: 'plan_activity',
        plan: { ...PLAN, id: 'plan-2', goal: 'Ship it again' },
      },
    ]);

    // The first widget is settled before the second opens: its approval
    // interrupt is replaced, so it would otherwise stay awaiting forever.
    expect(planActivities(events).map((event) => event.messageId)).toEqual([
      'plan-plan-1',
      'plan-plan-1',
      'plan-plan-2',
      'plan-plan-2',
    ]);
    expect(planPhases(events)).toEqual([
      'running',
      'cancelled',
      'running',
      'done',
    ]);
  });

  it('is accepted by the AG-UI client, which applies the phase patch itself', async () => {
    const events = await collect([{ type: 'plan_activity', plan: PLAN }]);

    const widgets = (await runThroughClient(events)).filter(
      (message) => message.role === 'activity',
    );

    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({
      id: 'plan-plan-1',
      activityType: 'plan',
      content: { phase: 'done', goal: 'Ship the widget' },
    });
  });
});
