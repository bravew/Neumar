import { EventType, type BaseEvent } from '@ag-ui/core';
import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '../../../../src/core/agent/types';
import {
  AGUIEmitter,
  type AGUIRunContext,
} from '../../../../src/shared/services/ag-ui/emitter';
import { defined } from '../../../helpers/defined';

async function collect(
  messages: AgentMessage[],
  context?: AGUIRunContext,
): Promise<BaseEvent[]> {
  const emitter = new AGUIEmitter('thread-1', 'run-1', context);
  async function* source() {
    yield* messages;
  }
  const events: BaseEvent[] = [];
  for await (const event of emitter.transform(source())) {
    events.push(event);
  }
  return events;
}

type Tagged = BaseEvent & {
  subagentRunId?: string;
  messageId?: string;
  toolCallId?: string;
};

const ofType = (events: BaseEvent[], type: EventType) =>
  events.filter((event) => event.type === type) as Tagged[];

describe('AG-UI sub-agent lifecycle and attribution', () => {
  it('keeps two same-description children distinct and assigns interleaved output by id', async () => {
    const events = await collect([
      {
        type: 'subagent_started',
        subagentRunId: 'task-a',
        subagentName: 'Scan',
        subagentDescription: 'Scan',
        parentToolCallId: 'toolu_A',
      },
      {
        type: 'subagent_started',
        subagentRunId: 'task-b',
        subagentName: 'Scan',
        subagentDescription: 'Scan',
        parentToolCallId: 'toolu_B',
      },
      { type: 'text', content: 'parent text' },
      { type: 'text', content: 'from a', subagentRunId: 'task-a' },
      { type: 'text', content: 'from b', subagentRunId: 'task-b' },
      {
        type: 'tool_use',
        id: 'tu-1',
        name: 'Read',
        input: { path: 'x' },
        subagentRunId: 'task-a',
      },
      { type: 'subagent_finished', subagentRunId: 'task-a', output: 'done' },
      {
        type: 'subagent_error',
        subagentRunId: 'task-b',
        message: 'boom',
        code: 'failed',
      },
    ]);

    const started = ofType(events, EventType.SUBAGENT_STARTED);
    expect(started.map((e) => e.subagentRunId)).toEqual(['task-a', 'task-b']);

    const starts = ofType(events, EventType.TEXT_MESSAGE_START);
    const aStart = starts.find((e) => e.subagentRunId === 'task-a');
    const bStart = starts.find((e) => e.subagentRunId === 'task-b');
    expect(aStart?.messageId).not.toBe(bStart?.messageId);
    expect(starts.find((e) => e.subagentRunId === undefined)).toBeDefined();

    const contents = ofType(events, EventType.TEXT_MESSAGE_CONTENT);
    expect(
      contents.find((e) => (e as { delta?: string }).delta === 'from a'),
    ).toMatchObject({ subagentRunId: 'task-a', messageId: aStart?.messageId });
    expect(
      contents.find((e) => (e as { delta?: string }).delta === 'from b'),
    ).toMatchObject({ subagentRunId: 'task-b', messageId: bStart?.messageId });

    expect(
      ofType(events, EventType.TOOL_CALL_START).find(
        (e) => e.toolCallId === 'tu-1',
      ),
    ).toMatchObject({ subagentRunId: 'task-a' });

    expect(ofType(events, EventType.SUBAGENT_FINISHED)).toEqual([
      expect.objectContaining({
        subagentRunId: 'task-a',
        result: 'done',
      }),
    ]);
    expect(ofType(events, EventType.SUBAGENT_ERROR)).toEqual([
      expect.objectContaining({
        subagentRunId: 'task-b',
        message: 'boom',
        code: 'failed',
      }),
    ]);
  });

  it('never emits STEP_* for sub-agent invocations', async () => {
    const events = await collect([
      {
        type: 'step_started',
        stepName: 'Scan [task-a]',
        id: 'task-a',
        subagentRunId: 'task-a',
      },
      {
        type: 'step_finished',
        stepName: 'Scan [task-a]',
        id: 'task-a',
        subagentRunId: 'task-a',
      },
      { type: 'step_started', stepName: 'execution' },
      { type: 'step_finished', stepName: 'execution' },
    ]);

    const steps = events.filter(
      (e) =>
        e.type === EventType.STEP_STARTED || e.type === EventType.STEP_FINISHED,
    ) as Array<BaseEvent & { stepName?: string }>;
    expect(steps.map((e) => e.stepName)).toEqual(['execution', 'execution']);
  });

  it('closes a child that never reported completion as an error, not a success', async () => {
    const events = await collect([
      {
        type: 'subagent_started',
        subagentRunId: 'task-a',
        subagentName: 'Scan',
      },
      { type: 'text', content: 'working', subagentRunId: 'task-a' },
    ]);

    expect(ofType(events, EventType.SUBAGENT_FINISHED)).toHaveLength(0);
    const errors = ofType(events, EventType.SUBAGENT_ERROR);
    expect(errors).toEqual([
      expect.objectContaining({ subagentRunId: 'task-a', code: 'run_ended' }),
    ]);
    const errorIndex = events.indexOf(defined(errors[0]));
    const finishedIndex = events.findIndex(
      (e) => e.type === EventType.RUN_FINISHED,
    );
    expect(errorIndex).toBeGreaterThan(-1);
    expect(errorIndex).toBeLessThan(finishedIndex);
  });

  it('suspends an open child when the run ends at a decision', async () => {
    const events = await collect(
      [
        {
          type: 'subagent_started',
          subagentRunId: 'task-a',
          subagentName: 'Scan',
        },
        {
          type: 'plan',
          plan: {
            id: 'plan-1',
            goal: 'Ship it',
            steps: [],
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
        },
      ],
      { planInterrupt: true },
    );

    expect(ofType(events, EventType.SUBAGENT_ERROR)).toHaveLength(0);
    expect(ofType(events, EventType.SUBAGENT_FINISHED)).toEqual([
      expect.objectContaining({
        subagentRunId: 'task-a',
        outcome: { type: 'suspended', interruptIds: ['plan:plan-1'] },
      }),
    ]);
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      outcome: { type: 'interrupt' },
    });
  });

  it('fails an open child when the run throws after it starts', async () => {
    const emitter = new AGUIEmitter('thread-1', 'run-1');
    const events: BaseEvent[] = [];
    for await (const event of emitter.transform(
      (async function* () {
        yield {
          type: 'subagent_started',
          subagentRunId: 'task-a',
          subagentName: 'Scan',
        } as AgentMessage;
        throw new Error('boom');
      })(),
    )) {
      events.push(event);
    }

    expect(ofType(events, EventType.SUBAGENT_FINISHED)).toHaveLength(0);
    expect(ofType(events, EventType.SUBAGENT_ERROR)).toEqual([
      expect.objectContaining({ subagentRunId: 'task-a', code: 'run_ended' }),
    ]);
    expect(events.at(-1)).toMatchObject({ type: EventType.RUN_ERROR });
  });

  it('closes a child text block before parent text resumes', async () => {
    const events = await collect([
      { type: 'text', content: 'child', subagentRunId: 'task-a' },
      { type: 'text', content: 'parent again' },
    ]);

    const starts = ofType(events, EventType.TEXT_MESSAGE_START);
    expect(starts).toHaveLength(2);
    expect(starts.map((e) => e.subagentRunId)).toEqual(['task-a', undefined]);
    const ends = ofType(events, EventType.TEXT_MESSAGE_END);
    expect(ends[0]?.messageId).toBe(starts[0]?.messageId);
  });

  it("attributes a child's reasoning block to its invocation", async () => {
    const events = await collect([
      {
        type: 'thinking',
        content: 'considering the options',
        subagentRunId: 'task-a',
      },
    ]);

    const start = ofType(events, EventType.REASONING_MESSAGE_START)[0];
    expect(start).toMatchObject({ subagentRunId: 'task-a' });
    expect(
      ofType(events, EventType.REASONING_MESSAGE_CONTENT)[0],
    ).toMatchObject({ subagentRunId: 'task-a', messageId: start?.messageId });
    expect(ofType(events, EventType.REASONING_MESSAGE_END)[0]).toMatchObject({
      subagentRunId: 'task-a',
      messageId: start?.messageId,
    });
    // A child's first event still opens its card.
    expect(ofType(events, EventType.SUBAGENT_STARTED)).toHaveLength(1);
  });

  it('does not tag parent-run messages', async () => {
    const events = await collect([
      { type: 'text', content: 'hello' },
      { type: 'tool_use', id: 'tu-0', name: 'Bash', input: {} },
    ]);

    expect(ofType(events, EventType.SUBAGENT_STARTED)).toHaveLength(0);
    for (const event of events) {
      expect((event as Tagged).subagentRunId).toBeUndefined();
    }
  });
});
