/**
 * Slack Notification Service
 *
 * Bot API as primary path, webhook as fallback. Retry/backoff on transient failures.
 */

import { buildNotificationBlocks } from '@/shared/channels/slack/formatter';
import { createLogger } from '@/shared/utils/logger';

import { loadSlackConfig } from './slack-config';

const logger = createLogger('SlackService');

// ============================================================================
// Types
// ============================================================================

export interface SlackMessage {
  title: string;
  issueId: string;
  issueTitle: string;
  prUrl: string;
  summary: string;
  branch: string;
}

// ============================================================================
// Payload builder
// ============================================================================

function buildSlackPayload(message: SlackMessage) {
  return {
    text: `PR Ready for Review: ${message.issueId} — ${message.issueTitle}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'PR Ready for Review' },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Issue:*\n<${message.prUrl}|${message.issueId}> — ${message.issueTitle}`,
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
          text: `*Summary:*\n\`\`\`${message.summary.slice(0, 2500)}\`\`\``,
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
    ],
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Send notification to Slack via incoming webhook.
 * Best-effort: logs errors but doesn't throw. Retries up to 3 times
 * with exponential backoff on transient failures (429, 5xx).
 */
export async function sendSlackNotification(
  webhookUrl: string,
  message: SlackMessage,
): Promise<void> {
  const payload = buildSlackPayload(message);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        logger.info('Slack notification sent successfully');
        return;
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10);
        const backoffMs = retryAfter * 1000 || Math.pow(2, attempt) * 1000;
        logger.warn(
          `Slack returned ${res.status}, retrying in ${backoffMs}ms (attempt ${attempt}/3)`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      logger.error(
        `Slack notification failed: ${res.status} ${await res.text()}`,
      );
      return;
    } catch (err) {
      logger.error(`Slack notification error (attempt ${attempt}/3):`, err);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }
}

/**
 * Send notification to Slack via Bot API (chat.postMessage).
 * Requires bot token and bot must be in the target channel.
 */
export async function sendSlackNotificationViaBot(
  channelId: string,
  message: SlackMessage,
): Promise<void> {
  const config = await loadSlackConfig();
  if (!config.botToken) {
    logger.warn('No bot token available, cannot send via bot API');
    return;
  }

  const blocks = buildNotificationBlocks(message);
  const fallbackText = `PR Ready for Review: ${message.issueId} — ${message.issueTitle}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${config.botToken}`,
        },
        body: JSON.stringify({
          channel: channelId,
          text: fallbackText,
          blocks,
        }),
      });

      const data = (await res.json()) as { ok: boolean; error?: string };

      if (data.ok) {
        logger.info('Slack notification sent via bot API');
        return;
      }

      if (data.error === 'not_in_channel') {
        logger.error(
          'Bot is not in the target channel. Invite the bot to the channel first.',
        );
        return;
      }

      if (data.error === 'ratelimited' || res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10);
        const backoffMs = retryAfter * 1000 || Math.pow(2, attempt) * 1000;
        logger.warn(
          `Slack API rate limited, retrying in ${backoffMs}ms (attempt ${attempt}/3)`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      logger.error(`Slack bot notification failed: ${data.error}`);
      return;
    } catch (err) {
      logger.error(`Slack bot notification error (attempt ${attempt}/3):`, err);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }
}

/**
 * Smart dispatcher: tries bot API first (if configured), falls back to webhook.
 */
export async function sendSmartSlackNotification(
  message: SlackMessage,
  webhookUrl?: string,
): Promise<void> {
  const config = await loadSlackConfig();

  if (config.botToken && config.gateway.defaultChannel) {
    try {
      await sendSlackNotificationViaBot(config.gateway.defaultChannel, message);
      return;
    } catch (err) {
      logger.warn('Bot API notification failed, falling back to webhook:', err);
    }
  }

  if (webhookUrl) {
    await sendSlackNotification(webhookUrl, message);
  } else {
    logger.warn(
      'No notification channel available (no bot token + channel, no webhook URL)',
    );
  }
}
