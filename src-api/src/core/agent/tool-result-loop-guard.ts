import { createLogger } from '@/shared/utils/logger';

import type { AgentMessage } from './types';

const logger = createLogger('ToolResultLoopGuard');

const DEFAULT_REPEATED_FAILURE_THRESHOLD = 3;
const DEFAULT_CONSECUTIVE_ERROR_THRESHOLD = 5;
const MAX_SIGNATURE_CHARS = 240;

const READ_ONLY_TOOL_NAMES = new Set([
  'Read',
  'Grep',
  'Glob',
  'LS',
  'List',
  'WebFetch',
  'WebSearch',
  'TodoRead',
]);

export interface ToolResultLoopGuardOptions {
  repeatedFailureThreshold?: number;
  consecutiveErrorThreshold?: number;
}

interface ToolUseSnapshot {
  name: string;
  inputSignature: string;
  readOnly: boolean;
}

function summarizeUnknown(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return normalizeText(value);
  try {
    return normalizeText(JSON.stringify(value));
  } catch {
    return normalizeText(String(value));
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_SIGNATURE_CHARS);
}

function isReadOnlyTool(name: string): boolean {
  if (READ_ONLY_TOOL_NAMES.has(name)) return true;
  const lower = name.toLowerCase();
  return (
    lower.includes('read') ||
    lower.includes('grep') ||
    lower.includes('search') ||
    lower.includes('list') ||
    lower.includes('inspect')
  );
}

function toolUseKey(message: AgentMessage): string | null {
  return message.id ?? message.toolUseId ?? null;
}

function toolResultKey(message: AgentMessage): string | null {
  return message.toolUseId ?? message.id ?? null;
}

/**
 * Warn-only guard for loops that are only visible after a tool executes.
 *
 * `LoopGuard` stops identical tool calls before execution in Claude's permission
 * path. This guard observes provider-normalized `tool_use` / `tool_result`
 * messages after execution so non-Claude and bridge-backed runs can surface
 * repeated failing result signatures too.
 */
export class ToolResultLoopGuard {
  private readonly repeatedFailureThreshold: number;
  private readonly consecutiveErrorThreshold: number;
  private readonly toolUses = new Map<string, ToolUseSnapshot>();
  private readonly failureCounts = new Map<string, number>();
  private consecutiveErrors = 0;
  private warningEmitted = false;
  private stopMessage: string | null = null;

  constructor(options: ToolResultLoopGuardOptions = {}) {
    this.repeatedFailureThreshold =
      options.repeatedFailureThreshold ?? DEFAULT_REPEATED_FAILURE_THRESHOLD;
    this.consecutiveErrorThreshold =
      options.consecutiveErrorThreshold ?? DEFAULT_CONSECUTIVE_ERROR_THRESHOLD;
  }

  observe(message: AgentMessage): string | null {
    if (this.warningEmitted) return null;

    if (message.type === 'tool_use') {
      const key = toolUseKey(message);
      if (key && message.name) {
        this.toolUses.set(key, {
          name: message.name,
          inputSignature: summarizeUnknown(message.input),
          readOnly: isReadOnlyTool(message.name),
        });
      }
      return null;
    }

    if (message.type !== 'tool_result') return null;

    const key = toolResultKey(message);
    const toolUse = key ? this.toolUses.get(key) : undefined;
    const toolName = message.name ?? toolUse?.name ?? 'unknown_tool';

    if (!message.isError) {
      this.consecutiveErrors = 0;
      if (!toolUse?.readOnly && !isReadOnlyTool(toolName)) {
        this.failureCounts.clear();
      }
      return null;
    }

    this.consecutiveErrors += 1;
    const failureSignature = [
      toolName,
      toolUse?.inputSignature ?? '',
      summarizeUnknown(message.output ?? message.content ?? message.message),
    ].join('|');
    const repeatedFailures =
      (this.failureCounts.get(failureSignature) ?? 0) + 1;
    this.failureCounts.set(failureSignature, repeatedFailures);

    if (repeatedFailures >= this.repeatedFailureThreshold) {
      return this.trip(
        `Repeated tool failure detected: ${toolName} returned the same error ` +
          `${repeatedFailures} times. Stop retrying the same action and explain ` +
          `the blocker or change approach.`,
      );
    }

    if (this.consecutiveErrors >= this.consecutiveErrorThreshold) {
      return this.trip(
        `Repeated tool failures detected: ${this.consecutiveErrors} tool results ` +
          `in a row errored. Stop retrying and explain the blocker or change approach.`,
      );
    }

    return null;
  }

  get isTripped(): boolean {
    return this.stopMessage !== null;
  }

  reset(): void {
    this.toolUses.clear();
    this.failureCounts.clear();
    this.consecutiveErrors = 0;
    this.warningEmitted = false;
    this.stopMessage = null;
  }

  private trip(message: string): string {
    this.stopMessage = message;
    this.warningEmitted = true;
    logger.warn(message);
    return message;
  }
}

export async function* withToolResultLoopGuard(
  source: AsyncGenerator<AgentMessage>,
  options: ToolResultLoopGuardOptions = {},
): AsyncGenerator<AgentMessage> {
  const guard = new ToolResultLoopGuard(options);

  for await (const message of source) {
    yield message;

    const warning = guard.observe(message);
    if (warning) {
      // Transient in-stream nudge for the agent — isProgress keeps it from
      // persisting as a chat message; progress-only consumers may drop it.
      // The durable record is the logger.warn() emitted by trip().
      yield {
        type: 'planning_status',
        subtype: 'tool_result_loop_warning',
        content: warning,
        isProgress: true,
      };
    }
  }
}
