/**
 * Telegram Formatter
 *
 * Converts markdown to Telegram HTML format with chunking and fallback.
 * Patterns adopted from openclaw:
 *   - HTML parse_mode (more reliable than MarkdownV2)
 *   - Message chunking for 4096 char limit
 *   - Plain-text fallback when HTML parsing fails
 *   - Code-wrapping file refs to suppress spurious link previews
 */

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/** Regex to match a markdown table (header + separator + data rows). */
const MD_TABLE_RE = /^(\|.+\|)\n(\|[-:\s|]+\|)\n((?:\|.+\|\n?)+)/gm;

/**
 * Convert a markdown table to a readable format for Telegram.
 * For 2-column tables (key/value), renders as "key: value" lines.
 * For wider tables, renders as a <pre> block.
 */
/** Strip markdown bold markers from a cell value. */
function stripBold(cell: string): string {
  return cell.replace(/\*\*(.+?)\*\*/g, '$1');
}

/** Escape HTML entities in table cell content. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert a markdown table to a readable format for Telegram.
 * For 2-column tables (key/value), renders as "Key: Value" lines.
 * For wider tables, renders as a <pre> block.
 */
function convertMarkdownTable(tableMatch: string): string {
  const lines = tableMatch.trim().split('\n');
  if (lines.length < 3) return tableMatch;

  const parseRow = (row: string) =>
    row
      .split('|')
      .slice(1, -1) // remove leading/trailing empty splits
      .map((c) => c.trim());

  const headers = parseRow(lines[0]!);
  // Skip separator line (lines[1])
  const dataRows = lines.slice(2).map(parseRow);

  if (headers.length === 2) {
    // Key-value format: "Key: Value" per row with bold key
    return dataRows
      .map(
        (cols) =>
          `• <b>${escapeHtml(stripBold(cols[0] ?? ''))}</b>: ${escapeHtml(stripBold(cols[1] ?? ''))}`,
      )
      .join('\n');
  }

  // Multi-column: pre-formatted block
  const allRows = [headers, ...dataRows];
  const strippedRows = allRows.map((row) => row.map(stripBold));
  const colWidths = headers.map((_, ci) =>
    Math.max(...strippedRows.map((r) => (r[ci] ?? '').length)),
  );
  const formatRow = (row: string[]) =>
    row.map((cell, i) => escapeHtml(cell).padEnd(colWidths[i] ?? 0)).join('  ');

  return '<pre>' + strippedRows.map(formatRow).join('\n') + '</pre>';
}

/**
 * Convert generic markdown to Telegram HTML format.
 *
 * Processing order matters — code blocks and tables are extracted first
 * to prevent inner content from being processed by inline formatting rules.
 */
export function toTelegramHtml(text: string): string {
  // Extract code blocks before any escaping to preserve their content verbatim
  const codeBlocks: string[] = [];
  let processed = text.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, _lang, code) => {
      codeBlocks.push(code);
      return `\x00CODEBLOCK_${codeBlocks.length - 1}\x00`;
    },
  );

  // Convert markdown tables before HTML escaping (they contain | and - chars)
  const tableBlocks: string[] = [];
  processed = processed.replace(MD_TABLE_RE, (match) => {
    tableBlocks.push(convertMarkdownTable(match));
    return `\x00TABLE_${tableBlocks.length - 1}\x00`;
  });

  const withPlaceholders = processed;

  let result = withPlaceholders
    // Escape HTML entities
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Inline code (before other inline formatting)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headings → bold (Telegram has no heading support)
    .replace(/^#{1,6}\s+(.+)$/gm, '\n<b>$1</b>')
    // Bold (before italic to handle **bold** vs *italic*)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    // Italic
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    // Links
    .replace(/\[(.+?)\]\((.+?)\)/g, (_match, label, url) => {
      const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<a href="${safeUrl}">${label}</a>`;
    })
    // Horizontal rules → empty line
    .replace(/^---+$/gm, '')
    // Blockquotes (after HTML escaping turns > into &gt;)
    .replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>')
    // Merge adjacent blockquotes into one
    .replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // Restore code blocks with proper HTML escaping
  for (let i = 0; i < codeBlocks.length; i++) {
    const escaped = codeBlocks[i]!.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    result = result.replace(
      `\x00CODEBLOCK_${i}\x00`,
      `<pre><code>${escaped}</code></pre>`,
    );
  }

  // Restore table blocks (already contain HTML tags from convertMarkdownTable)
  for (let i = 0; i < tableBlocks.length; i++) {
    result = result.replace(`\x00TABLE_${i}\x00`, tableBlocks[i]!);
  }

  return result;
}

/**
 * Strip markdown for plain text fallback.
 * Used when Telegram rejects HTML (malformed tags, etc.).
 */
export function toPlainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) =>
      m.replace(/^```\w*\n?/, '').replace(/\n?```$/, ''),
    )
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/^>\s?/gm, '');
}

/**
 * Split a long message into chunks that fit Telegram's 4096-char limit.
 * Splits on paragraph boundaries (\n\n) first, then line boundaries (\n),
 * preserving HTML tag integrity.
 */
export function chunkTelegramMessage(
  html: string,
  limit: number = TELEGRAM_MAX_MESSAGE_LENGTH,
): string[] {
  if (html.length <= limit) return [html];

  const chunks: string[] = [];
  let remaining = html;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    // Find the best split point within the limit
    let splitAt = remaining.lastIndexOf('\n\n', limit);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('\n', limit);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(' ', limit);
    if (splitAt <= 0) splitAt = limit; // Hard cut as last resort

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter((c) => c.length > 0);
}
