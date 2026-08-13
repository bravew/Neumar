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
