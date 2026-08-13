/**
 * Telegram Formatter
 *
 * Converts markdown to Telegram HTML format with chunking and fallback.
 * HTML parse_mode is more reliable than MarkdownV2 for complex content.
 */

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

const MD_TABLE_RE = /^(\|.+\|)\n(\|[-:\s|]+\|)\n((?:\|.+\|\n?)+)/gm;

function stripBold(cell: string): string {
  return cell.replace(/\*\*(.+?)\*\*/g, '$1');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
          `• <b>${escapeHtml(stripBold(cols[0] ?? ''))}</b>: ${escapeHtml(stripBold(cols[1] ?? ''))}`,
      )
      .join('\n');
  }

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
 */
export function toTelegramHtml(text: string): string {
  const codeBlocks: string[] = [];
  let processed = text.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, _lang, code) => {
      codeBlocks.push(code as string);
      return `\x00CODEBLOCK_${codeBlocks.length - 1}\x00`;
    },
  );

  const tableBlocks: string[] = [];
  processed = processed.replace(MD_TABLE_RE, (match) => {
    tableBlocks.push(convertMarkdownTable(match));
    return `\x00TABLE_${tableBlocks.length - 1}\x00`;
  });

  let result = processed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Strip markdown image syntax — images are sent as separate attachments via sendPhoto/sendFiles.
    // Must run before the link conversion to avoid leaving a stray `!` prefix.
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^#{1,6}\s+(.+)$/gm, '\n<b>$1</b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\[(.+?)\]\((.+?)\)/g, (_match, label, url) => {
      const safeUrl = (url as string)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;');
      return `<a href="${safeUrl}">${label as string}</a>`;
    })
    .replace(/^---+$/gm, '')
    .replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/<\/blockquote>\n<blockquote>/g, '\n');

  for (let i = 0; i < codeBlocks.length; i++) {
    const escaped = codeBlocks[i]!.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    result = result.replace(
      `\x00CODEBLOCK_${i}\x00`,
      `<pre><code>${escaped}</code></pre>`,
    );
  }

  for (let i = 0; i < tableBlocks.length; i++) {
    result = result.replace(`\x00TABLE_${i}\x00`, tableBlocks[i]!);
  }

  return result;
}

/**
 * Strip markdown for plain text fallback.
 */
export function toPlainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) =>
      m.replace(/^```\w*\n?/, '').replace(/\n?```$/, ''),
    )
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
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
 * Split a long HTML message into chunks that fit Telegram's 4096-char limit.
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

    let splitAt = remaining.lastIndexOf('\n\n', limit);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('\n', limit);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(' ', limit);
    if (splitAt <= 0) splitAt = limit;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter((c) => c.length > 0);
}
