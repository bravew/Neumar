import type { ToolCallState } from '@/shared/types/tool-call';

// AG-UI tool call: { id, type: 'function', function: { name, arguments } }
export interface AGUIToolCall {
  id: string;
  type?: string;
  function?: { name: string; arguments: string };
  toolStage?: 'pending' | 'streaming' | 'complete' | 'error';
  toolState?: ToolCallState;
  final?: boolean;
  // Flattened form (some runtimes)
  name?: string;
  args?: Record<string, unknown>;
}

export interface AGUIMessage {
  id: string;
  role: string;
  content?: string;
  toolCalls?: AGUIToolCall[];
  toolCallId?: string;
  /** Marks this assistant message as a persisted agent error (RUN_ERROR). */
  isError?: boolean;
  /** Optional subtype — e.g. 'dispatch_summary', 'run_error_summary'. */
  subtype?: string;
  /** JSON-encoded MessageAttachment[] for user messages. Travels with the
   *  message so chips survive every rehydration path. */
  attachments?: string;
}

/**
 * One line inside a collapsed activity group — either a narration snippet the
 * agent emitted between tool calls, or a tool call itself. Kept in emission
 * order so the expanded view reads as a timeline.
 */
export type ActivityEntry =
  | { kind: 'note'; id: string; text: string }
  | { kind: 'tool'; tc: AGUIToolCall };

/** Extract tool name from either nested or flat format */
export function getToolName(tc: AGUIToolCall): string {
  return tc.function?.name ?? tc.name ?? 'tool';
}

/** Drop the `mcp__<server>__` prefix so headers stay readable. */
export function shortToolName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, '');
}

/** Extract tool args from either nested or flat format */
export function getToolArgs(tc: AGUIToolCall): Record<string, unknown> {
  if (tc.function?.arguments) {
    try {
      return JSON.parse(tc.function.arguments) as Record<string, unknown>;
    } catch {
      return {
        ...(tc.toolState?.phase === 'inProgress'
          ? tc.toolState.partialArgs
          : {}),
        raw: tc.function.arguments,
      };
    }
  }
  return tc.args ?? {};
}
