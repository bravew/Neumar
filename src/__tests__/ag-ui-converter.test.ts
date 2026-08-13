import { EventType, type BaseEvent } from '@ag-ui/core';
import { describe, expect, it } from 'vitest';

import {
  aguiToAgentMessage,
  createAGUIConverterState,
} from '@/shared/hooks/agent-messages';

describe('aguiToAgentMessage', () => {
  it('accumulates TEXT_MESSAGE_CONTENT deltas and flushes on TEXT_MESSAGE_END', () => {
    const state = createAGUIConverterState();
    expect(
      aguiToAgentMessage(
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'msg1',
          delta: 'Hello',
        } as unknown as BaseEvent,
        state,
      ),
    ).toEqual([]);
    expect(state.pendingText?.content).toBe('Hello');

    aguiToAgentMessage(
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'msg1',
        delta: ' world',
      } as unknown as BaseEvent,
      state,
    );

    expect(
      aguiToAgentMessage(
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: 'msg1',
        } as unknown as BaseEvent,
        state,
      ),
    ).toEqual([{ type: 'text', id: 'msg1', content: 'Hello world' }]);
    expect(state.pendingText).toBeNull();
  });

  it('emits tool_use on TOOL_CALL_START and tool_result on TOOL_CALL_RESULT', () => {
    const state = createAGUIConverterState();
    expect(
      aguiToAgentMessage(
        {
          type: EventType.TOOL_CALL_START,
          toolCallId: 'tc1',
          toolCallName: 'bash',
        } as unknown as BaseEvent,
        state,
      ),
    ).toEqual([{ type: 'tool_use', id: 'tc1', name: 'bash', input: {} }]);

    expect(
      aguiToAgentMessage(
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: 'tc1',
          delta: '{"cmd":"ls"}',
        } as unknown as BaseEvent,
        state,
      ),
    ).toEqual([]);
    expect(state.pendingToolArgs['tc1']).toBe('{"cmd":"ls"}');

    expect(
      aguiToAgentMessage(
        {
          type: EventType.TOOL_CALL_RESULT,
          toolCallId: 'tc1',
          messageId: 'r1',
          content: 'file.ts',
          role: 'tool',
        } as unknown as BaseEvent,
        state,
      ),
    ).toEqual([{ type: 'tool_result', toolUseId: 'tc1', output: 'file.ts' }]);
    expect(state.pendingToolArgs['tc1']).toBeUndefined();
  });

  it('accumulates REASONING_MESSAGE_CONTENT and flushes on END', () => {
    const state = createAGUIConverterState();
    aguiToAgentMessage(
      {
        type: EventType.REASONING_MESSAGE_CONTENT,
        messageId: 'm',
        delta: 'thinking...',
      } as unknown as BaseEvent,
      state,
    );
    expect(
      aguiToAgentMessage(
        {
          type: EventType.REASONING_MESSAGE_END,
          messageId: 'm',
        } as unknown as BaseEvent,
        state,
      ),
    ).toEqual([{ type: 'thinking', content: 'thinking...' }]);
    expect(state.pendingThinking).toBeNull();
  });

  it('converts RUN_FINISHED to done', () => {
    const state = createAGUIConverterState();
    expect(
      aguiToAgentMessage(
        {
          type: EventType.RUN_FINISHED,
          threadId: 't',
          runId: 'r',
          timestamp: 0,
        } as unknown as BaseEvent,
        state,
      ),
    ).toEqual([{ type: 'done' }]);
  });

  it('converts RUN_ERROR to error', () => {
    const state = createAGUIConverterState();
    expect(
      aguiToAgentMessage(
        {
          type: EventType.RUN_ERROR,
          message: 'Oops',
          timestamp: 0,
        } as unknown as BaseEvent,
        state,
      ),
    ).toEqual([{ type: 'error', message: 'Oops' }]);
  });

  it('converts CUSTOM plan event (with _runId) to plan message', () => {
    const state = createAGUIConverterState();
    const planValue = { goal: 'build app', steps: [], _runId: 'run-123' };
    expect(
      aguiToAgentMessage(
        {
          type: EventType.CUSTOM,
          name: 'plan',
          value: planValue,
        } as unknown as BaseEvent,
        state,
      ),
    ).toEqual([{ type: 'plan', plan: planValue }]);
  });

  it('converts CUSTOM direct_answer to direct_answer message', () => {
    const state = createAGUIConverterState();
    expect(
      aguiToAgentMessage(
        {
          type: EventType.CUSTOM,
          name: 'direct_answer',
          value: 'Here you go',
        } as unknown as BaseEvent,
        state,
      ),
    ).toEqual([{ type: 'direct_answer', content: 'Here you go' }]);
  });

  it('returns [] for infrastructure events (STEP_*, RUN_STARTED, STATE_*)', () => {
    const state = createAGUIConverterState();
    for (const type of [
      EventType.STEP_STARTED,
      EventType.STEP_FINISHED,
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.STATE_DELTA,
    ]) {
      expect(
        aguiToAgentMessage(
          { type, timestamp: 0 } as unknown as BaseEvent,
          state,
        ),
      ).toEqual([]);
    }
  });
});
