import { EventType } from '@ag-ui/core';
import { describe, expect, it, vi } from 'vitest';

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
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: 'task-a',
        name: 'Scan',
      },
      { now },
    );
    const aborted = finalizeChatPanelAguiState(state, 'aborted');

    expect(aborted.messages[0]).toMatchObject({
      kind: 'tool',
      calls: [{ id: 'tool-1', stage: 'error', isError: true }],
    });
    // The emitter reports a stopped run's open child as run_ended; a local
    // stop can end before that event arrives, so the card must not stay live.
    expect(aborted.messages[1]).toMatchObject({
      id: 'subagent:task-a',
      subagent: { status: 'error' },
    });
    expect(isChatPanelAguiEventPayload({ type: EventType.RUN_ERROR })).toBe(
      true,
    );
  });

  it('closes unfinished tool calls on a cancelled finish but not on a success', () => {
    const started = reduceChatPanelAguiEvent(
      createChatPanelAguiState(),
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: 'tool-1',
        toolCallName: 'Read',
      },
      { now },
    );

    const cancelled = reduceChatPanelAguiEvent(
      started,
      { type: EventType.RUN_FINISHED, outcome: { type: 'cancelled' } },
      { now },
    );
    expect(cancelled.messages[0]).toMatchObject({
      calls: [{ id: 'tool-1', stage: 'error', isError: true }],
    });

    const succeeded = reduceChatPanelAguiEvent(
      started,
      { type: EventType.RUN_FINISHED },
      { now },
    );
    expect(succeeded.messages).toEqual(started.messages);
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

  it('opens an activity widget, patches it, and ignores what it cannot render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let state = createChatPanelAguiState();
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: 'plan-plan-1',
        activityType: 'plan',
        content: { phase: 'running', goal: 'Ship it', steps: [] },
        replace: true,
      },
      { now },
    );
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.ACTIVITY_DELTA,
        messageId: 'plan-plan-1',
        activityType: 'plan',
        patch: [{ op: 'replace', path: '/phase', value: 'done' }],
      },
      { now },
    );

    expect(state.messages).toMatchObject([
      {
        id: 'plan-plan-1',
        kind: 'activity',
        activity: {
          activityType: 'plan',
          content: { phase: 'done', goal: 'Ship it', steps: [] },
        },
      },
    ]);

    const untouched = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: 'plan-plan-1',
        activityType: 'plan',
        content: { phase: 'running' },
        replace: false,
      },
      { now },
    );
    expect(untouched.messages).toEqual(state.messages);
    // `replace: false` is a supported no-op, not a skipped event.
    expect(warn).not.toHaveBeenCalled();

    const skipped = [
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: 'timeline-1',
        activityType: 'timeline',
        content: { items: [] },
      },
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: 'bad-1',
        activityType: 'plan',
        content: 'not an object',
      },
      {
        type: EventType.ACTIVITY_DELTA,
        messageId: 'missing',
        activityType: 'plan',
        patch: [{ op: 'replace', path: '/phase', value: 'done' }],
      },
      {
        type: EventType.ACTIVITY_DELTA,
        messageId: 'plan-plan-1',
        activityType: 'status',
        patch: [{ op: 'replace', path: '/phase', value: 'done' }],
      },
      {
        type: EventType.ACTIVITY_DELTA,
        messageId: 'plan-plan-1',
        activityType: 'plan',
        patch: [{ op: 'replace', path: 'phase', value: 'done' }],
      },
    ];
    for (const event of skipped) {
      expect(reduceChatPanelAguiEvent(state, event, { now })).toBe(state);
    }
    expect(warn).toHaveBeenCalledTimes(skipped.length);
    warn.mockRestore();
  });

  it('keeps a child-owned activity distinct from the parent one', () => {
    let state = createChatPanelAguiState();
    for (const event of [
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: 'status-parent',
        activityType: 'status',
        content: { phase: 'planning' },
        subagentRunId: undefined,
      },
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: 'status-child',
        activityType: 'status',
        content: { phase: 'planning' },
        subagentRunId: 'task-a',
      },
    ]) {
      state = reduceChatPanelAguiEvent(state, event, { now });
    }

    expect(state.messages.map((message) => message.id)).toEqual([
      'status-parent',
      'status-child',
    ]);
    const owners = state.messages.map((message) =>
      message.kind === 'activity' ? message.activity.subagentRunId : 'other',
    );
    expect(owners).toEqual([undefined, 'task-a']);
  });

  it('rejects a snapshot that would change an existing widget type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let state = createChatPanelAguiState();
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: 'widget-1',
        activityType: 'plan',
        content: { phase: 'running', goal: 'Ship it', steps: [] },
      },
      { now },
    );

    const next = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: 'widget-1',
        activityType: 'status',
        content: { phase: 'running' },
      },
      { now },
    );

    // The thread store rejects the same event, so both consumers agree.
    expect(next).toBe(state);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('keeps a widget owner when a replacement omits it', () => {
    let state = createChatPanelAguiState();
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: 'status-1',
        activityType: 'status',
        content: { phase: 'planning' },
        subagentRunId: 'task-a',
      },
      { now },
    );
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: 'status-1',
        activityType: 'status',
        content: { phase: 'running' },
      },
      { now },
    );

    expect(state.messages).toMatchObject([
      {
        id: 'status-1',
        activity: {
          content: { phase: 'running' },
          subagentRunId: 'task-a',
        },
      },
    ]);
  });

  it('adds a card for each sub-agent and settles it from its outcome', () => {
    let state = createChatPanelAguiState();
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: 'task-a',
        name: 'Scan',
      },
      { now },
    );
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.SUBAGENT_FINISHED,
        subagentRunId: 'task-a',
        outcome: {
          type: 'suspended',
          interruptIds: ['permission:p1'],
        },
      },
      { now },
    );
    state = reduceChatPanelAguiEvent(
      state,
      {
        type: EventType.SUBAGENT_ERROR,
        subagentRunId: 'task-b',
        message: 'boom',
      },
      { now },
    );

    expect(state.messages).toMatchObject([
      {
        id: 'subagent:task-a',
        kind: 'subagent',
        subagent: { id: 'task-a', name: 'Scan', status: 'suspended' },
      },
      {
        id: 'subagent:task-b',
        kind: 'subagent',
        subagent: { id: 'task-b', status: 'error' },
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
