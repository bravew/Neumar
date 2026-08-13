/**
 * Cursor Agent `--output-format stream-json` parser.
 *
 * Cursor's JSONL stream (with `--stream-partial-output`) interleaves three
 * assistant shapes that must not be double-emitted:
 * - timestamped assistant events WITHOUT `model_call_id`: real-time
 *   incremental deltas — emit verbatim, never dedupe by content (repeated
 *   deltas like "ha","ha" are real content);
 * - assistant events WITH `model_call_id`: a terminal replay of the full
 *   CURRENT turn text — reconcile against what this turn already emitted and
 *   emit only a verified missing suffix;
 * - non-timestamped terminal assistant events: same replay semantics and a
 *   turn boundary.
 *
 * Assistant text is nested under `message.content[*].text`, so a generic
 * top-level JSONL normalizer cannot parse it. Semantics ported from the
 * Open Design reference parser
 * (`_sample/open-design/apps/daemon/src/runtimes/json-event-stream.ts`).
 */

import type { AgentMessage } from '@/core/agent/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Concatenate `message.content[*].text` blocks. */
function extractCursorText(message: unknown): string {
  const content = isRecord(message) ? message.content : undefined;
  const blocks = Array.isArray(content) ? content : [];
  return blocks
    .filter(
      (block): block is { type: 'text'; text: string } =>
        isRecord(block) &&
        block.type === 'text' &&
        typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('');
}

export class CursorAgentStreamParser {
  private buffer = '';
  private textSoFar = '';
  private turnStart = 0;
  /** True once any assistant text was emitted (empty-run detection). */
  sawText = false;
  /** True once a structured error was emitted. */
  sawError = false;

  /** Feed a raw stdout chunk; yields normalized agent messages. */
  *feed(chunk: string): Generator<AgentMessage> {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) yield* this.handleLine(line);
    }
  }

  /** Drain the trailing unterminated line once stdout ends. */
  *flush(): Generator<AgentMessage> {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (rest) yield* this.handleLine(rest);
  }

  private *handleLine(line: string): Generator<AgentMessage> {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      // Non-JSON stdout (startup banner, warnings) — surface as text so
      // nothing the CLI prints is silently dropped.
      yield this.emitText(`${line}\n`);
      return;
    }
    yield* this.handleEvent(obj);
  }

  private *handleEvent(obj: unknown): Generator<AgentMessage> {
    if (!isRecord(obj)) return;

    if (obj.type === 'system' && obj.subtype === 'init') {
      yield {
        type: 'system',
        subtype: 'init',
        model: typeof obj.model === 'string' ? obj.model : undefined,
      };
      return;
    }

    if (obj.type === 'assistant' && obj.message) {
      const text = extractCursorText(obj.message);
      if (typeof obj.model_call_id === 'string') {
        yield* this.reconcileTurnReplay(text);
        return;
      }
      if (!text) return;
      if (typeof obj.timestamp_ms === 'number') {
        yield this.emitText(text);
        return;
      }
      yield* this.reconcileTurnReplay(text);
      return;
    }

    if (obj.type === 'result') {
      const usage = isRecord(obj.usage) ? obj.usage : undefined;
      yield {
        type: 'result',
        duration:
          typeof obj.duration_ms === 'number' ? obj.duration_ms : undefined,
        usage: usage
          ? {
              input_tokens:
                typeof usage.inputTokens === 'number'
                  ? usage.inputTokens
                  : undefined,
              output_tokens:
                typeof usage.outputTokens === 'number'
                  ? usage.outputTokens
                  : undefined,
              cache_read_input_tokens:
                typeof usage.cacheReadTokens === 'number'
                  ? usage.cacheReadTokens
                  : undefined,
              cache_creation_input_tokens:
                typeof usage.cacheWriteTokens === 'number'
                  ? usage.cacheWriteTokens
                  : undefined,
            }
          : undefined,
      };
      return;
    }

    if (obj.type === 'error') {
      this.sawError = true;
      const message =
        typeof obj.message === 'string'
          ? obj.message
          : typeof obj.error === 'string'
            ? obj.error
            : 'Cursor Agent error';
      yield { type: 'error', message, content: message };
      return;
    }
  }

  private emitText(text: string): AgentMessage {
    this.sawText = true;
    this.textSoFar += text;
    return { type: 'text', content: text };
  }

  /**
   * Reconcile a terminal replay (full current-turn text) against what this
   * turn already streamed. Only a verified prefix permits suffix recovery;
   * on divergence leave the append-only stream untouched rather than
   * duplicate already-shown text. Always advances the turn boundary.
   */
  private *reconcileTurnReplay(text: string): Generator<AgentMessage> {
    const emittedTurn = this.textSoFar.slice(this.turnStart);
    if (text && text !== emittedTurn && text.startsWith(emittedTurn)) {
      const suffix = text.slice(emittedTurn.length);
      if (suffix) yield this.emitText(suffix);
    }
    this.turnStart = this.textSoFar.length;
  }
}
