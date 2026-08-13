/**
 * Discord Formatter
 *
 * Chunks messages for Discord's 2000-char limit with code fence preservation.
 * Discord uses standard markdown natively — no HTML conversion needed.
 *
 * Patterns adopted from openclaw:
 *   - 2000 char hard limit, 17 lines soft limit
 *   - Balanced code fence splitting across chunks
 *   - Paragraph → line → space → hard-cut split priority
 */

const DISCORD_MAX_MESSAGE_LENGTH = 2000;
const DISCORD_MAX_LINES_PER_CHUNK = 17;

/** Regex for fenced code block openers. */
const CODE_FENCE_OPEN_RE = /^(```\w*)$/;
const CODE_FENCE_CLOSE_RE = /^```$/;

/**
 * Convert markdown tables to a code-block format for Discord.
 * Discord doesn't render markdown tables natively, so we wrap them in code blocks.
 */
function convertMarkdownTable(tableMatch: string): string {
  const lines = tableMatch.trim().split('\n');
  if (lines.length < 3) return tableMatch;

  const parseRow = (row: string) =>
    row
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());

  const headers = parseRow(lines[0]!);
  const dataRows = lines.slice(2).map(parseRow);

  if (headers.length === 2) {
    return dataRows
      .map(
        (cols) =>
          `**${(cols[0] ?? '').replace(/\*\*/g, '')}**: ${(cols[1] ?? '').replace(/\*\*/g, '')}`,
      )
      .join('\n');
  }

  // Multi-column: pre-formatted code block
  const allRows = [headers, ...dataRows];
  const stripped = allRows.map((row) =>
    row.map((cell) => cell.replace(/\*\*(.+?)\*\*/g, '$1')),
  );
  const colWidths = headers.map((_, ci) =>
    Math.max(...stripped.map((r) => (r[ci] ?? '').length)),
  );
  const formatRow = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(colWidths[i] ?? 0)).join('  ');

  return '```\n' + stripped.map(formatRow).join('\n') + '\n```';
}

const MD_TABLE_RE = /^(\|.+\|)\n(\|[-:\s|]+\|)\n((?:\|.+\|\n?)+)/gm;

/**
 * Prepare markdown text for Discord.
 * Converts tables to readable format (Discord doesn't render tables).
 */
export function toDiscordMarkdown(text: string): string {
  return text.replace(MD_TABLE_RE, (match) => convertMarkdownTable(match));
}

/**
 * Chunk a message for Discord's 2000-char limit, preserving code fences.
 *
 * Strategy:
 * 1. Split into lines
 * 2. Track open code fences
 * 3. When a chunk reaches the char/line limit, close any open fence
 *    and re-open it in the next chunk
 * 4. Split priority: paragraph (\n\n) → line (\n) → hard cut
 */
export function chunkDiscordMessage(
  text: string,
  maxChars: number = DISCORD_MAX_MESSAGE_LENGTH,
  maxLines: number = DISCORD_MAX_LINES_PER_CHUNK,
): string[] {
  if (text.length <= maxChars) return [text];

  const lines = text.split('\n');
  const chunks: string[] = [];
  let currentLines: string[] = [];
  let currentLength = 0;
  let lineCount = 0;
  let openFence: string | null = null; // tracks the opening fence marker

  const flushChunk = () => {
    if (currentLines.length === 0) return;

    let chunk = currentLines.join('\n');

    // If we're inside a code fence, close it at the end of this chunk
    if (openFence) {
      chunk += '\n```';
    }

    chunks.push(chunk.trimEnd());

    // Start next chunk: re-open the code fence if it was split
    currentLines = [];
    currentLength = 0;
    lineCount = 0;

    if (openFence) {
      currentLines.push(openFence);
      currentLength = openFence.length + 1;
      lineCount = 1;
    }
  };

  for (const line of lines) {
    // Reserve space for potential fence closing (4 chars: \n```)
    const reservedSpace = openFence ? 4 : 0;
    const wouldBeLength =
      currentLength + line.length + (currentLines.length > 0 ? 1 : 0);

    // Check if adding this line would exceed limits
    if (
      currentLines.length > 0 &&
      (wouldBeLength + reservedSpace > maxChars || lineCount >= maxLines)
    ) {
      flushChunk();
    }

    // Track code fence state
    if (CODE_FENCE_OPEN_RE.test(line) && !openFence) {
      openFence = line;
    } else if (CODE_FENCE_CLOSE_RE.test(line) && openFence) {
      openFence = null;
    }

    currentLength += line.length + (currentLines.length > 0 ? 1 : 0);
    currentLines.push(line);
    lineCount++;
  }

  // Flush remaining
  if (currentLines.length > 0) {
    // No need to close fence here — if the original text had a closing fence,
    // openFence would already be null
    const chunk = currentLines.join('\n');
    chunks.push(chunk.trimEnd());
  }

  return chunks.filter((c) => c.length > 0);
}
