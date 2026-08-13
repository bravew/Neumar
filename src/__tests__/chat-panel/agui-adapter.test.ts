import { EventType } from '@ag-ui/core';
import { describe, expect, it } from 'vitest';

import {
  createChatPanelAguiState,
  finalizeChatPanelAguiState,
  isChatPanelAguiEventPayload,
  normalizeAguiMessages,
  reduceChatPanelAguiEvent,
} from '@/components/shared/chat-panel';

const now = () => '2026-06-14T00:00:00.000Z';

describe('chat-panel AG-UI adapter', () => {
  it('clears stale transient UI when a fresh run starts', () => {
    const state = createChatPanelAguiState([
      {
        id: 'question:old',
        kind: 'question',
        role: 'assistant',
        createdAt: now(),
        question: {
          id: 'question:old',
          toolCallId: 'tool-old',
          questions: [
            {
              question: 'Old question?',
              header: 'Old',
              options: [],
              multiSelect: false,
            },
          ],
        },
      },
      {
        id: 'delivery:old',
        kind: 'state',
        role: 'system',
        createdAt: now(),
        state: { path: 'delivery.pending', value: true },
      },
      {
        id: 'history',
        kind: 'text',
        role: 'assistant',
        createdAt: now(),
        content: 'Keep completed history',
      },
    ]);

    const next = reduceChatPanelAguiEvent(state, {
      type: EventType.RUN_STARTED,
    });

    expect(next.messages).toEqual([expect.objectContaining({ id: 'history' })]);
  });

  it('accumulates text and tool-call lifecycle events', () => {
    let state = createChatPanelAguiState();
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: 'assistant-1',
        role: 'assistant',
      },
      { now },
    );
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'assistant-1',
        delta: 'Working',
      },
      { now },
    );
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        parentMessageId: 'assistant-1',
      },
      { now },
    );
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: 'tool-1',
        delta: '{"file_path":"README.md"}',
      },
      { now },
    );
    state = reduceChatPanelAguiEvent(
      state,
      { type: EventType.TOOL_CALL_END, toolCallId: 'tool-1' },
      { now },
    );
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: 'tool-1',
        content: 'contents',
      },
      { now },
    );

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({
      kind: 'text',
      id: 'assistant-1',
      content: 'Working',
    });
    expect(state.messages[1]).toMatchObject({
      kind: 'tool',
      calls: [
        {
          id: 'tool-1',
          name: 'Read',
          stage: 'complete',
          args: { file_path: 'README.md' },
          result: 'contents',
        },
      ],
    });
  });

  it('normalizes AskUserQuestion tool calls into question messages', () => {
    let state = createChatPanelAguiState();
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: 'question-1',
        toolCallName: 'AskUserQuestion',
      },
      { now },
    );
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: 'question-1',
        delta: JSON.stringify({
          questions: [
            {
              question: 'Which cut should I use?',
              header: 'Cut',
              multiSelect: false,
              options: [{ label: 'A', description: 'Short' }],
            },
          ],
        }),
      },
      { now },
    );

    expect(state.messages).toEqual([
      expect.objectContaining({
        kind: 'question',
        id: 'question:question-1',
        question: expect.objectContaining({
          toolCallId: 'question-1',
          questions: [
            {
              question: 'Which cut should I use?',
              header: 'Cut',
              multiSelect: false,
              options: [{ label: 'A', description: 'Short' }],
            },
          ],
        }),
      }),
    ]);
  });

  it('maps task-like AG-UI messages and tool results into normalized messages', () => {
    const messages = normalizeAguiMessages(
      [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Checking',
          toolCalls: [
            {
              id: 'tool-1',
              function: {
                name: 'Bash',
                arguments: '{"command":"pwd"}',
              },
            },
          ],
        },
        {
          id: 'tool-result-1',
          role: 'tool',
          toolCallId: 'tool-1',
          content: '/tmp',
        },
      ],
      { now },
    );

    expect(messages).toMatchObject([
      { kind: 'text', content: 'Checking' },
      {
        kind: 'tool',
        calls: [
          {
            id: 'tool-1',
            name: 'Bash',
            args: { command: 'pwd' },
            result: '/tmp',
            stage: 'complete',
          },
        ],
      },
    ]);
  });

  it('marks unfinished tool calls when an AG-UI run errors or aborts', () => {
    let state = createChatPanelAguiState();
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: 'tool-1',
        toolCallName: 'Read',
      },
      { now },
    );
    const aborted = finalizeChatPanelAguiState(state, 'aborted');

    expect(aborted.messages[0]).toMatchObject({
      kind: 'tool',
      calls: [{ id: 'tool-1', stage: 'error', isError: true }],
    });
    expect(isChatPanelAguiEventPayload({ type: EventType.RUN_ERROR })).toBe(
      true,
    );
  });

  it('accepts canonical surface request and response events', () => {
    expect(isChatPanelAguiEventPayload({ kind: 'ui.surface_requested' })).toBe(
      true,
    );

    let state = createChatPanelAguiState();
    state = reduceChatPanelAguiEvent(
      state,
      {
        kind: 'ui.surface_requested',
        surfaceId: 'audience',
        surfaceKind: 'form',
        payload: {
          title: 'Audience',
          persist: 'project',
          schema: {
            type: 'object',
            properties: { audience: { type: 'string' } },
          },
        },
      },
      { now },
    );

    expect(state.messages).toEqual([
      expect.objectContaining({
        id: 'surface:audience',
        kind: 'surface',
        role: 'assistant',
        surface: expect.objectContaining({
          id: 'audience',
          kind: 'form',
          status: 'pending',
          persist: 'project',
        }),
      }),
    ]);

    state = reduceChatPanelAguiEvent(
      state,
      {
        kind: 'ui.surface_responded',
        surfaceId: 'audience',
        value: { audience: 'investors' },
        respondedBy: 'cache',
      },
      { now },
    );

    expect(state.messages[0]).toMatchObject({
      id: 'surface:audience',
      kind: 'surface',
      surface: {
        id: 'audience',
        kind: 'form',
        status: 'resolved',
        persist: 'project',
        value: { audience: 'investors' },
        respondedBy: 'cache',
      },
    });
  });

  it('accepts canonical agent message and tool call events', () => {
    let state = createChatPanelAguiState();
    state = reduceChatPanelAguiEvent(
      state,
      {
        kind: 'agent.message',
        messageId: 'assistant-1',
        text: 'Working',
      },
      { now },
    );
    state = reduceChatPanelAguiEvent(
      state,
      {
        kind: 'tool_call',
        callId: 'tool-1',
        toolName: 'Read',
        args: { file_path: 'README.md' },
        status: 'started',
      },
      { now },
    );
    state = reduceChatPanelAguiEvent(
      state,
      {
        kind: 'tool_call',
        callId: 'tool-1',
        toolName: 'Read',
        args: { file_path: 'README.md' },
        result: 'ok',
        status: 'completed',
      },
      { now },
    );

    expect(state.messages).toMatchObject([
      { kind: 'text', id: 'assistant-1', content: 'Working' },
      {
        kind: 'tool',
        calls: [
          {
            id: 'tool-1',
            name: 'Read',
            stage: 'complete',
            args: { file_path: 'README.md' },
            result: 'ok',
          },
        ],
      },
    ]);
  });

  it('normalizes canonical lifecycle and state update events', () => {
    let state = createChatPanelAguiState();
    state = reduceChatPanelAguiEvent(
      state,
      {
        kind: 'run.lifecycle',
        status: 'pipeline_stage_started',
        stageId: 'render',
        iteration: 2,
        message: 'Rendering preview',
      },
      { now },
    );
    state = reduceChatPanelAguiEvent(
      state,
      {
        kind: 'state_update',
        path: 'artifact.status',
        value: 'rendering',
      },
      { now },
    );

    expect(state.messages).toEqual([
      expect.objectContaining({
        kind: 'lifecycle',
        lifecycle: {
          status: 'pipeline_stage_started',
          stageId: 'render',
          iteration: 2,
          message: 'Rendering preview',
        },
      }),
      expect.objectContaining({
        id: 'state:artifact.status',
        kind: 'state',
        state: { path: 'artifact.status', value: 'rendering' },
      }),
    ]);
  });
});
