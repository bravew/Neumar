import type { AgentMessage } from '@/core/agent/types';

const OPENCODE_FAILURE_PATTERNS = [
  /\b(?:usage|rate)\s+limit\b.{0,80}\b(?:reached|exceeded|hit|retry|try again)\b/i,
  /\bprovider\b.{0,80}\b(?:error|failed|failure|unavailable)\b/i,
  /\b(?:error|failed|failure)\b.{0,80}\bprovider\b/i,
];

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function frameText(raw: Record<string, unknown>): string | null {
  const direct =
    stringField(raw.message) ||
    stringField(raw.error) ||
    stringField(raw.content) ||
    stringField(raw.text);
  if (direct) return direct;

  const nestedError = raw.error;
  if (nestedError && typeof nestedError === 'object') {
    return stringField((nestedError as Record<string, unknown>).message);
  }

  return null;
}

function failureText(value: string | null): string | null {
  if (!value) return null;
  return OPENCODE_FAILURE_PATTERNS.some((pattern) => pattern.test(value))
    ? value.trim()
    : null;
}

function errorMessage(message: string): AgentMessage {
  return { type: 'error', message, content: message };
}

export function parseOpenCodeOutputLine(line: string): AgentMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const raw = JSON.parse(trimmed) as Record<string, unknown>;
    const eventType = String(
      raw.type || raw.event || raw.kind || '',
    ).toLowerCase();
    const text = frameText(raw);

    if (eventType === 'error' || raw.error) {
      const message = text || trimmed;
      return errorMessage(message);
    }

    const failure = failureText(text || trimmed);
    if (failure) return errorMessage(failure);

    if (text) return { type: 'text', content: text };
    return { type: 'text', content: trimmed };
  } catch {
    const failure = failureText(trimmed);
    if (failure) return errorMessage(failure);
    return { type: 'text', content: line };
  }
}

export function extractOpenCodeErrorText(text: string): string | null {
  for (const line of text.split('\n')) {
    const message = parseOpenCodeOutputLine(line);
    if (message?.type === 'error') {
      return message.message || message.content || null;
    }
  }
  return null;
}

export function shouldFailEmptyOpenCodeRun(
  exitCode: number | null,
  emittedText: boolean,
  emittedError: boolean,
): boolean {
  return exitCode === 0 && !emittedText && !emittedError;
}
