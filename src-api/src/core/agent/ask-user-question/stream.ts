import type { AgentMessage } from '@/core/agent/types';

import {
  isInsideMarkdownCodeFence,
  updateMarkdownCodeFenceState,
} from '../markdown-code-fence';
import { buildAskUserQuestionToolUse } from './event';
import {
  ASK_USER_QUESTION_FENCE_LANG,
  ASK_USER_QUESTION_TAG_NAMES,
} from './instruction';
import { tryExtractAskUserQuestion } from './parser';

const FENCE_OPEN = `\`\`\`${ASK_USER_QUESTION_FENCE_LANG}`;
const FENCE_CLOSE = '\n```';
const TAG_MARKERS = ASK_USER_QUESTION_TAG_NAMES.map((name) => ({
  open: `<${name}>`,
  close: `</${name}>`,
}));
const OPEN_MARKERS = [{ open: FENCE_OPEN, close: FENCE_CLOSE }, ...TAG_MARKERS];

// Largest prefix of FENCE_OPEN that could be partially streamed; we never
// flush less than this many trailing bytes as text in case they are the
// start of a fence boundary.
const OPEN_LOOKAHEAD = Math.max(
  ...OPEN_MARKERS.map((marker) => marker.open.length),
);

/**
 * Filter for streaming text adapters (HTTP-agent, OpenCode, Cursor, …).
 *
 * Push raw text chunks into `pushChunk(chunk)`; for each chunk the filter
 * yields zero or more `AgentMessage` events:
 *   - Prose that's safely outside a fence is yielded as `{ type: 'text' }`.
 *   - When a complete `neuma:ask_user_question` fence is detected, a
 *     synthetic `{ type: 'tool_use', name: 'AskUserQuestion' }` event is
 *     emitted in its place and the surrounding text continues to stream.
 *
 * Call `flush()` once the upstream stream ends to drain any buffered prose
 * (including a malformed/unterminated fence which falls back to text).
 *
 * The filter never blocks waiting for a fence; if the chunk has no fence
 * marker the buffer is emitted modulo a small lookahead.
 */
export class AskUserQuestionStreamFilter {
  private buffer = '';
  private activeClose: string | null = null;
  private markdownCodeFenceOpen = false;

  *pushChunk(chunk: string): Generator<AgentMessage> {
    if (!chunk) return;
    this.buffer += chunk;
    yield* this.drain(false);
  }

  *flush(): Generator<AgentMessage> {
    yield* this.drain(true);
    if (this.buffer.length > 0) {
      // Either a partial/unterminated fence or trailing safe text — emit as
      // plain text so the user sees something rather than a silent drop.
      yield this.textEvent(this.buffer);
      this.buffer = '';
      this.activeClose = null;
    }
  }

  private *drain(final: boolean): Generator<AgentMessage> {
    while (true) {
      if (!this.activeClose) {
        const marker = findNextOpenMarker(
          this.buffer,
          this.markdownCodeFenceOpen,
        );
        if (!marker) {
          if (final) return;
          // Hold back the trailing bytes that could complete an opener.
          const safeUpTo = Math.max(0, this.buffer.length - OPEN_LOOKAHEAD);
          if (safeUpTo > 0) {
            const safeText = this.buffer.slice(0, safeUpTo);
            this.buffer = this.buffer.slice(safeUpTo);
            yield this.textEvent(safeText);
          }
          return;
        }
        if (marker.index > 0) {
          yield this.textEvent(this.buffer.slice(0, marker.index));
        }
        this.buffer = this.buffer.slice(marker.index);
        this.activeClose = marker.close;
      }

      // activeClose !== null: look for the closing marker after the opener.
      const closeIdx = this.buffer.indexOf(
        this.activeClose,
        this.buffer.startsWith(FENCE_OPEN)
          ? FENCE_OPEN.length
          : this.buffer.indexOf('>') + 1,
      );
      if (closeIdx === -1) {
        // Wait for more chunks; flush() handles the unterminated case.
        return;
      }
      const blockEnd = closeIdx + this.activeClose.length;
      const block = this.buffer.slice(0, blockEnd);
      this.buffer = this.buffer.slice(blockEnd);
      this.activeClose = null;
      const parsed = tryExtractAskUserQuestion(block);
      if (parsed) {
        yield buildAskUserQuestionToolUse(parsed);
      } else {
        // Malformed JSON or schema mismatch — surface the block as text so
        // nothing is lost.
        yield this.textEvent(block);
      }
    }
  }

  private textEvent(content: string): AgentMessage {
    this.markdownCodeFenceOpen = updateMarkdownCodeFenceState(
      this.markdownCodeFenceOpen,
      content,
    );
    return { type: 'text', content };
  }
}

function findNextOpenMarker(
  buffer: string,
  markdownCodeFenceOpen: boolean,
): { index: number; close: string } | null {
  let next: { index: number; close: string } | null = null;
  for (const marker of OPEN_MARKERS) {
    let index = buffer.indexOf(marker.open);
    while (index !== -1) {
      if (!isInsideMarkdownCodeFence(buffer, index, markdownCodeFenceOpen)) {
        if (!next || index < next.index) next = { index, close: marker.close };
        break;
      }
      index = buffer.indexOf(marker.open, index + marker.open.length);
    }
  }
  return next;
}
