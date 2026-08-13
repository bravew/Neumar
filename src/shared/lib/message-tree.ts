/**
 * Message Tree Utilities
 *
 * Pure functions for projecting a branching message tree into a flat list
 * for rendering. The tree uses branch_id + parent_message_id from the DB
 * schema to track forks.
 *
 * Algorithm follows the Ably/tldraw pattern: walk from root, select one
 * branch at each fork point via a selections map, output a linear array.
 */

import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';
import type { Message } from '@/shared/db/types';

/** Map from fork-point message ID to the selected branch_id */
export type BranchSelections = Map<number, string>;

export interface ForkPoint {
  /** The message ID where the fork occurs */
  messageId: number;
  /** All branch IDs forking from this point (excluding 'main') */
  branches: string[];
}

/**
 * Flatten a branching message tree into a linear list for Virtuoso.
 *
 * Starts with messages on the 'main' branch. At each fork point where
 * `selections` has an entry, switches to the selected branch for the
 * remainder of the conversation from that point.
 */
export function flattenMessageTree(
  allMessages: Message[],
  selections: BranchSelections,
): Message[] {
  if (allMessages.length === 0) return [];

  // Group messages by branch
  const byBranch = new Map<string, Message[]>();
  for (const msg of allMessages) {
    const bid = msg.branch_id ?? 'main';
    const list = byBranch.get(bid);
    if (list) {
      list.push(msg);
    } else {
      byBranch.set(bid, [msg]);
    }
  }

  // Walk the main branch, switching to selected branches at fork points
  const mainMessages = byBranch.get('main') ?? [];
  const result: Message[] = [];

  for (const msg of mainMessages) {
    result.push(msg);

    // Check if this message is a fork point with a non-main selection
    const selectedBranch = selections.get(msg.id);
    if (selectedBranch && selectedBranch !== 'main') {
      const branchMsgs = byBranch.get(selectedBranch) ?? [];
      // Context copies have parent_message_id === msg.id but id <= msg.id; filter by id to exclude them.
      const afterFork = branchMsgs.filter((m) => m.id > msg.id);
      result.push(...afterFork);
      // Skip remaining main messages after this fork point
      break;
    }
  }

  return result;
}

/**
 * Find all fork points in a message set — messages that have multiple
 * branches diverging from them.
 */
export function findForkPoints(allMessages: Message[]): ForkPoint[] {
  const forkMap = new Map<number, Set<string>>();

  for (const msg of allMessages) {
    if (
      msg.parent_message_id != null &&
      msg.branch_id &&
      msg.branch_id !== 'main'
    ) {
      const set = forkMap.get(msg.parent_message_id);
      if (set) {
        set.add(msg.branch_id);
      } else {
        forkMap.set(msg.parent_message_id, new Set([msg.branch_id]));
      }
    }
  }

  return Array.from(forkMap.entries()).map(([messageId, branchSet]) => ({
    messageId,
    branches: Array.from(branchSet),
  }));
}

/**
 * Convert projected DB messages into AGUIMessage[] for display.
 *
 * This is a simplified frontend version of the backend's `dbMessagesToFullAGUI`.
 * It handles user messages, text (assistant) messages, and tool use/result messages.
 * Thinking blocks are skipped. Consecutive text blocks are merged.
 */
export function dbMessagesToAGUI(messages: Message[]): AGUIMessage[] {
  const result: AGUIMessage[] = [];
  const seenUserContent = new Set<string>();

  for (const msg of messages) {
    switch (msg.type) {
      case 'user': {
        if (msg.content) {
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
        if (msg.subtype === 'thinking') break;
        if (msg.content) {
          const prev = result[result.length - 1];
          if (prev && prev.role === 'assistant' && !prev.toolCalls?.length) {
            prev.content = (prev.content ?? '') + msg.content;
          } else {
            result.push({
              id: msg.message_id ?? String(msg.id),
              role: 'assistant',
              content: msg.content,
            });
          }
        }
        break;
      }
      case 'tool_use': {
        const prev = result[result.length - 1];
        const tc = {
          id: msg.tool_use_id ?? `tc_${msg.id}`,
          type: 'function' as const,
          function: {
            name: msg.tool_name ?? 'unknown',
            arguments: msg.tool_input ?? '{}',
          },
        };
        if (prev && prev.role === 'assistant') {
          prev.toolCalls = [...(prev.toolCalls ?? []), tc];
        } else {
          result.push({
            id: `assistant_${msg.id}`,
            role: 'assistant',
            content: '',
            toolCalls: [tc],
          });
        }
        break;
      }
      case 'tool_result': {
        result.push({
          id: msg.tool_use_id ?? `tool_${msg.id}`,
          role: 'tool',
          content: msg.tool_output ?? msg.content ?? '',
          toolCallId: msg.tool_use_id ?? undefined,
        });
        break;
      }
      case 'result': {
        if (msg.content) {
          result.push({
            id: msg.message_id ?? String(msg.id),
            role: 'assistant',
            content: msg.content,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return result;
}
