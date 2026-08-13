/**
 * Slack thread history — authoritative source for in-thread context.
 *
 * `conversations.replies` returns the parent message + all replies for a
 * thread, so the agent can see what was posted before it was @-mentioned
 * (not just what the bot has already processed). This is the only correct
 * way to give an @mention bot context on the post it's replying to.
 *
 * Slack docs: https://docs.slack.dev/reference/methods/conversations.replies/
 * Required scopes: channels:history, groups:history, im:history, mpim:history.
 * Rate limit: Tier 3 (~50/min) for Marketplace apps; much stricter for
 * newly-distributed non-Marketplace apps — cache aggressively.
 *
 * Module-level caches so both code paths (SlackCoworkHandler via the
 * slack-gateway flow, and ChannelManager via the Bolt plugin flow) share
 * entries and avoid duplicate API calls.
 */

import type { WebClient } from '@slack/web-api';

import type { ConversationMessage } from '@/core/agent';

import { getSlackConfig } from '@/shared/services/slack-config';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SlackThreadHistory');

const MAX_THREAD_HISTORY = 50;
const THREAD_CACHE_TTL_MS = 30_000;
const USER_CACHE_TTL_MS = 3_600_000;
const THREAD_CACHE_MAX_ENTRIES = 200;
const USER_CACHE_MAX_ENTRIES = 1000;

interface CachedThread {
  messages: Array<ConversationMessage & { ts: string }>;
  fetchedAt: number;
}

const threadCache = new Map<string, CachedThread>();
const userNameCache = new Map<string, { name: string; fetchedAt: number }>();

/**
 * Parse a `channel:thread_ts` conversationId into its parts. Top-level
 * (non-threaded) messages use just `channel` with no separator.
 */
export function parseSlackConversationId(conversationId: string): {
  channel: string;
  threadTs: string | undefined;
} {
  const sepIdx = conversationId.indexOf(':');
  if (sepIdx < 0) return { channel: conversationId, threadTs: undefined };
  return {
    channel: conversationId.slice(0, sepIdx),
    threadTs: conversationId.slice(sepIdx + 1) || undefined,
  };
}

export async function resolveSlackUserName(
  client: WebClient,
  userId: string,
  teamId?: string,
): Promise<string> {
  const cacheKey = teamId ? `${teamId}:${userId}` : userId;
  const cached = userNameCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < USER_CACHE_TTL_MS) {
    return cached.name;
  }
  try {
    const result = await client.users.info({ user: userId });
    const profile = result.user as
      | { real_name?: string; profile?: { display_name?: string } }
      | undefined;
    const name = profile?.profile?.display_name || profile?.real_name || userId;
    userNameCache.set(cacheKey, { name, fetchedAt: Date.now() });
    return name;
  } catch {
    return userId;
  }
}

/**
 * Fetch parent + replies for a Slack thread and map to ConversationMessage[].
 * - Bot messages → role: 'assistant', content: raw text.
 * - Human messages → role: 'user', content: '[displayName]: text'.
 * - Skips `currentMessageTs` so the agent doesn't see its own incoming prompt twice.
 * - Returns [] on API error (agent still runs, just without thread context).
 */
export async function fetchSlackThreadHistory(
  client: WebClient,
  channelId: string,
  threadTs: string,
  currentMessageTs: string | null,
  teamId?: string,
): Promise<ConversationMessage[]> {
  const cacheKey = `${channelId}:${threadTs}`;
  const cached = threadCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < THREAD_CACHE_TTL_MS) {
    return stripTs(cached.messages, currentMessageTs);
  }

  try {
    const result = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: MAX_THREAD_HISTORY,
    });

    if (!result.ok || !result.messages) return [];

    const botUserId = getSlackConfig().botUserId;
    const messages: Array<ConversationMessage & { ts: string }> = [];

    const humanUserIds = new Set<string>();
    for (const m of result.messages) {
      if (m.user && !m.bot_id && m.user !== botUserId) humanUserIds.add(m.user);
    }
    const names = new Map<string, string>();
    await Promise.all(
      [...humanUserIds].map(async (uid) => {
        names.set(uid, await resolveSlackUserName(client, uid, teamId));
      }),
    );

    for (const m of result.messages) {
      const rawText = m.text ?? '';
      const ts = m.ts ?? '';
      if (!ts) continue;

      // Image/file-only messages have empty text but carry attachments. Emit
      // a placeholder so the agent retains the fact that media was shared on
      // earlier turns — otherwise follow-ups like "what's in this picture"
      // see no record of the upload at all.
      const files = (
        m as { files?: Array<{ name?: string; mimetype?: string }> }
      ).files;
      let text = rawText;
      if (!text && files?.length) {
        const summary = files
          .map((f) => f.name ?? f.mimetype ?? 'file')
          .slice(0, 3)
          .join(', ');
        text = `[shared image/file: ${summary}]`;
      }
      if (!text) continue;

      const isBot = Boolean(m.bot_id || (botUserId && m.user === botUserId));
      if (isBot) {
        messages.push({ role: 'assistant', content: text, ts });
      } else if (m.user) {
        const userName = names.get(m.user) ?? m.user;
        messages.push({
          role: 'user',
          content: `[${userName}]: ${text}`,
          ts,
        });
      } else {
        messages.push({ role: 'user', content: text, ts });
      }
    }

    threadCache.set(cacheKey, { messages, fetchedAt: Date.now() });
    pruneStaleEntries();
    return stripTs(messages, currentMessageTs);
  } catch (err) {
    logger.warn(
      'Failed to fetch Slack thread history, proceeding without context',
      { channelId, threadTs, err },
    );
    return [];
  }
}

/** Drop the current-message entry (if present) and strip the ts helper field. */
function stripTs(
  messages: Array<ConversationMessage & { ts: string }>,
  currentMessageTs: string | null,
): ConversationMessage[] {
  return messages
    .filter((m) => m.ts !== currentMessageTs)
    .map(({ ts: _ts, ...rest }) => rest);
}

/** Opportunistic eviction to keep module caches bounded. */
function pruneStaleEntries(): void {
  const now = Date.now();
  if (threadCache.size > THREAD_CACHE_MAX_ENTRIES) {
    const cutoff = now - THREAD_CACHE_TTL_MS;
    for (const [key, entry] of threadCache) {
      if (entry.fetchedAt < cutoff) threadCache.delete(key);
    }
  }
  if (userNameCache.size > USER_CACHE_MAX_ENTRIES) {
    const cutoff = now - USER_CACHE_TTL_MS;
    for (const [key, entry] of userNameCache) {
      if (entry.fetchedAt < cutoff) userNameCache.delete(key);
    }
  }
}
