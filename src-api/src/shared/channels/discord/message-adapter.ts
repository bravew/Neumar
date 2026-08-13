import type { NormalizedMessage } from '../types';

/**
 * Parse a command from message content.
 */
function parseCommand(
  content: string,
): { commandName: string; commandArgs: string[] } | null {
  if (!content.startsWith('/')) return null;
  const parts = content.slice(1).split(/\s+/);
  return { commandName: parts[0]!.toLowerCase(), commandArgs: parts.slice(1) };
}

/**
 * Normalize a discord.js Message to NormalizedMessage.
 */
export function toNormalizedMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any,
  botUserId: string,
  configId: string,
): NormalizedMessage {
  const content: string = (message.content ?? '').trim();
  // Strip bot mention from content (for guild @mention handling)
  const cleanContent = content
    .replace(new RegExp(`<@!?${botUserId}>`, 'g'), '')
    .trim();

  const conversationId = resolveConversationId(message);
  const sessionKey = conversationId;

  const cmd = parseCommand(cleanContent);

  // Extract attachment URLs (images, files, etc.)
  const rawAttachments = message.attachments;
  const attachmentUrls: string[] = [];
  if (rawAttachments && typeof rawAttachments.values === 'function') {
    for (const att of rawAttachments.values()) {
      if (att.url) attachmentUrls.push(att.url);
    }
  }

  return {
    platform: 'discord',
    configId,
    messageId: String(message.id),
    conversationId,
    sessionKey,
    userId: String(message.author.id),
    text: cleanContent,
    attachments: attachmentUrls.length > 0 ? attachmentUrls : undefined,
    isCommand: !!cmd,
    commandName: cmd?.commandName,
    commandArgs: cmd?.commandArgs,
    metadata: {
      guildId: message.guildId ?? null,
      channelId: message.channelId,
      parentId: message.channel?.parentId ?? null,
      isThread: message.channel?.isThread?.() ?? false,
      authorName: message.member?.displayName ?? message.author.username,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveConversationId(message: any): string {
  const channel = message.channel;
  if (message.guildId && channel?.isThread?.()) {
    const parentId = channel.parentId ?? message.channelId;
    return channel.parent?.type === 15
      ? `forum:${parentId}:${channel.id}`
      : String(channel.id);
  }
  return String(message.channelId);
}

/**
 * Convert markdown for Discord (tables → code blocks, etc.).
 */
export function formatForDiscord(text: string): string {
  // Convert markdown tables to Discord-readable format
  const MD_TABLE_RE = /^(\|.+\|)\n(\|[-:\s|]+\|)\n((?:\|.+\|\n?)+)/gm;
  return text.replace(MD_TABLE_RE, (match) => {
    const lines = match.trim().split('\n');
    if (lines.length < 3) return match;
    const parseRow = (row: string) =>
      row
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
    const headers = parseRow(lines[0]!);
    const dataRows = lines.slice(2).map(parseRow);
    if (headers.length === 2) {
      return dataRows
        .map((cols) => `**${cols[0] ?? ''}**: ${cols[1] ?? ''}`)
        .join('\n');
    }
    const allRows = [headers, ...dataRows];
    const colWidths = headers.map((_, ci) =>
      Math.max(...allRows.map((r) => (r[ci] ?? '').length)),
    );
    return (
      '```\n' +
      allRows
        .map((row) => row.map((c, i) => c.padEnd(colWidths[i] ?? 0)).join('  '))
        .join('\n') +
      '\n```'
    );
  });
}
