/**
 * JSONL Stream Parsing Utilities
 */

import type { Readable } from 'stream';

import type { AgentMessage, AgentMessageType } from '@/core/agent/types';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CLI');

/**
 * Parse a JSONL stream into individual JSON objects.
 * Handles line buffering and malformed lines gracefully.
 */
export async function* parseJsonlStream(
  stream: Readable,
): AsyncGenerator<Record<string, unknown>> {
  let buffer = '';

  for await (const chunk of stream) {
    buffer += String(chunk);
    const lines = buffer.split('\n');
    // Keep the last partial line in the buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        logger.warn(`Skipping malformed JSONL line: ${trimmed.slice(0, 100)}`);
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer.trim()) as Record<string, unknown>;
    } catch {
      logger.warn(
        `Skipping malformed final JSONL: ${buffer.trim().slice(0, 100)}`,
      );
    }
  }
}

/** Map of common event type names to AgentMessage types */
const EVENT_TYPE_MAP: Record<string, AgentMessageType> = {
  init: 'session',
  session: 'session',
  message: 'text',
  text: 'text',
  content: 'text',
  tool_use: 'tool_use',
  tool_call: 'tool_use',
  tool_call_start: 'tool_use',
  function_call: 'tool_use',
  tool_result: 'tool_result',
  tool_call_result: 'tool_result',
  tool_call_end: 'tool_result',
  function_result: 'tool_result',
  function_response: 'tool_result',
  error: 'error',
  result: 'result',
  done: 'done',
  complete: 'result',
  thinking: 'thinking',
  plan: 'plan',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function firstRecord(
  raw: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const record = asRecord(raw[key]);
    if (record) return record;
  }
  return null;
}

function firstDefined(
  raw: Record<string, unknown>,
  keys: string[],
): unknown | undefined {
  for (const key of keys) {
    if (raw[key] !== undefined) return raw[key];
  }
  return undefined;
}

/**
 * Normalize a raw JSON object from a CLI adapter to an AgentMessage.
 */
export function normalizeToAgentMessage(
  raw: Record<string, unknown>,
  _adapter: string,
): AgentMessage {
  const eventType = String(
    raw.type || raw.event || raw.kind || 'text',
  ).toLowerCase();

  const mappedType: AgentMessageType = EVENT_TYPE_MAP[eventType] || 'text';
  const toolCall = firstRecord(raw, [
    'toolCall',
    'tool_call',
    'functionCall',
    'function_call',
  ]);
  const toolResult = firstRecord(raw, [
    'toolResult',
    'tool_result',
    'functionResponse',
    'function_response',
    'response',
    'result',
  ]);

  const message: AgentMessage = {
    type: mappedType,
    content:
      typeof raw.content === 'string'
        ? raw.content
        : typeof raw.text === 'string'
          ? raw.text
          : typeof raw.message === 'string'
            ? raw.message
            : undefined,
  };

  // Map common fields
  if (raw.sessionId) message.sessionId = String(raw.sessionId);
  if (raw.session_id) message.sessionId = String(raw.session_id);
  const toolName =
    stringValue(raw.name) ||
    stringValue(raw.toolName) ||
    stringValue(raw.tool_name) ||
    stringValue(toolCall?.name) ||
    stringValue(toolResult?.name);
  if (toolName) message.name = toolName;
  if (raw.id) message.id = String(raw.id);
  const input =
    firstDefined(raw, ['input', 'args', 'arguments']) ??
    firstDefined(toolCall ?? {}, ['input', 'args', 'arguments']);
  if (input !== undefined) message.input = input;
  if (
    raw.toolUseId ||
    raw.tool_use_id ||
    raw.tool_call_id ||
    raw.callId ||
    raw.call_id ||
    toolResult?.id
  ) {
    message.toolUseId = String(
      raw.toolUseId ||
        raw.tool_use_id ||
        raw.tool_call_id ||
        raw.callId ||
        raw.call_id ||
        toolResult?.id,
    );
  }
  const output =
    raw.output !== undefined
      ? raw.output
      : message.type === 'tool_result'
        ? (firstDefined(raw, ['content', 'text', 'message']) ??
          firstDefined(toolResult ?? {}, [
            'output',
            'content',
            'text',
            'message',
          ]))
        : undefined;
  if (output !== undefined) {
    const outputText =
      typeof output === 'string' ? output : JSON.stringify(output);
    message.output = outputText;
    if (message.type === 'tool_result' && !message.content) {
      message.content = outputText;
    }
  }
  if (raw.isError !== undefined || raw.is_error !== undefined) {
    message.isError = Boolean(raw.isError ?? raw.is_error);
  }

  return message;
}
