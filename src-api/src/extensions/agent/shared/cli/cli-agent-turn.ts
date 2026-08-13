/**
 * Generic single-turn driver for subprocess CLI agent adapters.
 *
 * Wraps `runCliProcess` with the pieces every adapter repeats:
 * - routes parser text through the AskUserQuestion stream filter so fenced
 *   `ask_user_question` blocks become synthetic `tool_use` events (the
 *   Codex/OpenCode/HTTP pattern) instead of leaking raw markdown,
 * - maps non-zero exits / timeouts / empty runs to visible `error` events
 *   rather than empty successful assistant messages,
 * - always terminates the stream with `done`.
 */

import { AskUserQuestionStreamFilter } from '@/core/agent/ask-user-question';
import type { AgentMessage } from '@/core/agent/types';

import { runCliProcess, type CliRunSpec } from './spawn-run';

/** Minimal parser contract: raw stdout chunks in, agent messages out. */
export interface CliStreamParser {
  feed(chunk: string): Generator<AgentMessage>;
  flush(): Generator<AgentMessage>;
  /** True once meaningful assistant text was emitted (empty-run detection). */
  sawText: boolean;
  /** True once the parser emitted a structured error. */
  sawError: boolean;
}

/** Plain-text passthrough for runtimes without a structured stream (Qwen). */
export class PlainTextStreamParser implements CliStreamParser {
  sawText = false;
  sawError = false;

  *feed(chunk: string): Generator<AgentMessage> {
    if (!chunk) return;
    if (chunk.trim()) this.sawText = true;
    yield { type: 'text', content: chunk };
  }

  // eslint-disable-next-line require-yield
  *flush(): Generator<AgentMessage> {
    // Chunk-level passthrough buffers nothing.
  }
}

export interface CliAgentTurnParams {
  spec: CliRunSpec;
  parser: CliStreamParser;
  /** Human-readable runtime name for error text, e.g. `Cursor Agent`. */
  runtimeName: string;
}

/**
 * Drive one CLI run to completion, yielding normalized agent messages.
 * Does NOT yield the leading `session` message — the adapter owns session
 * bookkeeping — but does yield the trailing `done`.
 */
export async function* streamCliAgentTurn(
  params: CliAgentTurnParams,
): AsyncGenerator<AgentMessage> {
  const { spec, parser, runtimeName } = params;
  const askFilter = new AskUserQuestionStreamFilter();

  function* route(message: AgentMessage): Generator<AgentMessage> {
    if (message.type === 'text' && typeof message.content === 'string') {
      yield* askFilter.pushChunk(message.content);
    } else {
      yield* askFilter.flush();
      yield message;
    }
  }

  for await (const event of runCliProcess(spec)) {
    if (event.kind === 'stdout') {
      for (const message of parser.feed(event.chunk)) yield* route(message);
      continue;
    }

    // exit
    for (const message of parser.flush()) yield* route(message);
    yield* askFilter.flush();

    if (event.timedOut) {
      yield {
        type: 'error',
        message: `${runtimeName} run timed out and was terminated.`,
      };
    } else if (event.code !== 0 && event.code !== null) {
      yield {
        type: 'error',
        message:
          event.stderr.trim() ||
          `${runtimeName} exited with code ${event.code}`,
      };
    } else if (!parser.sawText && !parser.sawError) {
      yield {
        type: 'error',
        message:
          event.stderr.trim() ||
          `${runtimeName} completed without producing output.`,
      };
    }

    yield { type: 'done' };
    return;
  }

  // Stdout ended without an exit event (defensive; should not happen).
  yield* askFilter.flush();
  yield { type: 'done' };
}

/**
 * Format conversation history + current prompt for single-shot CLI runtimes
 * (no native thread resume). Caps history to the last 20 messages.
 */
export function formatCliConversationPrompt(
  conversation:
    | Array<{ role: 'user' | 'assistant'; content: string }>
    | undefined,
  prompt: string,
): string {
  if (!conversation || conversation.length === 0) return prompt;
  const recent = conversation.slice(-20);
  const history = recent
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
  return `## Previous Conversation Context\n${history}\n\n## Current Request\n${prompt}`;
}
