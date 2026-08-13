/**
 * Slack Messaging
 *
 * Functions for sending messages to users (DMs) and channels via the
 * Slack Web API. Used by agent MCP tools to enable outbound messaging.
 *
 * Requires bot token scopes: chat:write, chat:write.public, im:write.
 */

import { createLogger } from '@/shared/utils/logger';

import { slackPost } from './slack-api';

const logger = createLogger('SlackMessaging');

/** DM channel IDs are stable per (bot, user) pair — cache to skip conversations.open on repeat sends. Keyed by `${botToken}:${userId}` to avoid stale hits across token changes. */
const dmChannelCache = new Map<string, string>();

/**
 * Send a direct message to a Slack user.
 *
 * Caches the DM channel ID per userId to avoid redundant conversations.open calls.
 */
export async function sendSlackDirectMessage(
  botToken: string,
  userId: string,
  text: string,
): Promise<{ ok: boolean; channelId?: string; ts?: string; error?: string }> {
  const cacheKey = `${botToken}:${userId}`;
  let channelId = dmChannelCache.get(cacheKey);

  if (!channelId) {
    const convResult = await slackPost(botToken, 'conversations.open', {
      users: userId,
    });
    if (!convResult.ok || !convResult.channel?.id) {
      return {
        ok: false,
        error: convResult.error ?? 'Failed to open DM channel',
      };
    }
    channelId = convResult.channel.id;
    dmChannelCache.set(cacheKey, channelId);
  }

  const msgResult = await slackPost(botToken, 'chat.postMessage', {
    channel: channelId,
    text,
  });
  if (!msgResult.ok) {
    // Clear cache in case the channel ID became invalid
    dmChannelCache.delete(cacheKey);
    return { ok: false, error: msgResult.error ?? 'Failed to send message' };
  }

  return { ok: true, channelId, ts: msgResult.ts };
}

/**
 * Send a message to a Slack channel (public or private).
 *
 * Public channels work without membership (chat:write.public scope).
 * Private channels require the bot to be a member.
 */
export async function sendSlackChannelMessage(
  botToken: string,
  channelId: string,
  text: string,
  threadTs?: string,
  options?: { replyBroadcast?: boolean },
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const result = await slackPost(botToken, 'chat.postMessage', {
    channel: channelId,
    text,
    ...(threadTs ? { thread_ts: threadTs } : {}),
    ...(threadTs && options?.replyBroadcast ? { reply_broadcast: true } : {}),
  });
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'Failed to send message' };
  }
  return { ok: true, ts: result.ts };
}

export interface SlackChannelResult {
  channelId: string;
  name: string;
  isPrivate: boolean;
  memberCount: number;
  purpose: string;
}

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  num_members: number;
  purpose?: { value?: string };
}

/**
 * Search channels by name. Uses conversations.list with pagination and
 * client-side name filtering. Fetches up to 2 pages (400 channels).
 */
export async function searchSlackChannels(
  botToken: string,
  query: string,
  limit = 10,
  includePrivate = false,
): Promise<SlackChannelResult[]> {
  const lowerQuery = query.toLowerCase().replace(/^#/, '');
  const matches: SlackChannelResult[] = [];
  let cursor: string | undefined;
  const types = includePrivate
    ? 'public_channel,private_channel'
    : 'public_channel';

  for (let page = 0; page < 2 && matches.length < limit; page++) {
    const result = await slackPost(botToken, 'conversations.list', {
      types,
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });

    if (!result.ok) {
      logger.warn('conversations.list failed', { error: result.error });
      break;
    }

    const channels = result.channels as SlackChannel[] | undefined;

    for (const ch of channels ?? []) {
      if (ch.name.toLowerCase().includes(lowerQuery)) {
        matches.push({
          channelId: ch.id,
          name: ch.name,
          isPrivate: ch.is_private,
          memberCount: ch.num_members,
          purpose: ch.purpose?.value ?? '',
        });
        if (matches.length >= limit) break;
      }
    }

    cursor = result.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  return matches;
}
