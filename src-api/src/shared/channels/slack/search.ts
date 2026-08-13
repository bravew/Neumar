/**
 * Slack Workspace Search
 *
 * Searches workspace users and public channel messages using Slack's
 * Real-time Search API (assistant.search.context).
 *
 * Requires bot token scopes: search:read.public, search:read.users.
 * Requires action_token from the inbound message event (DMs provide it
 * automatically; channel messages provide it when the bot is @mentioned).
 *
 * Falls back to users.list filtering when the search API is unavailable
 * (e.g. workspace doesn't have Slack AI Search enabled).
 */

import { createLogger } from '@/shared/utils/logger';

import { slackPost } from './slack-api';

const logger = createLogger('SlackSearch');

export interface SlackUserResult {
  userId: string;
  name: string;
  title: string;
  timezone: string;
  statusText: string;
}

export interface SlackMessageResult {
  author: string;
  authorId: string;
  channel: string;
  text: string;
  permalink: string;
  ts: string;
}

/**
 * Search workspace users by name, title, or keyword.
 * Tries assistant.search.context first, falls back to users.list filtering.
 */
export async function searchSlackUsers(
  botToken: string,
  actionToken: string | undefined,
  query: string,
  limit = 10,
): Promise<SlackUserResult[]> {
  // Try Real-time Search API first (semantic search, richer results)
  if (actionToken) {
    try {
      const result = await slackPost(botToken, 'assistant.search.context', {
        query,
        action_token: actionToken,
        content_types: 'users',
        limit,
      });

      const users = result.results?.users;
      if (result.ok && users && users.length > 0) {
        return users.map((u) => {
          const rec = u as Record<string, string | undefined>;
          return {
            userId: rec.user_id ?? rec.id ?? '',
            name: rec.full_name ?? rec.real_name ?? rec.name ?? '',
            title: rec.title ?? '',
            timezone: rec.timezone ?? rec.tz ?? '',
            statusText: rec.status_text ?? '',
          };
        });
      }
    } catch (err) {
      logger.debug('assistant.search.context users failed, trying fallback', {
        err,
      });
    }
  }

  // When query is a Slack user ID (e.g. U1234567890), use users.info directly
  // since the users.list substring fallback won't match on IDs.
  if (/^U[A-Z0-9]+$/i.test(query)) {
    return lookupUserById(botToken, query);
  }

  // Fallback: paginate users.list with client-side filtering
  return fallbackUserSearch(botToken, query, limit);
}

/**
 * Search public channel messages by keyword or question.
 * Requires action_token — no fallback available for message search with bot tokens.
 */
export async function searchSlackMessages(
  botToken: string,
  actionToken: string,
  query: string,
  limit = 5,
): Promise<SlackMessageResult[]> {
  const result = await slackPost(botToken, 'assistant.search.context', {
    query,
    action_token: actionToken,
    content_types: 'messages',
    limit,
  });

  if (!result.ok) {
    const error = result.error ?? 'unknown';
    logger.warn('assistant.search.context messages failed', { error });
    return [];
  }

  if (!result.results?.messages?.length) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return result.results.messages.map((m: any) => ({
    author: m.author_name ?? '',
    authorId: m.author_user_id ?? '',
    channel: m.channel_name ?? m.channel_id ?? '',
    text: (m.content ?? m.text ?? '').slice(0, 300),
    permalink: m.permalink ?? '',
    ts: m.message_ts ?? '',
  }));
}

async function lookupUserById(
  token: string,
  userId: string,
): Promise<SlackUserResult[]> {
  try {
    const result = await slackPost(token, 'users.info', { user: userId });
    if (!result.ok) return [];
    const m = result.user as Record<string, unknown> | undefined;
    if (!m || m.is_bot || m.deleted) return [];
    const profile = m.profile as Record<string, string | undefined> | undefined;
    return [
      {
        userId: String(m.id ?? ''),
        name:
          profile?.display_name || String(m.real_name ?? m.name ?? m.id ?? ''),
        title: profile?.title || '',
        timezone: String(m.tz ?? ''),
        statusText: profile?.status_text || '',
      },
    ];
  } catch {
    return [];
  }
}

async function fallbackUserSearch(
  token: string,
  query: string,
  limit: number,
): Promise<SlackUserResult[]> {
  const lowerQuery = query.toLowerCase();
  const matches: SlackUserResult[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 10 && matches.length < limit; page++) {
    const result = await slackPost(token, 'users.list', {
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });

    if (!result.ok) {
      logger.warn('users.list fallback failed', { error: result.error });
      break;
    }

    for (const member of result.members ?? []) {
      const m = member as Record<string, unknown>;
      if (m.is_bot || m.deleted) continue;
      const profile = m.profile as
        | Record<string, string | undefined>
        | undefined;
      const name = String(m.real_name ?? '').toLowerCase();
      const displayName = (profile?.display_name ?? '').toLowerCase();
      const title = (profile?.title ?? '').toLowerCase();

      if (
        name.includes(lowerQuery) ||
        displayName.includes(lowerQuery) ||
        title.includes(lowerQuery)
      ) {
        matches.push({
          userId: String(m.id ?? ''),
          name:
            profile?.display_name ||
            String(m.real_name ?? m.name ?? m.id ?? ''),
          title: profile?.title || '',
          timezone: String(m.tz ?? ''),
          statusText: profile?.status_text || '',
        });
        if (matches.length >= limit) break;
      }
    }

    cursor = result.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  return matches;
}

/**
 * Format user search results as a concise text block for the agent system prompt.
 */
export function formatUserResults(users: SlackUserResult[]): string {
  if (users.length === 0) return '';
  return users
    .map((u) => {
      const parts = [u.name];
      if (u.title) parts.push(u.title);
      if (u.timezone) parts.push(`tz: ${u.timezone}`);
      return parts.join(' — ');
    })
    .join('\n');
}
