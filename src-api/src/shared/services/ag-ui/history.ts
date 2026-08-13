/**
 * AG-UI Message History
 *
 * Converts DB message rows to CopilotKit-compatible AG-UI message format.
 * Includes full fidelity: user, text, tool_use, tool_result, thinking, plan, error.
 */

import type { Message } from '@/shared/db/types';

/** CopilotKit-compatible message shape (from useAgent().messages) */
export interface AGUIHistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'reasoning';
  content?: string;
  /** True when this message represents an agent error (rate limit, auth failure, etc.) */
  isError?: boolean;
  /** Optional message subtype — propagates to the UI for tailored rendering
   *  (e.g. 'dispatch_summary' shows a subtle summary card, 'run_error_summary'
   *  hints that the assistant text was auto-generated after a failed run). */
  subtype?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
    toolStage?: 'pending' | 'streaming' | 'complete' | 'error';
    final?: boolean;
  }>;
  toolCallId?: string;
  /**
   * JSON-encoded `MessageAttachment[]` for user messages. Travels with the
   * message itself (best-practice mirrored from Stream Chat / Gifted Chat
   * / AI SDK) so attachment chips survive every rehydration path — snapshot,
   * history endpoint, store cache — without an out-of-band id→attachments
   * map to keep in sync.
   */
  attachments?: string;
}

/**
 * Convert DB message rows to full-fidelity AG-UI messages.
 *
 * Groups tool_use messages as toolCalls[] on the preceding assistant message
 * (or creates a synthetic one). Handles all message types: user, text,
 * tool_use, tool_result, thinking, plan, error, result.
 */
export function dbMessagesToFullAGUI(
  messages: Message[],
): AGUIHistoryMessage[] {
  const result: AGUIHistoryMessage[] = [];
  let currentAssistant: AGUIHistoryMessage | null = null;
  const completedToolUseIds = new Set(
    messages
      .filter((msg) => msg.type === 'tool_result' && msg.tool_use_id)
      .map((msg) => msg.tool_use_id!),
  );
  /** Track seen user message content to deduplicate across plan/execute runs. */
  const seenUserContent = new Set<string>();

  const flushAssistant = () => {
    if (currentAssistant) {
      result.push(currentAssistant);
      currentAssistant = null;
    }
  };

  for (const msg of messages) {
    switch (msg.type) {
      case 'user': {
        flushAssistant();
        if (msg.content) {
          // Deduplicate: planning + execution can persist the same user message twice
          if (seenUserContent.has(msg.content)) break;
          seenUserContent.add(msg.content);
          result.push({
            id: msg.message_id ?? String(msg.id),
            role: 'user',
            content: msg.content,
            attachments: msg.attachments ?? undefined,
          });
        }
        break;
      }

      case 'text': {
        if (msg.subtype === 'thinking') {
          flushAssistant();
          if (msg.content) {
            result.push({
              id: msg.message_id ?? String(msg.id),
              role: 'reasoning',
              content: msg.content,
              subtype: msg.subtype,
            });
          }
        } else if (msg.content) {
          // Accumulate text into current assistant message or create new one
          if (currentAssistant) {
            currentAssistant.content =
              (currentAssistant.content ?? '') + msg.content;
          } else {
            currentAssistant = {
              id: msg.message_id ?? String(msg.id),
              role: 'assistant',
              content: msg.content,
            };
          }
        }
        break;
      }

      case 'tool_use': {
        // Tool calls attach to the current assistant message
        if (!currentAssistant) {
          currentAssistant = {
            id: `assistant_${msg.id}`,
            role: 'assistant',
            content: '',
          };
        }
        if (!currentAssistant.toolCalls) {
          currentAssistant.toolCalls = [];
        }
        let toolArgs = '{}';
        if (msg.tool_input) {
          // tool_input may already be a JSON string or a raw string
          try {
            JSON.parse(msg.tool_input);
            toolArgs = msg.tool_input;
          } catch {
            toolArgs = JSON.stringify({ raw: msg.tool_input });
          }
        }
        currentAssistant.toolCalls.push({
          id: msg.tool_use_id ?? String(msg.id),
          type: 'function',
          function: {
            name: msg.tool_name ?? 'unknown',
            arguments: toolArgs,
          },
          toolStage:
            msg.tool_use_id && completedToolUseIds.has(msg.tool_use_id)
              ? 'complete'
              : 'pending',
          final: !!msg.tool_use_id && completedToolUseIds.has(msg.tool_use_id),
        });
        break;
      }

      case 'tool_result': {
        flushAssistant();
        result.push({
          id: msg.message_id ?? String(msg.id),
          role: 'tool',
          content: msg.tool_output ?? '',
          toolCallId: msg.tool_use_id ?? undefined,
        });
        break;
      }

      case 'plan': {
        // Plans are rendered by PlanApproval card, not as text messages.
        // Skip to avoid showing raw JSON in the chat.
        flushAssistant();
        break;
      }

      case 'error': {
        flushAssistant();
        result.push({
          id: msg.message_id ?? String(msg.id),
          role: 'assistant',
          content: msg.error_message ?? msg.content ?? 'Unknown error',
          isError: true,
          subtype: msg.subtype ?? undefined,
        });
        break;
      }

      case 'result': {
        flushAssistant();
        // dispatch_summary / run_error_summary are the closing messages the
        // user should see; other result rows are bookkeeping.
        if (
          msg.content &&
          (msg.subtype === 'dispatch_summary' ||
            msg.subtype === 'run_error_summary')
        ) {
          result.push({
            id: msg.message_id ?? String(msg.id),
            role: 'assistant',
            content: msg.content,
            subtype: msg.subtype,
          });
        }
        break;
      }
    }
  }

  flushAssistant();
  return result;
}
