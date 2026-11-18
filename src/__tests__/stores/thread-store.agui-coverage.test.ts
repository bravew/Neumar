import { EventType } from '@ag-ui/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  THREAD_STORE_IGNORED_EVENT_TYPES,
  THREAD_STORE_REDUCED_EVENT_TYPES,
  useThreadStore,
} from '@/shared/stores/thread-store';

const taskId = 'thread-store-agui-coverage';

afterEach(() => {
  useThreadStore.setState({ threads: {} });
});

describe('thread-store AG-UI event coverage', () => {
  it('classifies every current AG-UI event type', () => {
    const classified = new Set([
      ...THREAD_STORE_REDUCED_EVENT_TYPES,
      ...THREAD_STORE_IGNORED_EVENT_TYPES,
    ]);
    const missing = Object.values(EventType).filter(
      (eventType) => !classified.has(eventType),
    );
    const overlap = [...THREAD_STORE_REDUCED_EVENT_TYPES].filter((eventType) =>
      THREAD_STORE_IGNORED_EVENT_TYPES.has(eventType),
    );

    expect(missing).toEqual([]);
    expect(overlap).toEqual([]);
  });

  it('reduces current chunk event variants into the message tree', () => {
    const store = useThreadStore.getState();
    store.applyAGUIEvent(taskId, {
      type: EventType.TEXT_MESSAGE_CHUNK,
      seq: 1,
      messageId: 'msg-1',
      role: 'assistant',
      delta: 'Hello',
    });
    store.applyAGUIEvent(taskId, {
      type: EventType.TOOL_CALL_CHUNK,
      seq: 2,
      toolCallId: 'tool-1',
      toolCallName: 'Read',
      parentMessageId: 'msg-1',
      delta: '{"file_path"',
    });
    store.applyAGUIEvent(taskId, {
      type: EventType.TOOL_CALL_CHUNK,
      seq: 3,
      toolCallId: 'tool-1',
      delta: ':"a.txt"}',
    });
    store.applyAGUIEvent(taskId, {
      type: EventType.REASONING_MESSAGE_CHUNK,
      seq: 4,
      messageId: 'reasoning-1',
      delta: 'Thinking',
    });

    const messages = useThreadStore.getState().threads[taskId].messages;
    expect(messages.find((m) => m.id === 'msg-1')?.content).toBe('Hello');
    expect(
      messages
        .find((m) => m.id === 'msg-1')
        ?.toolCalls?.find((toolCall) => toolCall.id === 'tool-1')?.function
        .arguments,
    ).toBe('{"file_path":"a.txt"}');
    expect(messages.find((m) => m.id === 'reasoning-1')?.content).toBe(
      'Thinking',
    );
  });

  it('reduces activity snapshots and patches into one message per id', () => {
    const store = useThreadStore.getState();
    store.applyAGUIEvent(taskId, {
      type: EventType.ACTIVITY_SNAPSHOT,
      seq: 5,
      messageId: 'plan-1',
      activityType: 'plan',
      content: {
        status: 'planning',
        steps: [{ title: 'Inspect', status: 'pending' }],
      },
      subagentRunId: 'child-1',
    });
    store.applyAGUIEvent(taskId, {
      type: EventType.ACTIVITY_DELTA,
      seq: 6,
      messageId: 'plan-1',
      activityType: 'plan',
      patch: [{ op: 'replace', path: '/steps/0/status', value: 'completed' }],
    });
    const messages = useThreadStore.getState().threads[taskId].messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'plan-1',
      role: 'activity',
      activityType: 'plan',
      content: {
        status: 'planning',
        steps: [{ title: 'Inspect', status: 'completed' }],
      },
      subagentRunId: 'child-1',
    });
  });

  it('does not merge a replace:false activity snapshot into an existing message', () => {
    const store = useThreadStore.getState();
    store.applyAGUIEvent(taskId, {
      type: EventType.ACTIVITY_SNAPSHOT,
      seq: 1,
      messageId: 'plan-1',
      activityType: 'plan',
      content: { status: 'planning' },
    });
    store.applyAGUIEvent(taskId, {
      type: EventType.ACTIVITY_SNAPSHOT,
      seq: 2,
      messageId: 'plan-1',
      activityType: 'plan',
      content: { status: 'executing' },
      replace: false,
    });
    expect(
      useThreadStore.getState().threads[taskId].messages[0]?.content,
    ).toEqual({
      status: 'planning',
    });
  });

  it('ignores a missing-activity delta, malformed patch, or unsupported activity type', () => {
    const store = useThreadStore.getState();
    store.applyAGUIEvent(taskId, {
      type: EventType.ACTIVITY_DELTA,
      seq: 1,
      messageId: 'missing',
      activityType: 'plan',
      patch: [{ op: 'add', path: '/x', value: 1 }],
    });
    store.applyAGUIEvent(taskId, {
      type: EventType.ACTIVITY_SNAPSHOT,
      seq: 2,
      messageId: 'bad-patch',
      activityType: 'plan',
      content: { status: 'planning' },
    });
    store.applyAGUIEvent(taskId, {
      type: EventType.ACTIVITY_DELTA,
      seq: 3,
      messageId: 'bad-patch',
      activityType: 'plan',
      patch: [{ op: 'remove', path: '/not-there' }],
    });
    store.applyAGUIEvent(taskId, {
      type: EventType.ACTIVITY_SNAPSHOT,
      seq: 4,
      messageId: 'unsupported',
      activityType: 'secret-widget',
      content: { arbitrary: 'data' },
    });
    // Only the valid snapshot is stored; the failed patch left it untouched,
    // and neither the orphan delta nor the unsupported type created a row.
    const messages = useThreadStore.getState().threads[taskId].messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'bad-patch',
      role: 'activity',
      content: { status: 'planning' },
    });
  });

  // The same table runs against the API persister in
  // src-api/test/unit/services/ag-ui/activity-persistence.test.ts; the two
  // patch appliers have no shared package, so identical cases keep them in step.
  const patchActivity = (patch: unknown, content: Record<string, unknown>) => {
    useThreadStore.setState({ threads: {} });
    const store = useThreadStore.getState();
    store.applyAGUIEvent(taskId, {
      type: EventType.ACTIVITY_SNAPSHOT,
      seq: 1,
      messageId: 'status-1',
      activityType: 'status',
      content,
    });
    store.applyAGUIEvent(taskId, {
      type: EventType.ACTIVITY_DELTA,
      seq: 2,
      messageId: 'status-1',
      activityType: 'status',
      patch,
    });
    return useThreadStore.getState().threads[taskId].messages[0]?.content;
  };

  it.each(['01', '1e0', '', '-1', ' 1', '+1', '1.0', '2'])(
    'rejects the non-canonical or out-of-range array key %j',
    (key) => {
      expect(
        patchActivity([{ op: 'replace', path: `/steps/${key}`, value: 'x' }], {
          steps: ['a', 'b'],
        }),
      ).toEqual({ steps: ['a', 'b'] });
    },
  );

  it('accepts a canonical array index, and "-" to append', () => {
    expect(
      patchActivity(
        [
          { op: 'replace', path: '/steps/1', value: 'c' },
          { op: 'add', path: '/steps/-', value: 'd' },
        ],
        { steps: ['a', 'b'] },
      ),
    ).toEqual({ steps: ['a', 'c', 'd'] });
  });

  it('compares a `test` operation by value, not by key order', () => {
    expect(
      patchActivity(
        [
          { op: 'test', path: '/meta', value: { b: 2, a: 1 } },
          { op: 'replace', path: '/phase', value: 'two' },
        ],
        { meta: { a: 1, b: 2 }, phase: 'one' },
      ),
    ).toEqual({ meta: { a: 1, b: 2 }, phase: 'two' });
    expect(
      patchActivity(
        [
          { op: 'test', path: '/meta', value: { a: 1, b: 3 } },
          { op: 'replace', path: '/phase', value: 'three' },
        ],
        { meta: { a: 1, b: 2 }, phase: 'one' },
      ),
    ).toEqual({ meta: { a: 1, b: 2 }, phase: 'one' });
  });

  it('does not read inherited properties through a pointer', () => {
    // Object.prototype clones to `{}`, so an inherited read would be written.
    expect(
      patchActivity([{ op: 'copy', from: '/__proto__', path: '/stolen' }], {
        phase: 'planning',
      }),
    ).toEqual({ phase: 'planning' });
    expect(
      patchActivity([{ op: 'copy', from: '/constructor', path: '/stolen' }], {
        phase: 'planning',
      }),
    ).toEqual({ phase: 'planning' });
  });

  it('fails a patch atomically and refuses prototype pollution', () => {
    expect(
      patchActivity(
        [
          { op: 'replace', path: '/phase', value: 'done' },
          { op: 'remove', path: '/not-there' },
        ],
        { phase: 'planning' },
      ),
    ).toEqual({ phase: 'planning' });
    expect(
      patchActivity([{ op: 'add', path: '/__proto__/x', value: 1 }], {
        phase: 'planning',
      }),
    ).toEqual({ phase: 'planning' });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('reconciles activity roles from MESSAGES_SNAPSHOT without duplicates', () => {
    const store = useThreadStore.getState();
    store.applyAGUIEvent(taskId, {
      type: EventType.ACTIVITY_SNAPSHOT,
      seq: 1,
      messageId: 'plan-1',
      activityType: 'plan',
      content: { status: 'planning' },
    });
    store.applyAGUIEvent(taskId, {
      type: EventType.MESSAGES_SNAPSHOT,
      seq: 2,
      messages: [
        {
          id: 'plan-1',
          role: 'activity',
          activityType: 'plan',
          content: { status: 'planning', steps: [] },
        },
      ],
    });
    const messages = useThreadStore.getState().threads[taskId].messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'plan-1',
      role: 'activity',
      content: { status: 'planning', steps: [] },
    });
  });

  it('tracks tool-call lifecycle stages', () => {
    const store = useThreadStore.getState();
    store.applyAGUIEvent(taskId, {
      type: EventType.TOOL_CALL_START,
      seq: 1,
      toolCallId: 'tool-1',
      toolCallName: 'Bash',
    });
    let toolCall =
      useThreadStore.getState().threads[taskId].messages[0].toolCalls?.[0];
    expect(toolCall?.toolStage).toBe('pending');
    expect(toolCall?.toolState?.phase).toBe('inProgress');
    expect(toolCall?.final).toBe(false);

    store.applyAGUIEvent(taskId, {
      type: EventType.TOOL_CALL_ARGS,
      seq: 2,
      toolCallId: 'tool-1',
      delta: '{"command":"pwd"}',
    });
    toolCall =
      useThreadStore.getState().threads[taskId].messages[0].toolCalls?.[0];
    expect(toolCall?.toolStage).toBe('streaming');
    expect(toolCall?.toolState).toMatchObject({
      phase: 'inProgress',
      partialArgs: { command: 'pwd' },
    });

    store.applyAGUIEvent(taskId, {
      type: EventType.TOOL_CALL_END,
      seq: 3,
      toolCallId: 'tool-1',
    });
    toolCall =
      useThreadStore.getState().threads[taskId].messages[0].toolCalls?.[0];
    expect(toolCall?.toolState).toMatchObject({
      phase: 'executing',
      args: { command: 'pwd' },
    });

    store.applyAGUIEvent(taskId, {
      type: EventType.TOOL_CALL_RESULT,
      seq: 4,
      toolCallId: 'tool-1',
      content: '/tmp',
    });
    toolCall =
      useThreadStore.getState().threads[taskId].messages[0].toolCalls?.[0];
    expect(toolCall?.toolStage).toBe('complete');
    expect(toolCall?.toolState).toMatchObject({
      phase: 'complete',
      args: { command: 'pwd' },
      result: '/tmp',
    });
    expect(toolCall?.final).toBe(true);
  });
});
