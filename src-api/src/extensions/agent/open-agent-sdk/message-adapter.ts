/**
 * Open Agent SDK Message Adapter
 *
 * Maps SDKMessage streaming events to neuma's AgentMessage format.
 * Stateful processor — tracks deduplication state across a session.
 * Follows the same deduplication patterns as the Claude adapter
 * (sentTextHashes + sentToolIds via LimitedSet).
 */

import { limitForDisplay } from '@/core/agent/tool-result-limiter';
import type { AgentMessage } from '@/core/agent/types';

import { defendToolOutput } from '@/shared/security/tool-output-defense';
import { LimitedSet } from '@/shared/utils/limited-set';

import type { SDKMessage } from './types';

/**
 * Simple hash for deduplication — uses first 100 chars of text.
 * Matches the Claude adapter's approach.
 */
function textHash(text: string): string {
  return text.slice(0, 100);
}

type SdkToolResultPayload = {
  tool_use_id: string;
  tool_name?: string;
  output: unknown;
  is_error?: boolean;
};

export class SdkMessageProcessor {
  private sentTextHashes = new LimitedSet<string>(1000);
  private sentToolIds = new LimitedSet<string>(500);
  private toolNames = new Map<string, string>();

  *process(msg: SDKMessage): Generator<AgentMessage> {
    switch (msg.type) {
      case 'assistant': {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'text') {
            const hash = textHash(block.text);
            if (!this.sentTextHashes.has(hash)) {
              this.sentTextHashes.add(hash);
              yield { type: 'text', content: block.text };
            }
          } else if (block.type === 'tool_use') {
            if (!this.sentToolIds.has(block.id)) {
              this.sentToolIds.add(block.id);
              this.toolNames.set(block.id, block.name);
              yield {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input,
              };
            }
          } else if (block.type === 'thinking') {
            yield { type: 'thinking', content: block.thinking };
          }
        }
        break;
      }

      case 'tool_result': {
        const raw = msg.result as SdkToolResultPayload;
        const toolName =
          raw.tool_name || this.toolNames.get(raw.tool_use_id) || 'default';
        const rawOutput =
          typeof raw.output === 'string'
            ? raw.output
            : JSON.stringify(raw.output);
        const defended = defendToolOutput({
          source: {
            adapter: 'open-agent-sdk',
            toolName,
            toolUseId: raw.tool_use_id,
          },
          content: rawOutput,
          riskHint: toolName === 'Bash' ? 'high' : 'normal',
        });
        const { result: displayOutput } = limitForDisplay(
          toolName,
          defended.displayContent,
        );
        yield {
          type: 'tool_result',
          toolUseId: raw.tool_use_id,
          output: displayOutput,
          isError: raw.is_error === true || defended.verdict === 'BLOCK',
          security: {
            verdict: defended.verdict,
            source: 'open-agent-sdk',
            payloadHash: defended.audit.payloadHash,
            redactedSnippet: defended.redactedSnippet,
            scores: defended.scores as Record<string, number>,
          },
        };
        break;
      }

      case 'result': {
        yield {
          type: 'result',
          subtype: msg.subtype,
          cost: msg.total_cost_usd,
          duration: msg.duration_ms,
          usage: msg.usage
            ? {
                input_tokens: msg.usage.input_tokens,
                output_tokens: msg.usage.output_tokens,
                cache_read_input_tokens: msg.usage.cache_read_input_tokens,
                cache_creation_input_tokens:
                  msg.usage.cache_creation_input_tokens,
              }
            : undefined,
        };
        break;
      }

      case 'partial_message': {
        // Partial text is intentionally ignored. The SDK emits the final
        // assistant block after partials; yielding both causes duplicates or
        // truncated final content depending on hash collisions.
        break;
      }

      case 'system': {
        if (msg.subtype === 'init') {
          // System init — skip (we emit our own session message)
          break;
        }
        if (msg.subtype === 'compact_boundary') {
          yield {
            type: 'system',
            subtype: 'compact_boundary',
            content: 'Context was compacted to stay within limits',
            isProgress: true,
          };
          break;
        }
        if (msg.subtype === 'status') {
          yield {
            type: 'planning_status',
            content: (msg as { message?: string }).message ?? 'Processing...',
            isProgress: true,
          };
          break;
        }
        if (msg.subtype === 'rate_limit') {
          const retryMs =
            (msg as { retry_after_ms?: number }).retry_after_ms ?? 0;
          yield {
            type: 'system',
            subtype: 'rate_limit',
            content: `Rate limited — retrying in ${retryMs}ms`,
            isProgress: true,
          };
          break;
        }
        if (msg.subtype === 'task_notification') {
          yield {
            type: 'system',
            subtype: 'task_notification',
            content: (msg as { message?: string }).message ?? 'Task update',
          };
          break;
        }
        break;
      }

      default:
        // Unknown message types — skip silently
        break;
    }
  }

  clear(): void {
    this.sentTextHashes.clear();
    this.sentToolIds.clear();
    this.toolNames.clear();
  }
}
