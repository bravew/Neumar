/**
 * Slack Integration Client
 *
 * Provides Slack Web API operations using the bot token obtained
 * through OAuth2 v2. Uses direct fetch calls instead of the @slack/web-api
 * package to keep the dependency footprint small.
 */

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SlackIntegration');

const SLACK_API_BASE = 'https://slack.com/api';

// ============================================================================
// Types
// ============================================================================

export interface SlackChannel {
  id: string;
  name: string;
  is_channel: boolean;
  is_private: boolean;
  is_member: boolean;
  topic?: { value: string };
  purpose?: { value: string };
  num_members?: number;
}

export interface SlackMessage {
  type: string;
  user?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  profile: {
    email?: string;
    image_72?: string;
    display_name?: string;
  };
  is_bot: boolean;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

// ============================================================================
// Helpers
// ============================================================================

async function slackFetch<T extends SlackApiResponse>(
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const client = await getConnectionBroker().getServiceClient('slack');

  const options: RequestInit = {
    method: 'POST',
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await client(`${SLACK_API_BASE}/${method}`, options);
  const data = (await res.json()) as T;

  if (!data.ok) {
    const error = data.error ?? 'Unknown Slack API error';
    logger.error(`Slack API error (${method}): ${error}`);
    throw new Error(`Slack API error: ${error}`);
  }

  return data;
}

// ============================================================================
// Public API
// ============================================================================

/** List channels the bot has access to */
export async function listChannels(limit = 100): Promise<SlackChannel[]> {
  const data = await slackFetch<
    SlackApiResponse & { channels: SlackChannel[] }
  >('conversations.list', {
    types: 'public_channel,private_channel',
    exclude_archived: true,
    limit,
  });
  return data.channels ?? [];
}

/** Get channel history (recent messages) */
export async function getChannelHistory(
  channelId: string,
  limit = 20,
): Promise<SlackMessage[]> {
  const data = await slackFetch<
    SlackApiResponse & { messages: SlackMessage[] }
  >('conversations.history', { channel: channelId, limit });
  return data.messages ?? [];
}

/** Send a message to a channel */
export async function sendMessage(
  channelId: string,
  text: string,
  threadTs?: string,
): Promise<{ ts: string; channel: string }> {
  const body: Record<string, unknown> = { channel: channelId, text };
  if (threadTs) body.thread_ts = threadTs;

  const data = await slackFetch<
    SlackApiResponse & { ts: string; channel: string }
  >('chat.postMessage', body);

  logger.info(`Message sent to ${channelId}`);
  return { ts: data.ts, channel: data.channel };
}

/** List users in the workspace */
export async function listUsers(limit = 100): Promise<SlackUser[]> {
  const data = await slackFetch<SlackApiResponse & { members: SlackUser[] }>(
    'users.list',
    { limit },
  );
  return (data.members ?? []).filter((u) => !u.is_bot);
}

/** Search messages in the workspace (requires search:read scope) */
export async function searchMessages(
  query: string,
  count = 10,
): Promise<SlackMessage[]> {
  const data = await slackFetch<
    SlackApiResponse & { messages: { matches: SlackMessage[] } }
  >('search.messages', { query, count });
  return data.messages?.matches ?? [];
}

/** Get the authenticated workspace info */
export async function getWorkspaceInfo(): Promise<{
  team: string;
  teamId: string;
  userId: string;
}> {
  const data = await slackFetch<
    SlackApiResponse & { team: string; team_id: string; user_id: string }
  >('auth.test', {});
  return {
    team: data.team,
    teamId: data.team_id,
    userId: data.user_id,
  };
}
