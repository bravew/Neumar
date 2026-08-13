import { EventType } from '@ag-ui/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type AGUIStreamEvent,
  type ThreadMessage,
  useThreadStore,
} from '@/shared/stores/thread-store';

const taskId = 'thread-store-phase1';

function threadSnapshot(): string {
  return JSON.stringify(useThreadStore.getState().threads[taskId]);
}

afterEach(() => {
  useThreadStore.setState({ threads: {} });
});

describe('thread-store AG-UI replay', () => {
  it('is idempotent when the same seq-bearing event log is replayed', () => {
    const events: AGUIStreamEvent[] = [
      { type: EventType.RUN_STARTED, seq: 0 },
      {
        type: EventType.TEXT_MESSAGE_START,
        seq: 1,
        messageId: 'assistant-1',
        role: 'assistant',
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        seq: 2,
        messageId: 'assistant-1',
        delta: 'hello',
      },
      { type: EventType.TEXT_MESSAGE_END, seq: 3, messageId: 'assistant-1' },
      {
        type: EventType.TOOL_CALL_START,
        seq: 4,
        toolCallId: 'tool-1',
        toolCallName: 'Bash',
        parentMessageId: 'assistant-1',
      },
      {
        type: EventType.TOOL_CALL_ARGS,
        seq: 5,
        toolCallId: 'tool-1',
        delta: '{"command":"pwd"}',
      },
      { type: EventType.TOOL_CALL_END, seq: 6, toolCallId: 'tool-1' },
      {
        type: EventType.TOOL_CALL_RESULT,
        seq: 7,
        toolCallId: 'tool-1',
        messageId: 'tool-result-1',
        content: '/tmp/workspace',
      },
      { type: EventType.RUN_FINISHED, seq: 8 },
    ];

    for (const event of events) {
      useThreadStore.getState().applyAGUIEvent(taskId, event);
    }
    const firstReplay = threadSnapshot();

    for (const event of events) {
      useThreadStore.getState().applyAGUIEvent(taskId, event);
    }

    expect(threadSnapshot()).toBe(firstReplay);
  });
});

describe('thread-store message snapshots', () => {
  it('does not replace a seq-advanced thread with an older shorter mirror', () => {
    const messages: ThreadMessage[] = [
      { id: 'user-1', role: 'user', content: 'run it' },
      { id: 'assistant-1', role: 'assistant', content: 'working' },
    ];
    useThreadStore
      .getState()
      .hydrateFromDB(taskId, messages, true, { lastAppliedSeq: 10 });

    useThreadStore.getState().setMessages(taskId, [messages[0]], true);

    expect(useThreadStore.getState().threads[taskId].messages).toHaveLength(2);
    expect(useThreadStore.getState().threads[taskId].lastAppliedSeq).toBe(10);
  });

  it('hydrates empty histories as a valid loaded thread state', () => {
    useThreadStore.getState().hydrateFromDB(taskId, [], false);

    expect(useThreadStore.getState().threads[taskId]).toMatchObject({
      messages: [],
      isRunning: false,
      hydratedFromDb: true,
      hydrationState: 'hydrated',
    });
  });
});
