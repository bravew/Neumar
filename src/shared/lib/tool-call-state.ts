import type { ToolCallState } from '@/shared/types/tool-call';

const PARTIAL_STRING_KEYS = ['file_path', 'path', 'filePath', 'content'];

export function parseToolCallArgs(rawArgs: string): Record<string, unknown> {
  if (!rawArgs) return {};
  try {
    const parsed = JSON.parse(rawArgs) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return extractPartialStringArgs(rawArgs);
  }
}

export function createInProgressToolCallState(rawArgs: string): ToolCallState {
  return {
    phase: 'inProgress',
    partialArgs: parseToolCallArgs(rawArgs),
    rawArgs,
  };
}

export function createExecutingToolCallState(rawArgs: string): ToolCallState {
  return {
    phase: 'executing',
    args: parseToolCallArgs(rawArgs),
    rawArgs,
  };
}

export function createCompleteToolCallState(
  rawArgs: string,
  result: unknown,
): ToolCallState {
  return {
    phase: 'complete',
    args: parseToolCallArgs(rawArgs),
    rawArgs,
    result,
  };
}

export function createErrorToolCallState(
  rawArgs: string,
  message: string,
): ToolCallState {
  return {
    phase: 'error',
    args: parseToolCallArgs(rawArgs),
    rawArgs,
    error: { message },
  };
}

function extractPartialStringArgs(rawArgs: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const key of PARTIAL_STRING_KEYS) {
    const value = extractJsonString(rawArgs, key);
    if (value) args[key] = value;
  }
  return args;
}

function extractJsonString(rawArgs: string, key: string): string | null {
  const keyIndex = rawArgs.indexOf(`"${key}"`);
  if (keyIndex < 0) return null;
  const colonIndex = rawArgs.indexOf(':', keyIndex);
  if (colonIndex < 0) return null;
  const firstQuote = rawArgs.indexOf('"', colonIndex + 1);
  if (firstQuote < 0) return null;

  let escaped = false;
  let value = '';
  for (let i = firstQuote + 1; i < rawArgs.length; i++) {
    const char = rawArgs[i]!;
    if (escaped) {
      value += decodeJsonEscape(char);
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') return value;
    value += char;
  }
  return value || null;
}

function decodeJsonEscape(char: string): string {
  switch (char) {
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    default:
      return char;
  }
}
