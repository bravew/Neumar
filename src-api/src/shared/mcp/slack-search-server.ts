/**
 * Slack workspace search agent tools (slack_search_users, slack_search_messages).
 * Registered for channel-originated sessions using the bot token.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  sendSlackDirectMessage,
  sendSlackChannelMessage,
  searchSlackChannels,
} from '@/shared/channels/slack/messaging';
import {
  searchSlackUsers,
  searchSlackMessages,
  formatUserResults,
} from '@/shared/channels/slack/search';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SlackSearchTools');

export const SLACK_SEARCH_TOOL_NAMES = [
  'slack_search_users',
  'slack_search_messages',
  'slack_search_channels',
  'slack_send_message',
  'slack_send_channel_message',
];

interface SlackSearchServerOptions {
  botToken: string;
  actionToken?: string;
}

export function slackSearchTools(options: SlackSearchServerOptions) {
  const { botToken, actionToken } = options;

  return [
    tool(
      'slack_search_users',
      'Search workspace members by name, title, or keyword. ' +
        'Returns matching user profiles with name, title, and timezone. ' +
        'Use when asked about a person, team member, or colleague in the Slack workspace.',
      {
        query: z
          .string()
          .describe(
            'Name, job title, or keyword to search for (e.g. "Eddie", "engineer", "marketing")',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .describe('Maximum number of results (default: 10)'),
      },
      async ({ query, limit }: { query: string; limit: number }) => {
        try {
          const users = await searchSlackUsers(
            botToken,
            actionToken,
            query,
            limit,
          );
          if (users.length === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `No workspace members found matching "${query}".`,
                },
              ],
            };
          }
          return {
            content: [
              { type: 'text' as const, text: formatUserResults(users) },
            ],
          };
        } catch (err) {
          logger.warn('slack_search_users tool failed', { err });
          return {
            content: [
              {
                type: 'text' as const,
                text: `Search failed: ${err instanceof Error ? err.message : 'unknown error'}`,
              },
            ],
            isError: true,
          };
        }
      },
      {
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
    ),

    tool(
      'slack_search_messages',
      'Search public channel messages in the Slack workspace. ' +
        'Returns matching messages with author, channel, text, and link. ' +
        'Use when asked to find discussions, decisions, or information shared in Slack channels.',
      {
        query: z
          .string()
          .describe(
            'Search query — keywords or a natural language question (e.g. "deployment plan", "Q4 budget review")',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe('Maximum number of results (default: 5)'),
      },
      async ({ query, limit }: { query: string; limit: number }) => {
        if (!actionToken) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Message search requires an action_token from the Slack event. This is available in DMs and @mentions.',
              },
            ],
            isError: true,
          };
        }
        try {
          const messages = await searchSlackMessages(
            botToken,
            actionToken,
            query,
            limit,
          );
          if (messages.length === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `No messages found matching "${query}".`,
                },
              ],
            };
          }
          const formatted = messages
            .map((m) => {
              const parts = [`[${m.author}] in #${m.channel}: ${m.text}`];
              if (m.permalink) parts.push(m.permalink);
              return parts.join('\n');
            })
            .join('\n\n');
          return {
            content: [{ type: 'text' as const, text: formatted }],
          };
        } catch (err) {
          logger.warn('slack_search_messages tool failed', { err });
          return {
            content: [
              {
                type: 'text' as const,
                text: `Search failed: ${err instanceof Error ? err.message : 'unknown error'}`,
              },
            ],
            isError: true,
          };
        }
      },
      {
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
    ),

    tool(
      'slack_send_message',
      'Send a direct message to a Slack workspace member. ' +
        'Requires the target user\'s Slack user ID (starts with "U"). ' +
        'Use slack_search_users first to find the user ID by name, then call this tool. ' +
        'The message will appear as coming from the bot.',
      {
        userId: z
          .string()
          .regex(
            /^U[A-Z0-9]+$/i,
            'Must be a valid Slack user ID (e.g. U1234567890)',
          )
          .describe('Slack user ID of the recipient (e.g. "U1234567890")'),
        text: z
          .string()
          .min(1)
          .max(4000)
          .describe('Message text to send (supports Slack mrkdwn formatting)'),
      },
      async ({ userId, text }: { userId: string; text: string }) => {
        try {
          const result = await sendSlackDirectMessage(botToken, userId, text);
          if (!result.ok) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Failed to send message: ${result.error}`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: `Message sent successfully to <@${userId}>.`,
              },
            ],
          };
        } catch (err) {
          logger.warn('slack_send_message tool failed', { err });
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to send message: ${err instanceof Error ? err.message : 'unknown error'}`,
              },
            ],
            isError: true,
          };
        }
      },
      {
        annotations: {
          destructiveHint: false,
          openWorldHint: true,
        },
      },
    ),

    tool(
      'slack_search_channels',
      'Search public Slack channels by name. Returns matching channels with ID, name, ' +
        'member count, and purpose. Use this to find a channel ID before sending ' +
        'a message with slack_send_channel_message. Only searches public channels to avoid ' +
        'leaking private channel names to users who may not be members. For private channels, ' +
        'ask the user to provide the channel ID directly (found in Slack channel details). ' +
        'Searches up to 400 channels; for very large workspaces, ask the user for the channel ID directly.',
      {
        query: z
          .string()
          .describe(
            'Channel name or keyword to search for (e.g. "developers", "general"). The leading # is optional.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .describe('Maximum number of results (default: 10)'),
      },
      async ({ query, limit }: { query: string; limit: number }) => {
        try {
          const channels = await searchSlackChannels(botToken, query, limit);
          if (channels.length === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `No channels found matching "${query}". The bot can only discover channels it has joined. Ask the user for the channel ID if needed.`,
                },
              ],
            };
          }
          const formatted = channels
            .map((ch) => {
              const parts = [`#${ch.name} (${ch.channelId})`];
              if (ch.isPrivate) parts.push('[private]');
              parts.push(`${ch.memberCount} members`);
              if (ch.purpose) parts.push(ch.purpose);
              return parts.join(' — ');
            })
            .join('\n');
          return {
            content: [{ type: 'text' as const, text: formatted }],
          };
        } catch (err) {
          logger.warn('slack_search_channels tool failed', { err });
          return {
            content: [
              {
                type: 'text' as const,
                text: `Search failed: ${err instanceof Error ? err.message : 'unknown error'}`,
              },
            ],
            isError: true,
          };
        }
      },
      {
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
    ),

    tool(
      'slack_send_channel_message',
      'Send a message to a Slack channel. Requires the channel ID (starts with "C"). ' +
        'Use slack_search_channels first to find the channel ID by name, then call this tool. ' +
        'Works on any public channel. For private channels, the bot must be a member.\n\n' +
        'Posting modes:\n' +
        '- Omit threadTs → posts as a new top-level message in the channel (for announcements, updates, scheduled reports)\n' +
        '- Set threadTs → replies inside an existing thread (for follow-ups, conversational replies)\n' +
        '- Set threadTs + replyBroadcast → replies in thread AND shows in channel (for important thread updates everyone should see)\n\n' +
        'Channel notifications: Include <!here> in text to notify online members, or <!channel> to notify all members. ' +
        'Use sparingly and only when the user explicitly requests a broadcast notification.',
      {
        channelId: z
          .string()
          .regex(
            /^C[A-Z0-9]+$/i,
            'Must be a valid Slack channel ID (e.g. C1234567890)',
          )
          .describe('Slack channel ID (e.g. "C1234567890")'),
        text: z
          .string()
          .min(1)
          .max(4000)
          .describe(
            'Message text (Slack mrkdwn). Use <!here> to notify online members or <!channel> for all members — only when user explicitly asks.',
          ),
        threadTs: z
          .string()
          .regex(
            /^\d+\.\d+$/,
            'Must be a Slack thread timestamp (e.g. 1234567890.123456)',
          )
          .optional()
          .describe(
            'Thread timestamp to reply in a thread (e.g. "1234567890.123456"). Omit to post as a new top-level message in the channel.',
          ),
        replyBroadcast: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'When replying in a thread (threadTs set), also post the reply to the channel. Use for important updates that everyone should see.',
          ),
      },
      async ({
        channelId,
        text,
        threadTs,
        replyBroadcast,
      }: {
        channelId: string;
        text: string;
        threadTs?: string;
        replyBroadcast: boolean;
      }) => {
        try {
          const result = await sendSlackChannelMessage(
            botToken,
            channelId,
            text,
            threadTs,
            replyBroadcast ? { replyBroadcast: true } : undefined,
          );
          if (!result.ok) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Failed to send message: ${result.error}`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: `Message sent to channel <#${channelId}>.`,
              },
            ],
          };
        } catch (err) {
          logger.warn('slack_send_channel_message tool failed', { err });
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to send message: ${err instanceof Error ? err.message : 'unknown error'}`,
              },
            ],
            isError: true,
          };
        }
      },
      {
        annotations: {
          destructiveHint: false,
          openWorldHint: true,
        },
      },
    ),
  ];
}

/**
 * Create an SDK MCP server with Slack workspace search tools.
 */
export function createSlackSearchServer(options: SlackSearchServerOptions) {
  return createSdkMcpServer({
    name: 'slack-search',
    version: '1.0.0',
    tools: slackSearchTools(options),
  });
}
