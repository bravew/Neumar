import { EventType } from '@ag-ui/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type AGUIStreamEvent,
  type ThreadSubagent,
  useThreadStore,
} from '@/shared/stores/thread-store';

const taskId = 'thread-store-subagents';

const apply = (...events: AGUIStreamEvent[]) => {
  for (const event of events) {
    useThreadStore.getState().applyAGUIEvent(taskId, event);
  }
};
const thread = () => {
  const found = useThreadStore.getState().threads[taskId];
  if (!found) throw new Error('thread was not created');
  return found;
};

afterEach(() => {
  useThreadStore.setState({ threads: {} });
});

describe('thread-store sub-agent lifecycle', () => {
  it('tracks two same-name invocations separately by their run id', () => {
    apply(
      { type: EventType.RUN_STARTED },
      {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: 'task-a',
        name: 'Scan',
        parentToolCallId: 'toolu_A',
      },
      {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: 'task-b',
        name: 'Scan',
        parentToolCallId: 'toolu_B',
      },
      {
        type: EventType.SUBAGENT_FINISHED,
        subagentRunId: 'task-a',
        result: 'Found 3',
      },
    );

    expect(thread().subagents).toMatchObject([
      { id: 'task-a', status: 'completed', result: 'Found 3' },
      { id: 'task-b', status: 'running' },
    ]);
  });

  it("attributes a child's reasoning block to its invocation", () => {
    apply(
      { type: EventType.RUN_STARTED },
      {
        type: EventType.REASONING_MESSAGE_START,
        messageId: 'reason-child',
        subagentRunId: 'task-a',
      },
      {
        type: EventType.REASONING_MESSAGE_CONTENT,
        messageId: 'reason-child',
        delta: 'checking the tree',
      },
      { type: EventType.REASONING_MESSAGE_END, messageId: 'reason-child' },
      {
        type: EventType.REASONING_MESSAGE_START,
        messageId: 'reason-parent',
      },
      {
        type: EventType.REASONING_MESSAGE_CONTENT,
        messageId: 'reason-parent',
        delta: 'deciding what to do',
      },
    );

    const reasoning = thread().messages.filter(
      (message) => message.role === 'reasoning',
    );
    expect(reasoning).toMatchObject([
      {
        id: 'reason-child',
        content: 'checking the tree',
        subagentRunId: 'task-a',
      },
      { id: 'reason-parent', content: 'deciding what to do' },
    ]);
    expect(reasoning[1]?.subagentRunId).toBeUndefined();
  });

  it('records an error with its code and keeps nesting', () => {
    apply(
      {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: 'task-n',
        name: 'Nested',
        parentSubagentRunId: 'task-a',
      },
      {
        type: EventType.SUBAGENT_ERROR,
        subagentRunId: 'task-n',
        message: 'Stopped by user',
        code: 'stopped',
      },
    );

    expect(thread().subagents[0]).toMatchObject({
      parentSubagentRunId: 'task-a',
      status: 'error',
      error: { message: 'Stopped by user', code: 'stopped' },
    });
  });

  it('ignores a duplicate start and a finish for an unknown invocation', () => {
    apply(
      {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: 'task-a',
        name: 'Scan',
      },
      {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: 'task-a',
        name: 'Renamed',
      },
      { type: EventType.SUBAGENT_FINISHED, subagentRunId: 'ghost' },
    );

    expect(thread().subagents).toHaveLength(1);
    expect(thread().subagents[0]?.name).toBe('Scan');
  });

  it('attributes child text and tool calls to their invocation', () => {
    apply(
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm-parent' },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'm-parent',
        delta: 'parent',
      },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'm-parent' },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: 'm-child',
        subagentRunId: 'task-a',
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'm-child',
        delta: 'child',
      },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'm-child' },
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: 'tu-1',
        toolCallName: 'Read',
        subagentRunId: 'task-a',
      },
      {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: 'tu-1',
        content: 'ok',
        subagentRunId: 'task-a',
      },
    );

    const byId = (id: string) => thread().messages.find((m) => m.id === id);
    expect(byId('m-parent')?.subagentRunId).toBeUndefined();
    expect(byId('m-child')).toMatchObject({
      content: 'child',
      subagentRunId: 'task-a',
    });
    const toolHost = thread().messages.find((m) =>
      m.toolCalls?.some((tc) => tc.id === 'tu-1'),
    );
    expect(toolHost?.subagentRunId).toBe('task-a');
    expect(thread().messages.find((m) => m.role === 'tool')).toMatchObject({
      subagentRunId: 'task-a',
    });
  });

  it('ends a child still running when the run finishes, as an error and never completed', () => {
    apply(
      {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: 'task-a',
        name: 'Scan',
      },
      { type: EventType.RUN_FINISHED },
    );

    expect(thread().subagents[0]).toMatchObject({
      status: 'error',
      error: { code: 'run_ended' },
    });
  });

  it('ends a running child on RUN_ERROR too', () => {
    apply(
      {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: 'task-a',
        name: 'Scan',
      },
      { type: EventType.RUN_ERROR, message: 'boom' },
    );

    expect(thread().subagents[0]?.status).toBe('error');
  });

  it('marks a child suspended when its run ends on a decision', () => {
    apply(
      {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: 'task-a',
        name: 'Scan',
      },
      {
        type: EventType.RUN_FINISHED,
        outcome: {
          type: 'interrupt',
          interrupts: [{ id: 'permission:p1', reason: 'tool_permission' }],
        },
      },
    );

    expect(thread().subagents[0]).toMatchObject({ status: 'suspended' });
    expect(thread().subagents[0]?.error).toBeUndefined();
  });

  it('records a suspension the child reported itself', () => {
    apply(
      {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: 'task-a',
        name: 'Scan',
      },
      {
        type: EventType.SUBAGENT_FINISHED,
        subagentRunId: 'task-a',
        outcome: { type: 'suspended', interruptIds: ['permission:p1'] },
      },
    );

    expect(thread().subagents[0]?.status).toBe('suspended');
  });
});

describe('thread-store unnamed sub-agent', () => {
  it('keeps an empty name so the UI can show its localized default', () => {
    apply({ type: EventType.SUBAGENT_STARTED, subagentRunId: 'task-a' });

    expect(thread().subagents[0]?.name).toBe('');
  });
});

describe('thread-store setRunning', () => {
  it('closes a running child when the thread stops running', () => {
    apply({
      type: EventType.SUBAGENT_STARTED,
      subagentRunId: 'task-a',
      name: 'Scan',
    });
    useThreadStore.getState().setRunning(taskId, false);

    expect(thread().subagents[0]).toMatchObject({
      status: 'error',
      error: { code: 'run_ended' },
    });
  });

  it('leaves a running child alone while the thread is running', () => {
    apply({
      type: EventType.SUBAGENT_STARTED,
      subagentRunId: 'task-a',
      name: 'Scan',
    });
    useThreadStore.getState().setRunning(taskId, true);

    expect(thread().subagents[0]?.status).toBe('running');
  });
});

describe('thread-store sub-agent hydration', () => {
  const persisted: ThreadSubagent[] = [
    { id: 'task-a', name: 'Scan', status: 'completed', result: 'done' },
    { id: 'task-b', name: 'Scan', status: 'running' },
  ];

  it('restores persisted invocations for an idle thread, closing a leftover running one', () => {
    useThreadStore
      .getState()
      .hydrateFromDB(taskId, [], false, { subagents: persisted });

    expect(thread().subagents).toMatchObject([
      { id: 'task-a', status: 'completed' },
      { id: 'task-b', status: 'error', error: { code: 'run_ended' } },
    ]);
  });

  it('keeps a running invocation when the run is still live', () => {
    useThreadStore
      .getState()
      .hydrateFromDB(taskId, [], true, { subagents: persisted });

    expect(thread().subagents[1]?.status).toBe('running');
  });

  it('keeps live invocations when a later hydrate carries none', () => {
    apply({
      type: EventType.SUBAGENT_STARTED,
      subagentRunId: 'task-a',
      name: 'Scan',
    });
    useThreadStore.getState().hydrateFromDB(taskId, [], true);

    expect(thread().subagents.map((a) => a.id)).toEqual(['task-a']);
  });

  it('does not mutate the caller-supplied records', () => {
    useThreadStore
      .getState()
      .hydrateFromDB(taskId, [], false, { subagents: persisted });

    expect(persisted[1]?.status).toBe('running');
  });
});
