import path from 'node:path';

import type { AgentMessage } from '@/core/agent/types';

type JsonRecord = Record<string, unknown>;

export interface PiRpcMapContext {
  runStartedAt: number;
  sentFirstToken: boolean;
}

export interface PiRpcMapResult {
  messages: AgentMessage[];
  terminal: boolean;
  sentFirstToken: boolean;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function errorText(raw: JsonRecord, fallback: string): string {
  return (
    stringOrNull(raw.error) ??
    stringOrNull(raw.reason) ??
    stringOrNull(raw.delta) ??
    stringOrNull(raw.finalError) ??
    fallback
  );
}

function usageFrom(raw: JsonRecord): AgentMessage['usage'] | undefined {
  const message = asRecord(raw.message);
  const usage = asRecord(message?.usage);
  if (!usage) return undefined;

  const normalized: AgentMessage['usage'] = {};
  if (typeof usage.input === 'number') normalized.input_tokens = usage.input;
  if (typeof usage.output === 'number') normalized.output_tokens = usage.output;
  if (typeof usage.cacheRead === 'number') {
    normalized.cache_read_input_tokens = usage.cacheRead;
  }
  if (typeof usage.cacheWrite === 'number') {
    normalized.cache_creation_input_tokens = usage.cacheWrite;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function toolResultText(result: JsonRecord | undefined): string {
  const content = result?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      const record = asRecord(item);
      if (record?.type === 'text') return String(record.text ?? '');
      return JSON.stringify(item);
    })
    .join('\n');
}

// Pi has no native directory-grant flag (no `--add-dir` or sandbox option), so
// allowed dirs are surfaced to the model as plain text via `--append-system-prompt`.
// Pi only honors the *last* `--append-system-prompt` value, so we must collapse
// every absolute dir into a single invocation.
export function buildPiAllowedDirsPrompt(dirs: readonly string[]): string {
  const absolute = dirs.filter(
    (dir) => typeof dir === 'string' && path.isAbsolute(dir),
  );
  if (absolute.length === 0) return '';
  const lines = absolute.map((dir) => `- ${dir}`).join('\n');
  return `You may also access these additional workspace directories outside the current working directory:\n${lines}`;
}

export function buildPiRpcArgs(
  options: {
    model?: string | null;
    reasoning?: string | null;
    extraAllowedDirs?: string[];
  } = {},
): string[] {
  const args = ['--mode', 'rpc'];
  const model = options.model?.trim();
  if (model && model !== 'default') {
    args.push('--model', model);
  }
  const reasoning = options.reasoning?.trim();
  if (reasoning && reasoning !== 'default') {
    args.push('--thinking', reasoning);
  }
  const allowedDirsPrompt = buildPiAllowedDirsPrompt(
    options.extraAllowedDirs ?? [],
  );
  if (allowedDirsPrompt) {
    args.push('--append-system-prompt', allowedDirsPrompt);
  }
  return args;
}

export function buildPiPromptCommand(
  id: number,
  prompt: string,
  images: Array<{ type: 'image'; data: string; mimeType: string }> = [],
  options: { parentSession?: string | null } = {},
): string {
  const parentSession = options.parentSession?.trim();
  return `${JSON.stringify({
    id,
    type: 'prompt',
    message: prompt,
    ...(images.length > 0 ? { images } : {}),
    ...(parentSession ? { parentSession } : {}),
  })}\n`;
}

export function buildPiAbortCommand(id: number): string {
  return `${JSON.stringify({ id, type: 'abort' })}\n`;
}

export function buildPiExtensionUiResponse(raw: JsonRecord): string | null {
  if (raw.id == null) return null;
  const method = typeof raw.method === 'string' ? raw.method : '';
  if (
    method === 'setStatus' ||
    method === 'setWidget' ||
    method === 'notify' ||
    method === 'setTitle' ||
    method === 'set_editor_text'
  ) {
    return null;
  }

  if (method === 'confirm') {
    return `${JSON.stringify({
      type: 'extension_ui_response',
      id: raw.id,
      confirmed: true,
    })}\n`;
  }

  const params = asRecord(raw.params);
  const options = Array.isArray(params?.options)
    ? params.options
    : Array.isArray(raw.options)
      ? raw.options
      : [];
  const first = options[0];
  if (typeof first === 'string') {
    return `${JSON.stringify({
      type: 'extension_ui_response',
      id: raw.id,
      value: first,
    })}\n`;
  }
  const firstRecord = asRecord(first);
  if (firstRecord) {
    return `${JSON.stringify({
      type: 'extension_ui_response',
      id: raw.id,
      value: String(firstRecord.label ?? firstRecord.value ?? ''),
    })}\n`;
  }

  return `${JSON.stringify({
    type: 'extension_ui_response',
    id: raw.id,
    cancelled: true,
  })}\n`;
}

export function mapPiRpcEvent(
  raw: JsonRecord,
  context: PiRpcMapContext,
): PiRpcMapResult {
  const messages: AgentMessage[] = [];
  let sentFirstToken = context.sentFirstToken;

  if (raw.type === 'agent_end') {
    return { messages, terminal: true, sentFirstToken };
  }

  if (raw.type === 'turn_end') {
    const usage = usageFrom(raw);
    if (usage) {
      messages.push({
        type: 'result',
        usage,
        duration: Date.now() - context.runStartedAt,
      });
    }
    return { messages, terminal: false, sentFirstToken };
  }

  const assistantMessageEvent = asRecord(raw.assistantMessageEvent);
  if (raw.type === 'message_update' && assistantMessageEvent) {
    if (
      assistantMessageEvent.type === 'text_delta' &&
      typeof assistantMessageEvent.delta === 'string'
    ) {
      sentFirstToken = true;
      messages.push({
        type: 'text',
        content: assistantMessageEvent.delta,
      });
      return { messages, terminal: false, sentFirstToken };
    }

    if (
      assistantMessageEvent.type === 'thinking_delta' &&
      typeof assistantMessageEvent.delta === 'string'
    ) {
      messages.push({
        type: 'thinking',
        content: assistantMessageEvent.delta,
      });
      return { messages, terminal: false, sentFirstToken };
    }

    if (assistantMessageEvent.type === 'error') {
      messages.push({
        type: 'error',
        message: errorText(assistantMessageEvent, 'Pi agent error'),
      });
      return { messages, terminal: false, sentFirstToken };
    }
  }

  if (raw.type === 'tool_execution_start') {
    messages.push({
      type: 'tool_use',
      id: raw.toolCallId == null ? undefined : String(raw.toolCallId),
      name: raw.toolName == null ? undefined : String(raw.toolName),
      input: raw.args,
    });
    return { messages, terminal: false, sentFirstToken };
  }

  if (raw.type === 'tool_execution_end') {
    messages.push({
      type: 'tool_result',
      toolUseId: raw.toolCallId == null ? undefined : String(raw.toolCallId),
      content: toolResultText(asRecord(raw.result)),
      isError: raw.isError === true,
    });
    return { messages, terminal: false, sentFirstToken };
  }

  if (raw.type === 'extension_error') {
    messages.push({
      type: 'error',
      message: errorText(raw, 'Pi extension error'),
    });
    return { messages, terminal: false, sentFirstToken };
  }

  if (
    raw.type === 'turn_error' ||
    raw.type === 'agent_error' ||
    raw.type === 'error'
  ) {
    messages.push({
      type: 'error',
      message: errorText(raw, 'Pi turn error'),
    });
    return { messages, terminal: false, sentFirstToken };
  }

  if (raw.type === 'auto_retry_end' && raw.success === false) {
    messages.push({
      type: 'error',
      message: errorText(raw, 'Pi auto-retry exhausted'),
    });
    return { messages, terminal: false, sentFirstToken };
  }

  if (
    raw.type === 'agent_start' ||
    raw.type === 'turn_start' ||
    raw.type === 'compaction_start' ||
    raw.type === 'auto_retry_start'
  ) {
    messages.push({
      type: 'system',
      content: String(raw.type),
      isProgress: true,
    });
  }

  return { messages, terminal: false, sentFirstToken };
}
