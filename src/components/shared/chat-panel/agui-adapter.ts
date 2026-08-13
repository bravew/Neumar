import { EventType } from '@ag-ui/core';

import { randomUUID } from '@/shared/utils/uuid';

import {
  asNonEmptyArray,
  type ChatPanelMessage,
  type ChatPanelRole,
  type ChatRunLifecycleStatus,
  type ChatSurfaceKind,
  type ChatSurfacePersistTier,
  type ChatSurfaceRespondedBy,
  type ChatQuestion,
  type ChatQuestionRequest,
  type ChatToolCall,
  type ChatToolCallStage,
} from './types';

export interface ChatPanelAguiEvent extends Record<string, unknown> {
  type?: string;
  seq?: number;
}

export interface ChatPanelAguiMessageLike {
  id: string;
  role: string;
  content?: string;
  toolCalls?: ChatPanelAguiToolCallLike[];
  toolCallId?: string;
  isError?: boolean;
  subtype?: string;
}

export interface ChatPanelAguiToolCallLike {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  name?: string;
  args?: Record<string, unknown>;
  toolStage?: ChatToolCallStage;
  final?: boolean;
}

interface ToolAccumulator {
  name: string;
  argsText: string;
  sourceMessageId?: string;
}

export interface ChatPanelAguiAccumulator {
  textMessageId: string | null;
  reasoningMessageId: string | null;
  toolCalls: Record<string, ToolAccumulator>;
}

export interface ChatPanelAguiState {
  messages: ChatPanelMessage[];
  accumulator: ChatPanelAguiAccumulator;
}

export interface ChatPanelAguiApplyOptions {
  now?: () => string;
  createId?: (prefix: string) => string;
}

const AGUI_EVENT_TYPES = new Set<string>([
  EventType.RUN_STARTED,
  EventType.RUN_FINISHED,
  EventType.RUN_ERROR,
  EventType.TEXT_MESSAGE_START,
  EventType.TEXT_MESSAGE_CONTENT,
  EventType.TEXT_MESSAGE_CHUNK,
  EventType.TEXT_MESSAGE_END,
  EventType.REASONING_MESSAGE_START,
  EventType.REASONING_MESSAGE_CONTENT,
  EventType.REASONING_MESSAGE_CHUNK,
  EventType.REASONING_MESSAGE_END,
  EventType.THINKING_TEXT_MESSAGE_START,
  EventType.THINKING_TEXT_MESSAGE_CONTENT,
  EventType.THINKING_TEXT_MESSAGE_END,
  EventType.TOOL_CALL_START,
  EventType.TOOL_CALL_ARGS,
  EventType.TOOL_CALL_CHUNK,
  EventType.TOOL_CALL_END,
  EventType.TOOL_CALL_RESULT,
  'ERROR',
]);

const AGUI_CANONICAL_KINDS = new Set<string>([
  'agent.message',
  'tool_call',
  'state_update',
  'ui.surface_requested',
  'ui.surface_responded',
  'run.lifecycle',
]);

const SURFACE_KINDS = new Set<ChatSurfaceKind>([
  'form',
  'choice',
  'confirmation',
  'oauth-prompt',
]);

const SURFACE_PERSIST_TIERS = new Set<ChatSurfacePersistTier>([
  'run',
  'conversation',
  'project',
]);

const SURFACE_RESPONDED_BY = new Set<ChatSurfaceRespondedBy>([
  'user',
  'agent',
  'auto',
  'cache',
]);

const LIFECYCLE_STATUSES = new Set<ChatRunLifecycleStatus>([
  'started',
  'pipeline_stage_started',
  'pipeline_stage_completed',
  'completed',
  'cancelled',
  'failed',
]);

export function createChatPanelAguiState(
  messages: ChatPanelMessage[] = [],
): ChatPanelAguiState {
  return {
    messages,
    accumulator: {
      textMessageId: null,
      reasoningMessageId: null,
      toolCalls: {},
    },
  };
}

export function isChatPanelAguiEventPayload(
  payload: Record<string, unknown>,
): payload is ChatPanelAguiEvent {
  const type = getString(payload, 'type');
  const kind = getString(payload, 'kind');
  return Boolean(
    (type && AGUI_EVENT_TYPES.has(type)) ||
    (kind && AGUI_CANONICAL_KINDS.has(kind)),
  );
}

export function reduceChatPanelAguiEvent(
  state: ChatPanelAguiState,
  event: ChatPanelAguiEvent,
  options: ChatPanelAguiApplyOptions = {},
): ChatPanelAguiState {
  const now = options.now ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}:${randomUUID()}`);
  const type = event.type;
  const kind = getString(event, 'kind');

  if (kind && AGUI_CANONICAL_KINDS.has(kind)) {
    return reduceCanonicalAguiEvent(state, event, now, createId);
  }

  switch (type) {
    case EventType.RUN_STARTED:
      return {
        messages: markOpenTools(
          state.messages.filter((message) => {
            if (message.kind === 'question') {
              return message.question.answered === true;
            }
            if (message.kind === 'surface') {
              return (
                message.surface.status !== 'pending' ||
                (message.surface.persist !== undefined &&
                  message.surface.persist !== 'run')
              );
            }
            if (message.kind === 'state') {
              return !/(?:question|todo|delivery)/i.test(message.state.path);
            }
            return true;
          }),
          'Superseded by a new run',
        ),
        accumulator: emptyAccumulator(),
      };
    case EventType.TEXT_MESSAGE_START: {
      const id = getString(event, 'messageId');
      if (!id) return state;
      return {
        messages: upsertTextMessage(state.messages, {
          id,
          kind: 'text',
          role: normalizeRole(getString(event, 'role')) ?? 'assistant',
          content: '',
          createdAt: now(),
        }),
        accumulator: { ...state.accumulator, textMessageId: id },
      };
    }
    case EventType.TEXT_MESSAGE_CONTENT:
    case EventType.TEXT_MESSAGE_CHUNK: {
      const id =
        getString(event, 'messageId') ?? state.accumulator.textMessageId;
      const delta = getString(event, 'delta');
      if (!id || !delta) return state;
      return {
        ...state,
        messages: appendTextDelta(state.messages, id, delta, 'assistant', now),
        accumulator: {
          ...state.accumulator,
          textMessageId: state.accumulator.textMessageId ?? id,
        },
      };
    }
    case EventType.TEXT_MESSAGE_END:
      return {
        ...state,
        accumulator: { ...state.accumulator, textMessageId: null },
      };
    case EventType.REASONING_MESSAGE_START:
    case EventType.THINKING_TEXT_MESSAGE_START: {
      const id = getString(event, 'messageId') ?? createId('reasoning');
      return {
        messages: upsertTextMessage(state.messages, {
          id,
          kind: 'text',
          role: 'reasoning',
          content: '',
          createdAt: now(),
        }),
        accumulator: { ...state.accumulator, reasoningMessageId: id },
      };
    }
    case EventType.REASONING_MESSAGE_CONTENT:
    case EventType.REASONING_MESSAGE_CHUNK:
    case EventType.THINKING_TEXT_MESSAGE_CONTENT: {
      const id =
        getString(event, 'messageId') ?? state.accumulator.reasoningMessageId;
      const delta = getString(event, 'delta');
      if (!id || !delta) return state;
      return {
        ...state,
        messages: appendTextDelta(state.messages, id, delta, 'reasoning', now),
        accumulator: {
          ...state.accumulator,
          reasoningMessageId: state.accumulator.reasoningMessageId ?? id,
        },
      };
    }
    case EventType.REASONING_MESSAGE_END:
    case EventType.THINKING_TEXT_MESSAGE_END:
      return {
        ...state,
        accumulator: { ...state.accumulator, reasoningMessageId: null },
      };
    case EventType.TOOL_CALL_START:
      return reduceToolCallStart(state, event, now);
    case EventType.TOOL_CALL_ARGS:
    case EventType.TOOL_CALL_CHUNK:
      return reduceToolCallArgs(state, event, now);
    case EventType.TOOL_CALL_END:
      return reduceToolCallEnd(state, event);
    case EventType.TOOL_CALL_RESULT:
      return reduceToolCallResult(state, event, now);
    case EventType.RUN_ERROR:
    case 'ERROR': {
      const message =
        getString(event, 'message') ??
        getString(event, 'content') ??
        'Agent stream failed';
      return {
        messages: [
          ...markOpenTools(state.messages, message),
          {
            id: getString(event, 'messageId') ?? createId('run-error'),
            kind: 'text',
            role: 'system',
            content: message,
            createdAt: now(),
            isError: true,
            subtype: getString(event, 'code') ?? 'run_error',
          },
        ],
        accumulator: emptyAccumulator(),
      };
    }
    case EventType.RUN_FINISHED:
      return { ...state, accumulator: emptyAccumulator() };
    default:
      return state;
  }
}

export function finalizeChatPanelAguiState(
  state: ChatPanelAguiState,
  reason: 'finished' | 'aborted',
): ChatPanelAguiState {
  return {
    messages:
      reason === 'aborted'
        ? markOpenTools(state.messages, 'Agent stream was cancelled')
        : state.messages,
    accumulator: emptyAccumulator(),
  };
}

export function normalizeAguiMessages(
  messages: ChatPanelAguiMessageLike[],
  options: ChatPanelAguiApplyOptions = {},
): ChatPanelMessage[] {
  const now = options.now ?? (() => new Date().toISOString());
  const resultByToolId = new Map<string, ChatPanelAguiMessageLike>();
  for (const message of messages) {
    if (message.role === 'tool' && message.toolCallId) {
      resultByToolId.set(message.toolCallId, message);
    }
  }

  const normalized: ChatPanelMessage[] = [];
  for (const message of messages) {
    if (message.role === 'tool') continue;
    const role = normalizeRole(message.role) ?? 'assistant';
    if (message.content) {
      normalized.push({
        id: message.id,
        kind: 'text',
        role,
        content: message.content,
        createdAt: now(),
        isError: message.isError,
        subtype: message.subtype,
      });
    }
    for (const toolCall of message.toolCalls ?? []) {
      const call = normalizeToolCall(toolCall, resultByToolId.get(toolCall.id));
      if (isQuestionToolName(call.name)) {
        const question = buildQuestionRequest(call, message.id);
        if (question) {
          normalized.push({
            id: question.id,
            kind: 'question',
            role: 'assistant',
            question,
            createdAt: now(),
          });
        }
        continue;
      }
      normalized.push({
        id: `tool:${call.id}`,
        kind: 'tool',
        role: 'assistant',
        calls: [call],
        createdAt: now(),
      });
    }
  }
  return normalized;
}

function reduceCanonicalAguiEvent(
  state: ChatPanelAguiState,
  event: ChatPanelAguiEvent,
  now: () => string,
  createId: (prefix: string) => string,
): ChatPanelAguiState {
  const kind = getString(event, 'kind');
  switch (kind) {
    case 'agent.message':
      return reduceCanonicalAgentMessage(state, event, now, createId);
    case 'tool_call':
      return reduceCanonicalToolCall(state, event, now, createId);
    case 'state_update':
      return {
        messages: upsertStateMessage(state.messages, event, now, createId),
        accumulator: state.accumulator,
      };
    case 'ui.surface_requested':
      return {
        messages: upsertSurfaceRequestMessage(
          state.messages,
          event,
          now,
          createId,
        ),
        accumulator: state.accumulator,
      };
    case 'ui.surface_responded':
      return {
        messages: upsertSurfaceResponseMessage(
          state.messages,
          event,
          now,
          createId,
        ),
        accumulator: state.accumulator,
      };
    case 'run.lifecycle':
      return {
        messages: upsertLifecycleMessage(state.messages, event, now, createId),
        accumulator:
          getCanonicalLifecycleStatus(event) === 'completed' ||
          getCanonicalLifecycleStatus(event) === 'cancelled' ||
          getCanonicalLifecycleStatus(event) === 'failed'
            ? emptyAccumulator()
            : state.accumulator,
      };
    default:
      return state;
  }
}

function reduceCanonicalAgentMessage(
  state: ChatPanelAguiState,
  event: ChatPanelAguiEvent,
  now: () => string,
  createId: (prefix: string) => string,
): ChatPanelAguiState {
  const id =
    getString(event, 'messageId') ??
    getString(event, 'id') ??
    state.accumulator.textMessageId ??
    createId('agent-message');
  const text = getString(event, 'text') ?? '';
  const messages = text
    ? appendTextDelta(state.messages, id, text, 'assistant', now)
    : state.messages;
  return {
    messages,
    accumulator: {
      ...state.accumulator,
      textMessageId: event.done === true ? null : id,
    },
  };
}

function reduceCanonicalToolCall(
  state: ChatPanelAguiState,
  event: ChatPanelAguiEvent,
  now: () => string,
  createId: (prefix: string) => string,
): ChatPanelAguiState {
  const id =
    getString(event, 'callId') ?? getString(event, 'id') ?? createId('tool');
  const name =
    getString(event, 'toolName') ?? getString(event, 'name') ?? 'tool';
  const args = isPlainObject(event.args) ? event.args : {};
  const result =
    event.result === undefined
      ? undefined
      : typeof event.result === 'string'
        ? event.result
        : JSON.stringify(event.result);
  const status = getString(event, 'status');
  const stage =
    status === 'completed'
      ? 'complete'
      : status === 'failed'
        ? 'error'
        : status === 'started'
          ? 'executing'
          : 'pending';

  return {
    messages: upsertToolCall(
      state.messages,
      {
        id,
        name,
        stage,
        argsText: JSON.stringify(args),
        args,
        result,
        isError: stage === 'error',
      },
      now,
    ),
    accumulator: state.accumulator,
  };
}

function reduceToolCallStart(
  state: ChatPanelAguiState,
  event: ChatPanelAguiEvent,
  now: () => string,
): ChatPanelAguiState {
  const toolCallId = getString(event, 'toolCallId');
  const toolCallName =
    getString(event, 'toolCallName') ?? getString(event, 'name');
  if (!toolCallId || !toolCallName) return state;
  const accumulator = {
    ...state.accumulator,
    toolCalls: {
      ...state.accumulator.toolCalls,
      [toolCallId]: {
        name: toolCallName,
        argsText: '',
        sourceMessageId: getString(event, 'parentMessageId'),
      },
    },
  };
  if (isQuestionToolName(toolCallName)) {
    return { ...state, accumulator };
  }
  return {
    messages: upsertToolCall(
      state.messages,
      {
        id: toolCallId,
        name: toolCallName,
        stage: 'pending',
        argsText: '',
        args: {},
        sourceMessageId: getString(event, 'parentMessageId'),
      },
      now,
    ),
    accumulator,
  };
}

function reduceToolCallArgs(
  state: ChatPanelAguiState,
  event: ChatPanelAguiEvent,
  now: () => string,
): ChatPanelAguiState {
  const toolCallId = getString(event, 'toolCallId');
  if (!toolCallId) return state;
  const current =
    state.accumulator.toolCalls[toolCallId] ??
    createToolAccumulatorFromChunk(event);
  if (!current) return state;
  const delta = getString(event, 'delta') ?? '';
  const next = { ...current, argsText: `${current.argsText}${delta}` };
  const parsedArgs = parseJsonValue(next.argsText);
  const args = isPlainObject(parsedArgs) ? parsedArgs : {};
  const accumulator = {
    ...state.accumulator,
    toolCalls: { ...state.accumulator.toolCalls, [toolCallId]: next },
  };
  if (isQuestionToolName(next.name)) {
    const question = buildQuestionRequest(
      {
        id: toolCallId,
        name: next.name,
        stage: 'streaming',
        argsText: next.argsText,
        args,
        sourceMessageId: next.sourceMessageId,
      },
      next.sourceMessageId,
    );
    return {
      messages: question
        ? upsertQuestionMessage(state.messages, question, now)
        : state.messages,
      accumulator,
    };
  }
  return {
    messages: upsertToolCall(
      state.messages,
      {
        id: toolCallId,
        name: next.name,
        stage: 'streaming',
        argsText: next.argsText,
        args,
        sourceMessageId: next.sourceMessageId,
      },
      now,
    ),
    accumulator,
  };
}

function reduceToolCallEnd(
  state: ChatPanelAguiState,
  event: ChatPanelAguiEvent,
): ChatPanelAguiState {
  const toolCallId = getString(event, 'toolCallId');
  if (!toolCallId) return state;
  return {
    ...state,
    messages: mapToolCall(state.messages, toolCallId, (call) => ({
      ...call,
      stage:
        call.stage === 'complete' || call.stage === 'error'
          ? call.stage
          : 'executing',
    })),
  };
}

function reduceToolCallResult(
  state: ChatPanelAguiState,
  event: ChatPanelAguiEvent,
  now: () => string,
): ChatPanelAguiState {
  const toolCallId = getString(event, 'toolCallId');
  if (!toolCallId) return state;
  const current = state.accumulator.toolCalls[toolCallId];
  const rawContent = getString(event, 'content') ?? '';
  const parsedResult = parseJsonValue(rawContent);
  const isError = toolResultIsError(parsedResult, rawContent);
  const nextAccumulator = { ...state.accumulator.toolCalls };
  delete nextAccumulator[toolCallId];
  if (current && isQuestionToolName(current.name)) {
    return {
      ...state,
      accumulator: { ...state.accumulator, toolCalls: nextAccumulator },
    };
  }
  return {
    messages: upsertToolCall(
      state.messages,
      {
        id: toolCallId,
        name: current?.name ?? 'tool',
        stage: isError ? 'error' : 'complete',
        argsText: current?.argsText ?? '',
        args: parseArgs(current?.argsText ?? ''),
        result: stringifyToolResult(parsedResult, rawContent),
        isError,
        sourceMessageId: current?.sourceMessageId,
      },
      now,
    ),
    accumulator: { ...state.accumulator, toolCalls: nextAccumulator },
  };
}

function normalizeToolCall(
  toolCall: ChatPanelAguiToolCallLike,
  resultMessage?: ChatPanelAguiMessageLike,
): ChatToolCall {
  const argsText =
    toolCall.function?.arguments ?? JSON.stringify(toolCall.args ?? {});
  const result = resultMessage?.content;
  const parsedResult = parseJsonValue(result ?? '');
  const isError =
    Boolean(resultMessage?.isError) ||
    toolResultIsError(parsedResult, result ?? '');
  return {
    id: toolCall.id,
    name: toolCall.function?.name ?? toolCall.name ?? 'tool',
    stage: result
      ? isError
        ? 'error'
        : 'complete'
      : (toolCall.toolStage ?? 'pending'),
    argsText,
    args: parseArgs(argsText),
    result,
    isError,
  };
}

function upsertTextMessage(
  messages: ChatPanelMessage[],
  next: Extract<ChatPanelMessage, { kind: 'text' }>,
): ChatPanelMessage[] {
  const existing = messages.findIndex((message) => message.id === next.id);
  if (existing < 0) return [...messages, next];
  return messages.map((message, index) =>
    index === existing && message.kind === 'text'
      ? { ...message, ...next }
      : message,
  );
}

function appendTextDelta(
  messages: ChatPanelMessage[],
  id: string,
  delta: string,
  role: ChatPanelRole,
  now: () => string,
): ChatPanelMessage[] {
  const existing = messages.findIndex(
    (message) => message.kind === 'text' && message.id === id,
  );
  if (existing < 0) {
    return [
      ...messages,
      { id, kind: 'text', role, content: delta, createdAt: now() },
    ];
  }
  return messages.map((message, index) =>
    index === existing && message.kind === 'text'
      ? { ...message, content: `${message.content}${delta}` }
      : message,
  );
}

function upsertToolCall(
  messages: ChatPanelMessage[],
  call: ChatToolCall,
  now: () => string,
): ChatPanelMessage[] {
  const id = `tool:${call.id}`;
  const existing = messages.findIndex(
    (message) => message.kind === 'tool' && message.id === id,
  );
  if (existing < 0) {
    return [
      ...messages,
      { id, kind: 'tool', role: 'assistant', calls: [call], createdAt: now() },
    ];
  }
  return mapToolCall(messages, call.id, (current) => ({ ...current, ...call }));
}

function upsertQuestionMessage(
  messages: ChatPanelMessage[],
  question: ChatQuestionRequest,
  now: () => string,
): ChatPanelMessage[] {
  const existing = messages.findIndex((message) => message.id === question.id);
  if (existing < 0) {
    return [
      ...messages,
      {
        id: question.id,
        kind: 'question',
        role: 'assistant',
        question,
        createdAt: now(),
      },
    ];
  }
  return messages.map((message, index) =>
    index === existing && message.kind === 'question'
      ? { ...message, question }
      : message,
  );
}

function upsertSurfaceRequestMessage(
  messages: ChatPanelMessage[],
  event: ChatPanelAguiEvent,
  now: () => string,
  createId: (prefix: string) => string,
): ChatPanelMessage[] {
  const surfaceId =
    getString(event, 'surfaceId') ??
    getString(event, 'id') ??
    createId('surface');
  const surfaceKind = getSurfaceKind(getString(event, 'surfaceKind'));
  const payload = event.payload ?? null;
  const persist = getSurfacePersistTier(
    getString(event, 'persist') ??
      (isPlainObject(payload) ? getString(payload, 'persist') : undefined),
  );
  return upsertSurfaceMessage(messages, {
    id: `surface:${surfaceId}`,
    kind: 'surface',
    role: 'assistant',
    createdAt: now(),
    surface: {
      id: surfaceId,
      kind: surfaceKind,
      status: 'pending',
      payload,
      persist,
    },
  });
}

function upsertSurfaceResponseMessage(
  messages: ChatPanelMessage[],
  event: ChatPanelAguiEvent,
  now: () => string,
  createId: (prefix: string) => string,
): ChatPanelMessage[] {
  const surfaceId =
    getString(event, 'surfaceId') ??
    getString(event, 'id') ??
    createId('surface');
  const id = `surface:${surfaceId}`;
  const respondedBy = getSurfaceRespondedBy(getString(event, 'respondedBy'));
  const existing = messages.find(
    (message) => message.kind === 'surface' && message.id === id,
  );
  const fallbackKind =
    existing?.kind === 'surface' ? existing.surface.kind : 'confirmation';
  return upsertSurfaceMessage(messages, {
    id,
    kind: 'surface',
    role: 'assistant',
    createdAt: existing?.createdAt ?? now(),
    surface: {
      id: surfaceId,
      kind: fallbackKind,
      status: 'resolved',
      payload: existing?.kind === 'surface' ? existing.surface.payload : null,
      persist:
        existing?.kind === 'surface' ? existing.surface.persist : undefined,
      value: event.value ?? null,
      respondedBy,
    },
  });
}

function upsertSurfaceMessage(
  messages: ChatPanelMessage[],
  next: Extract<ChatPanelMessage, { kind: 'surface' }>,
): ChatPanelMessage[] {
  const existing = messages.findIndex((message) => message.id === next.id);
  if (existing < 0) return [...messages, next];
  return messages.map((message, index) =>
    index === existing && message.kind === 'surface'
      ? {
          ...message,
          surface: {
            ...message.surface,
            ...next.surface,
          },
        }
      : message,
  );
}

function upsertLifecycleMessage(
  messages: ChatPanelMessage[],
  event: ChatPanelAguiEvent,
  now: () => string,
  createId: (prefix: string) => string,
): ChatPanelMessage[] {
  const status = getCanonicalLifecycleStatus(event);
  const stageId = getString(event, 'stageId');
  const id =
    getString(event, 'id') ??
    (stageId ? `lifecycle:${status}:${stageId}` : createId('lifecycle'));
  const iteration = getNumber(event, 'iteration');
  const next: Extract<ChatPanelMessage, { kind: 'lifecycle' }> = {
    id,
    kind: 'lifecycle',
    role: 'system',
    createdAt: now(),
    lifecycle: {
      status,
      stageId,
      iteration,
      message: getString(event, 'message'),
    },
  };
  const existing = messages.findIndex((message) => message.id === id);
  if (existing < 0) return [...messages, next];
  return messages.map((message, index) =>
    index === existing && message.kind === 'lifecycle'
      ? { ...message, lifecycle: next.lifecycle }
      : message,
  );
}

function upsertStateMessage(
  messages: ChatPanelMessage[],
  event: ChatPanelAguiEvent,
  now: () => string,
  createId: (prefix: string) => string,
): ChatPanelMessage[] {
  const path = getString(event, 'path') ?? '';
  const id = getString(event, 'id') ?? `state:${path || createId('root')}`;
  const next: Extract<ChatPanelMessage, { kind: 'state' }> = {
    id,
    kind: 'state',
    role: 'system',
    createdAt: now(),
    state: {
      path,
      value: event.value ?? null,
    },
  };
  const existing = messages.findIndex((message) => message.id === id);
  if (existing < 0) return [...messages, next];
  return messages.map((message, index) =>
    index === existing && message.kind === 'state'
      ? { ...message, state: next.state }
      : message,
  );
}

function mapToolCall(
  messages: ChatPanelMessage[],
  toolCallId: string,
  update: (call: ChatToolCall) => ChatToolCall,
): ChatPanelMessage[] {
  return messages.map((message) => {
    if (message.kind !== 'tool') return message;
    const calls = asNonEmptyArray(
      message.calls.map((call) =>
        call.id === toolCallId ? update(call) : call,
      ),
    );
    return calls ? { ...message, calls } : message;
  });
}

function markOpenTools(
  messages: ChatPanelMessage[],
  result: string,
): ChatPanelMessage[] {
  return messages.map((message) => {
    if (message.kind !== 'tool') return message;
    return {
      ...message,
      calls: message.calls.map((call) =>
        call.stage === 'complete' || call.stage === 'error'
          ? call
          : { ...call, stage: 'error', result, isError: true },
      ) as typeof message.calls,
    };
  });
}

function buildQuestionRequest(
  call: ChatToolCall,
  sourceMessageId?: string,
): ChatQuestionRequest | null {
  const questions = asNonEmptyArray(parseChatQuestions(call.args));
  if (!questions) return null;
  return {
    id: `question:${call.id}`,
    toolCallId: call.id,
    questions,
    sourceMessageId,
  };
}

export function parseChatQuestions(args: unknown): ChatQuestion[] {
  if (!isPlainObject(args) || !Array.isArray(args.questions)) return [];
  return args.questions.flatMap((item) => {
    if (!isPlainObject(item)) return [];
    const question = getString(item, 'question');
    if (!question) return [];
    const options = Array.isArray(item.options)
      ? item.options.flatMap((option) => {
          if (!isPlainObject(option)) return [];
          const label = getString(option, 'label');
          if (!label) return [];
          return [{ label, description: getString(option, 'description') }];
        })
      : [];
    return [
      {
        question,
        header: getString(item, 'header') ?? '',
        options,
        multiSelect: Boolean(item.multiSelect),
      },
    ];
  });
}

function createToolAccumulatorFromChunk(
  event: ChatPanelAguiEvent,
): ToolAccumulator | null {
  const name = getString(event, 'toolCallName') ?? getString(event, 'name');
  if (!name) return null;
  return {
    name,
    argsText: '',
    sourceMessageId: getString(event, 'parentMessageId'),
  };
}

function parseArgs(argsText: string): Record<string, unknown> {
  const parsed = parseJsonValue(argsText);
  return isPlainObject(parsed) ? parsed : {};
}

function normalizeRole(role: string | undefined): ChatPanelRole | null {
  if (
    role === 'user' ||
    role === 'assistant' ||
    role === 'system' ||
    role === 'reasoning'
  ) {
    return role;
  }
  return null;
}

function isQuestionToolName(name: string): boolean {
  return name === 'AskUserQuestion';
}

function emptyAccumulator(): ChatPanelAguiAccumulator {
  return { textMessageId: null, reasoningMessageId: null, toolCalls: {} };
}

function stringifyToolResult(parsed: unknown, raw: string): string {
  if (typeof parsed === 'string') return parsed;
  if (parsed && typeof parsed === 'object') {
    try {
      return JSON.stringify(parsed);
    } catch {
      return raw;
    }
  }
  return raw;
}

function toolResultIsError(parsed: unknown, raw: string): boolean {
  if (isPlainObject(parsed)) {
    if (parsed.isError === true) return true;
    if (typeof parsed.error === 'string' && parsed.error.length > 0)
      return true;
  }
  const head = raw.slice(0, 256);
  return (
    /<tool_use_error>/i.test(head) ||
    /\btraceback \(most recent call last\)/i.test(head) ||
    /\bexit code\s*[1-9]\d*\b/i.test(head)
  );
}

function parseJsonValue(value: string): unknown {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function getString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const item = value[key];
  return typeof item === 'string' ? item : undefined;
}

function getNumber(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const item = value[key];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

function getSurfaceKind(value: string | undefined): ChatSurfaceKind {
  return SURFACE_KINDS.has(value as ChatSurfaceKind)
    ? (value as ChatSurfaceKind)
    : 'confirmation';
}

function getSurfacePersistTier(
  value: string | undefined,
): ChatSurfacePersistTier | undefined {
  return SURFACE_PERSIST_TIERS.has(value as ChatSurfacePersistTier)
    ? (value as ChatSurfacePersistTier)
    : undefined;
}

function getSurfaceRespondedBy(
  value: string | undefined,
): ChatSurfaceRespondedBy | undefined {
  return SURFACE_RESPONDED_BY.has(value as ChatSurfaceRespondedBy)
    ? (value as ChatSurfaceRespondedBy)
    : undefined;
}

function getCanonicalLifecycleStatus(
  event: ChatPanelAguiEvent,
): ChatRunLifecycleStatus {
  const status = getString(event, 'status');
  return LIFECYCLE_STATUSES.has(status as ChatRunLifecycleStatus)
    ? (status as ChatRunLifecycleStatus)
    : 'started';
}
