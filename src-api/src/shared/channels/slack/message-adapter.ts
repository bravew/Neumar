import type { NormalizedMessage } from '../types';

/**
 * Parse a command from Slack message text.
 */
function parseCommand(
  text: string,
): { commandName: string; commandArgs: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  return { commandName: parts[0]!.toLowerCase(), commandArgs: parts.slice(1) };
}

/**
 * Remove the leading `<@UBOTID>` Slack user-mention tag produced by app_mention events.
 * e.g. "<@U1234567890AB> hello bot" → "hello bot"
 */
function stripMentionPrefix(text: string): string {
  return text.replace(/^<@[A-Z0-9]+>\s*/i, '').trim();
}

/**
 * Normalize a Slack message event to NormalizedMessage.
 * Pass `isMention = true` for app_mention events so the leading @bot tag is stripped.
 */
interface SlackMessageEvent {
  text?: string;
  user?: string;
  bot_id?: string;
  channel?: string;
  channel_type?: string;
  thread_ts?: string;
  team?: string;
  ts?: string;
  files?: unknown[];
  /** Slack legacy attachments — used for forwarded/shared messages */
  attachments?: unknown[];
}

/** Slack legacy attachment (subset of fields relevant for forwarded messages) */
interface SlackAttachment {
  from_url?: string;
  is_msg_unfurl?: boolean;
  author_name?: string;
  author_subname?: string;
  text?: string;
  fallback?: string;
  channel_name?: string;
  files?: Array<{
    id: string;
    name: string;
    mimetype: string;
    url_private_download?: string;
    size?: number;
  }>;
  image_url?: string;
  thumb_url?: string;
  title?: string;
  title_link?: string;
}

/** Slack-owned hostnames safe for server-side fetch (SSRF protection). */
const SLACK_HOSTS = [
  'files.slack.com',
  'slack-files.com',
  'slack-edge.com',
  'slack.com',
];

function isSlackHostedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const { hostname } = parsed;
    return SLACK_HOSTS.some(
      (h) => hostname === h || hostname.endsWith(`.${h}`),
    );
  } catch {
    return false;
  }
}

/**
 * Extract text and attachment URLs from Slack's legacy `attachments[]` field.
 * Forwarded messages arrive with empty text/files — the original content
 * lives in attachments with `is_msg_unfurl: true`.
 */
function extractForwardedContent(attachments: SlackAttachment[]): {
  text: string;
  urls: string[];
} {
  const textParts: string[] = [];
  const urls: string[] = [];

  for (const att of attachments) {
    if (att.is_msg_unfurl) {
      const author = att.author_name || att.author_subname || 'Someone';
      const channel = att.channel_name ? `#${att.channel_name}` : '';
      const header = channel
        ? `[Forwarded from ${author} in ${channel}]`
        : `[Forwarded from ${author}]`;
      textParts.push(header);
    }

    const content = att.text || '';
    if (content) {
      textParts.push(content);
    }

    // Link unfurl titles (not msg unfurls which already have text)
    if (att.title && !att.is_msg_unfurl) {
      const titleText = att.title_link
        ? `${att.title}: ${att.title_link}`
        : att.title;
      if (!textParts.includes(titleText)) {
        textParts.push(titleText);
      }
    }

    if (att.files?.length) {
      for (const file of att.files) {
        if (file.url_private_download) {
          urls.push(file.url_private_download);
        }
      }
    }

    // Only fetch image/thumb URLs from Slack-owned hosts — link unfurl
    // attachments can contain arbitrary external URLs (SSRF risk).
    if (att.image_url && isSlackHostedUrl(att.image_url)) {
      urls.push(att.image_url);
    } else if (att.thumb_url && isSlackHostedUrl(att.thumb_url)) {
      urls.push(att.thumb_url);
    }
  }

  return { text: textParts.join('\n'), urls };
}

export function toNormalizedMessage(
  event: SlackMessageEvent,
  isMention = false,
  configId = '',
): NormalizedMessage {
  let text: string = (event.text ?? '').trim();
  if (isMention) text = stripMentionPrefix(text);
  const userId: string = event.user ?? event.bot_id ?? 'unknown';
  const channel: string = event.channel ?? '';
  const threadTs: string | undefined = event.thread_ts;
  const teamId: string | undefined = event.team ?? undefined;

  // For threaded messages, use the existing thread_ts.
  // For top-level messages (mentions or DMs), use the message's own ts so
  // replies (including scheduled heartbeat results) go into a thread under
  // the user's message rather than posting as separate top-level messages.
  const effectiveThreadTs: string | undefined = threadTs ?? event.ts;

  // sessionKey uses the original thread_ts for session continuity —
  // top-level DM messages share the channel-level session.
  const sessionKey = threadTs ? `${channel}:${threadTs}` : channel;
  // conversationId uses effectiveThreadTs so replies are threaded under
  // the user's message (critical for schedule/heartbeat delivery).
  const conversationId = effectiveThreadTs
    ? `${channel}:${effectiveThreadTs}`
    : channel;

  // Extract file attachment URLs from direct file uploads
  const attachmentUrls: string[] = [];
  const files = event.files as
    | Array<{
        id: string;
        name: string;
        mimetype: string;
        url_private_download?: string;
        filetype?: string;
        size?: number;
        subtype?: string;
      }>
    | undefined;

  if (files?.length) {
    for (const file of files) {
      if (file.url_private_download) {
        attachmentUrls.push(file.url_private_download);
      }
    }
  }

  // Forwarded/shared messages: content lives in event.attachments[], not text/files.
  const slackAttachments = event.attachments as SlackAttachment[] | undefined;
  if (slackAttachments?.length) {
    const forwarded = extractForwardedContent(slackAttachments);
    if (forwarded.text) {
      text = text ? `${text}\n\n${forwarded.text}` : forwarded.text;
    }
    for (const url of forwarded.urls) {
      if (!attachmentUrls.includes(url)) {
        attachmentUrls.push(url);
      }
    }
  }

  const cmd = parseCommand(text);

  return {
    platform: 'slack',
    configId,
    messageId: event.ts ?? null,
    conversationId,
    sessionKey,
    userId,
    text,
    attachments: attachmentUrls.length > 0 ? attachmentUrls : undefined,
    isCommand: !!cmd,
    commandName: cmd?.commandName,
    commandArgs: cmd?.commandArgs,
    metadata: {
      channel,
      threadTs: threadTs ?? null,
      teamId: teamId ?? null,
      channelType: event.channel_type ?? null,
      files:
        files?.map((f) => ({
          id: f.id,
          name: f.name,
          mimetype: f.mimetype,
          size: f.size,
          subtype: f.subtype,
        })) ?? null,
    },
  };
}
