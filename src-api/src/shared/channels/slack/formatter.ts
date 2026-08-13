/**
 * Slack Formatter
 *
 * Converts Markdown to Slack mrkdwn format, handles message truncation,
 * and builds Block Kit notification blocks.
 *
 * Note: primary rendering now goes through `type: "markdown"` blocks
 * (see blocks.ts). `markdownToMrkdwn` is retained for the `text` fallback
 * field — notification previews, email digests, and legacy clients.
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SlackFormatter');

const DEFAULT_MAX_LEN = 39_900;
const TRUNCATE_SUFFIX = '... (truncated)';

const CODE_PLACEHOLDER_PREFIX = '\x00SLACKCODE';
const LINK_PLACEHOLDER_PREFIX = '\x00SLACKLINK';

function escapeSlackSpecialChars(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Converts standard Markdown to Slack mrkdwn format.
 * Processing order: protect code/links → escape → transforms → restore.
 */
export function markdownToMrkdwn(markdown: string): string {
  const codeBlocks: string[] = [];
  const links: Array<{ url: string; text: string }> = [];

  // 1. Protect fenced code blocks
  let out = markdown.replace(/```[\s\S]*?```/g, (match) => {
    const idx = codeBlocks.length;
    codeBlocks.push(match);
    return `${CODE_PLACEHOLDER_PREFIX}${idx}\x00`;
  });

  // 2. Protect inline code
  out = out.replace(/`[^`]*`/g, (match) => {
    const idx = codeBlocks.length;
    codeBlocks.push(match);
    return `${CODE_PLACEHOLDER_PREFIX}${idx}\x00`;
  });

  // 3. Strip markdown image syntax — images sent via sendFiles/sendPhotoUrls
  // Must run before link protection (step 4) which would match [alt](url) inside ![alt](url)
  out = out.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');

  // 4. Protect links [text](url)
  out = out.replace(
    /\[([^\]]*)\]\(([^)]*)\)/g,
    (_, text: string, url: string) => {
      const idx = links.length;
      links.push({ url, text });
      return `${LINK_PLACEHOLDER_PREFIX}${idx}\x00`;
    },
  );

  // 5. Escape <, >, &
  out = escapeSlackSpecialChars(out);

  // 6. **bold** → *bold*
  out = out.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  // 7. *italic* → _italic_
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '_$1_');
  // 8. ~~strikethrough~~ → ~strikethrough~
  out = out.replace(/~~([^~]+)~~/g, '~$1~');
  // 9. # Heading → *Heading*
  out = out.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
  // 10. Unordered list bullets: - or * or + → •
  out = out.replace(/^(\s*)[-*+]\s/gm, '$1\u2022 ');
  // 11. Horizontal rules
  out = out.replace(
    /^-{3,}$/gm,
    '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
  );
  // Note: markdown pipe tables are left as-is. The primary render path uses
  // `type: "markdown"` blocks (see blocks.ts) which render pipe tables
  // natively; this mrkdwn output is only used for the notification `text`
  // fallback, where pipe-formatted plain text remains readable as a preview.

  // 12. Restore links: <url|text>
  out = out.replace(
    new RegExp(`${LINK_PLACEHOLDER_PREFIX}(\\d+)\\x00`, 'g'),
    (_, idxStr) => {
      const { url, text } = links[parseInt(idxStr, 10)] ?? {
        url: '',
        text: '',
      };
      return `<${escapeSlackSpecialChars(url)}|${escapeSlackSpecialChars(text)}>`;
    },
  );

  // 13. Restore code blocks
  out = out.replace(
    new RegExp(`${CODE_PLACEHOLDER_PREFIX}(\\d+)\\x00`, 'g'),
    (_, idxStr) => codeBlocks[parseInt(idxStr, 10)] ?? '',
  );

  return out;
}

/**
 * Truncates text for Slack (40,000 char limit). Default maxLen = 39,900.
 */
export function truncateForSlack(
  text: string,
  maxLen: number = DEFAULT_MAX_LEN,
): string {
  if (text.length <= maxLen) return text;
  logger.debug('Truncating text for Slack', {
    originalLen: text.length,
    maxLen,
  });
  const keep = maxLen - TRUNCATE_SUFFIX.length;
  return text.slice(0, keep) + TRUNCATE_SUFFIX;
}

/** Per-block char limit for `type: "markdown"` payloads. */
export const MARKDOWN_BLOCK_LIMIT = 12_000;
const MARKDOWN_TRUNCATION_SUFFIX = '\n\n_(truncated)_';

/**
 * Truncate text for a Slack `type: "markdown"` block, preserving UTF-16
 * surrogate pairs (emoji, CJK supplementary) and appending a visible suffix.
 */
export function truncateForMarkdownBlock(
  text: string,
  limit: number = MARKDOWN_BLOCK_LIMIT,
): string {
  if (text.length <= limit) return text;
  const keep = limit - MARKDOWN_TRUNCATION_SUFFIX.length;
  let end = keep;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return text.slice(0, end) + MARKDOWN_TRUNCATION_SUFFIX;
}

// ============================================================================
// Notification Blocks (moved from slack-format.ts)
// ============================================================================

export interface NotificationMessage {
  title: string;
  issueId: string;
  issueTitle: string;
  prUrl: string;
  summary: string;
  branch: string;
}

/**
 * Builds Block Kit blocks for Slack notifications (header, section, actions).
 */
export function buildNotificationBlocks(
  message: NotificationMessage,
): Array<Record<string, unknown>> {
  const truncatedSummary = truncateForSlack(message.summary, 2500);

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: message.title },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Issue:*\n<${message.prUrl}|${message.issueId}> \u2014 ${message.issueTitle}`,
        },
        {
          type: 'mrkdwn',
          text: `*Branch:*\n\`${message.branch}\``,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Summary:*\n\`\`\`${truncatedSummary}\`\`\``,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Review PR' },
          url: message.prUrl,
          style: 'primary',
        },
      ],
    },
  ];
}
