/**
 * AG-UI Message History
 *
 * Converts DB message rows to CopilotKit-compatible AG-UI message format.
 * Includes full fidelity: user, text, tool_use, tool_result, thinking, plan, error.
 */

import {
  MEDIA_DOWNLOAD_ACTIVITY,
  reconcileDownloadSnapshot,
} from '@neumar/video-ir';

import type { Message } from '@/shared/db/types';

import {
  parseSubagentRecord,
  SUBAGENT_MESSAGE_TYPE,
  type SubagentRun,
} from './subagent-record';

/** CopilotKit-compatible message shape (from useAgent().messages) */
export interface AGUIHistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'reasoning' | 'activity';
  content?: string | Record<string, unknown>;
  activityType?: string;
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
  /** Sub-agent invocation that produced this message; absent for the parent run. */
  subagentRunId?: string;
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
  /** A message never mixes the parent's output with a child's, or two children's. */
  const switchOwner = (owner: string | undefined) => {
    if (currentAssistant && currentAssistant.subagentRunId !== owner) {
      flushAssistant();
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
              ...(msg.subagent_run_id
                ? { subagentRunId: msg.subagent_run_id }
                : {}),
            });
          }
        } else if (msg.content) {
          const owner = msg.subagent_run_id ?? undefined;
          switchOwner(owner);
          // Accumulate text into current assistant message or create new one
          if (currentAssistant) {
            currentAssistant.content =
              (currentAssistant.content ?? '') + msg.content;
          } else {
            currentAssistant = {
              id: msg.message_id ?? String(msg.id),
              role: 'assistant',
              content: msg.content,
              ...(owner ? { subagentRunId: owner } : {}),
            };
          }
        }
        break;
      }

      case 'tool_use': {
        // Tool calls attach to the current assistant message
        const toolOwner = msg.subagent_run_id ?? undefined;
        switchOwner(toolOwner);
        if (!currentAssistant) {
          currentAssistant = {
            id: `assistant_${msg.id}`,
            role: 'assistant',
            content: '',
            ...(toolOwner ? { subagentRunId: toolOwner } : {}),
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
          ...(msg.subagent_run_id
            ? { subagentRunId: msg.subagent_run_id }
            : {}),
        });
        break;
      }

      case 'activity': {
        flushAssistant();
        let content: unknown;
        try {
          content = JSON.parse(msg.content ?? '');
        } catch {
          break;
        }
        if (
          !content ||
          typeof content !== 'object' ||
          Array.isArray(content) ||
          (msg.subtype !== 'plan' &&
            msg.subtype !== 'status' &&
            msg.subtype !== MEDIA_DOWNLOAD_ACTIVITY) ||
          // A download card is addressed by its scoped id, so a row without a
          // message id cannot be one and is not replayed.
          (msg.subtype === MEDIA_DOWNLOAD_ACTIVITY &&
            (!msg.message_id ||
              !reconcileDownloadSnapshot(
                msg.task_id,
                msg.message_id,
                undefined,
                content,
              )))
        ) {
          break;
        }
        result.push({
          id: msg.message_id ?? String(msg.id),
          role: 'activity',
          activityType: msg.subtype,
          content: content as Record<string, unknown>,
          ...(msg.subagent_run_id
            ? { subagentRunId: msg.subagent_run_id }
            : {}),
        });
        break;
      }

      case SUBAGENT_MESSAGE_TYPE: {
        // Rendered as a sub-agent card from dbMessagesToSubagents, never as
        // a conversation message.
        flushAssistant();
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

/**
 * The sub-agent invocations of a thread, in the order they started. A row that
 * still says `running` belongs to a run that is no longer live: the persister
 * closes every invocation before the run ends, so a leftover only appears when
 * the process died mid-run. Callers that know a run is live keep that state.
 */
export function dbMessagesToSubagents(messages: Message[]): SubagentRun[] {
  const runs: SubagentRun[] = [];
  for (const msg of messages) {
    if (msg.type !== SUBAGENT_MESSAGE_TYPE || !msg.subagent_run_id) continue;
    const record = parseSubagentRecord(msg.content);
    if (record) runs.push({ id: msg.subagent_run_id, ...record });
  }
  return runs;
}
