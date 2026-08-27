import type { AgentDockMessage } from './useAgentDock';

const MAX_FAILURE_DETAIL_LENGTH = 320;
const ERROR_TEXT_KEYS = new Set(['error', 'message', 'text']);

export function latestAgentFailureDetail(
  messages: readonly AgentDockMessage[],
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.kind === 'action') {
      if (message.action.status === 'failed' && message.action.error) {
        return boundedFailureDetail(
          `${message.action.name}: ${message.action.error}`,
        );
      }
      continue;
    }
    if (message.kind !== 'tool' || message.call.stage !== 'error') continue;
    const detail = toolFailureText(message.call.result);
    if (detail) {
      return boundedFailureDetail(`${message.call.name}: ${detail}`);
    }
  }
  return undefined;
}

function toolFailureText(result: string | undefined): string | undefined {
  const trimmed = result?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return errorTextFromUnknown(parsed) ?? trimmed;
  } catch {
    return trimmed;
  }
}

function errorTextFromUnknown(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return errorTextFromUnknown(parsed) ?? trimmed;
    } catch {
      return trimmed;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = errorTextFromUnknown(item);
      if (nested) return nested;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (!ERROR_TEXT_KEYS.has(key)) continue;
    const nested = errorTextFromUnknown(item);
    if (nested) return nested;
  }
  return undefined;
}

function boundedFailureDetail(detail: string): string {
  if (detail.length <= MAX_FAILURE_DETAIL_LENGTH) return detail;
  return `${detail.slice(0, MAX_FAILURE_DETAIL_LENGTH - 1)}…`;
}
