import {
  isInsideMarkdownCodeFence,
  updateMarkdownCodeFenceState,
} from './markdown-code-fence';

const ENVELOPE_OPEN_RE =
  /<(artifact|antml:artifact|dsml|design-artifact|design_artifact)(?:\s[^>]*)?>/gi;

const OPEN_LOOKAHEAD = 256;

interface EnvelopeOpen {
  index: number;
  endIndex: number;
  close: string;
}

/**
 * Streaming text filter for artifact envelopes that should be handled by
 * artifact pipelines, not displayed as assistant prose.
 */
export class ArtifactEnvelopeTextFilter {
  private buffer = '';
  private activeClose: string | null = null;
  private markdownCodeFenceOpen = false;

  push(chunk: string): string {
    if (!chunk) return '';
    this.buffer += chunk;
    return this.drain(false);
  }

  flush(): string {
    return this.drain(true);
  }

  private drain(final: boolean): string {
    let out = '';
    while (this.buffer.length > 0) {
      if (this.activeClose) {
        // Hidden artifact bodies are not emitted markdown, so their own code
        // fences must not change the visible stream's fence state.
        const closeIndex = this.buffer.toLowerCase().indexOf(this.activeClose);
        if (closeIndex === -1) {
          if (final) {
            this.buffer = '';
            this.activeClose = null;
            return out;
          }
          const keep = Math.max(0, this.activeClose.length - 1);
          this.buffer = this.buffer.slice(-keep);
          return out;
        }
        this.buffer = this.buffer.slice(closeIndex + this.activeClose.length);
        this.activeClose = null;
        continue;
      }

      const open = findNextEnvelopeOpen(
        this.buffer,
        this.markdownCodeFenceOpen,
      );
      if (!open) {
        const safeLength = final
          ? this.buffer.length
          : Math.max(0, this.buffer.length - OPEN_LOOKAHEAD);
        if (safeLength > 0) {
          const safeText = this.buffer.slice(0, safeLength);
          out += safeText;
          this.markdownCodeFenceOpen = updateMarkdownCodeFenceState(
            this.markdownCodeFenceOpen,
            safeText,
          );
          this.buffer = this.buffer.slice(safeLength);
        }
        return out;
      }

      if (open.index > 0) {
        const safeText = this.buffer.slice(0, open.index);
        out += safeText;
        this.markdownCodeFenceOpen = updateMarkdownCodeFenceState(
          this.markdownCodeFenceOpen,
          safeText,
        );
      }
      this.buffer = this.buffer.slice(open.endIndex);
      this.activeClose = open.close;
    }
    return out;
  }
}

function findNextEnvelopeOpen(
  buffer: string,
  markdownCodeFenceOpen: boolean,
): EnvelopeOpen | null {
  ENVELOPE_OPEN_RE.lastIndex = 0;
  for (const match of buffer.matchAll(ENVELOPE_OPEN_RE)) {
    if (match.index === undefined || !match[1]) continue;
    if (isInsideMarkdownCodeFence(buffer, match.index, markdownCodeFenceOpen)) {
      continue;
    }
    return {
      index: match.index,
      endIndex: match.index + match[0].length,
      close: `</${match[1].toLowerCase()}>`,
    };
  }
  return null;
}
