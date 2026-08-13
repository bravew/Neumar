/**
 * Automation Delivery Service
 *
 * Sends post-run notifications via:
 * - Slack webhook (legacy)
 * - HTTP webhook (legacy)
 * - Channel plugins (Telegram, Discord, Slack, Lark)
 * - Desktop notifications (event-based)
 *
 * Delivery failures are logged but never fail the run itself.
 *
 * SCALE NOTE — Delivery Rate Limiting:
 * ─────────────────────────────────────
 * Currently no per-channel rate limiting on outbound delivery.
 * Platforms enforce their own limits (Telegram: 30 msg/s, Discord: 5 msg/s).
 * When automations scale up, add a per-platform token-bucket rate limiter
 * here to avoid hitting platform rate limits and getting the bot banned.
 * See constants.ts CHANNEL_DELIVERY_RATE_LIMIT (60/hour) — not yet enforced.
 *
 * SCALE NOTE — Duplicate Suppression:
 * ────────────────────────────────────
 * Dedup state (lastDeliveryHash, lastDeliveryAt) is persisted on the Automation
 * record in the JSON store. This means every dedup check triggers a store save.
 * At scale, batch dedup updates into periodic flushes or move to SQLite WHERE
 * clauses to avoid per-tick I/O.
 */

import { getChannelManager } from '@/shared/channels/channel-manager';
import { createLogger } from '@/shared/utils/logger';
import { validateBaseUrl } from '@/shared/utils/url-validator';

import {
  formatForChannel,
  formatSystemNotification,
} from './channel-formatter';
import {
  HEARTBEAT_OK_TOKEN,
  SLACK_ERROR_MAX_LENGTH,
  SLACK_RESULT_MAX_LENGTH,
  SUPPRESS_EMPTY_MIN_LENGTH,
} from './constants';
import { emit } from './hooks';
import type {
  Automation,
  AutomationChannelDelivery,
  AutomationDelivery,
  AutomationRun,
} from './types';

const logger = createLogger('AutomationDelivery');

// ============================================================================
// Duplicate Suppression
// ============================================================================

/** Dedup window: 24 hours */
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Max chars of content after HEARTBEAT_OK stripping before suppressing.
 * 50 chars allows "all clear", "checked, nothing new" type acks through
 * while preserving any substantive content.
 */
const SUPPRESS_EMPTY_ACK_MAX_CHARS = 50;

/**
 * Check if this result is identical to the last delivery for this automation.
 * Uses the persisted `lastDeliveryHash` and `lastDeliveryAt` fields on the
 * Automation record so dedup state survives restarts.
 */
function isDuplicateDelivery(automation: Automation, result: string): boolean {
  const now = Date.now();
  const hash = simpleHash(result.trim());

  if (
    automation.lastDeliveryHash === hash &&
    automation.lastDeliveryAt &&
    now - new Date(automation.lastDeliveryAt).getTime() < DEDUP_WINDOW_MS
  ) {
    return true;
  }

  // Update persisted dedup state (will be saved by caller or next store flush)
  automation.lastDeliveryHash = hash;
  automation.lastDeliveryAt = new Date(now).toISOString();
  return false;
}

function simpleHash(text: string): string {
  // djb2 hash — fast, sufficient for dedup
  let hash = 5381;
  for (let i = 0; i < Math.min(text.length, 2000); i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Deliver a post-run notification based on the automation's delivery config.
 * Handles both legacy (slack/webhook) and new (channel/desktop) modes.
 * Skips silently if no delivery is configured or conditions aren't met.
 *
 * Returns true if the result was delivered (or desktop-routed), false if suppressed.
 * The caller uses this to decide whether to inject the result into the task conversation.
 */
export async function deliver(
  run: AutomationRun,
  automation: Automation,
): Promise<boolean> {
  // Try channel delivery first (new system)
  if (automation.channelDelivery) {
    return deliverToChannel(automation.channelDelivery, run, automation);
  }

  // Fall back to legacy delivery
  if (!automation.delivery || automation.delivery.mode === 'none') {
    return true; // No delivery configured — treat as "delivered" for inject purposes
  }

  // Skip if onlyOnFailure and the run succeeded
  if (automation.delivery.onlyOnFailure && run.status === 'completed') {
    return true;
  }

  if (shouldSuppressSuccessNotification(automation.delivery, run)) {
    logger.info('Delivery suppressed (silent successful run)', {
      automationId: automation.id,
      runId: run.id,
    });
    return true;
  }

  try {
    switch (automation.delivery.mode) {
      case 'slack':
        if (automation.delivery.slackWebhookUrl) {
          const slackValidation = validateDeliveryUrl(
            automation.delivery.slackWebhookUrl,
          );
          if (!slackValidation.valid) {
            logger.warn('Blocked Slack webhook URL (SSRF)', {
              reason: slackValidation.reason,
              automationId: automation.id,
            });
            return false;
          }
          await deliverSlack(
            automation.delivery.slackWebhookUrl,
            run,
            automation.name,
          );
        }
        break;

      case 'webhook':
        if (automation.delivery.webhookUrl) {
          const webhookValidation = validateDeliveryUrl(
            automation.delivery.webhookUrl,
          );
          if (!webhookValidation.valid) {
            logger.warn('Blocked webhook URL (SSRF)', {
              reason: webhookValidation.reason,
              automationId: automation.id,
            });
            return false;
          }
          await deliverWebhook(automation.delivery.webhookUrl, run);
        }
        break;

      case 'channel':
      case 'desktop':
        // These modes use channelDelivery config, not legacy delivery
        break;
    }
    return true;
  } catch (err) {
    // Delivery errors are logged but never thrown
    logger.error('Delivery failed:', {
      automationId: automation.id,
      runId: run.id,
      mode: automation.delivery.mode,
      error: err,
    });
    return false;
  }
}

// ============================================================================
// Channel Delivery
// ============================================================================

/**
 * Deliver run results through a channel plugin (Telegram, Discord, Slack, Lark)
 * or emit a desktop notification event.
 *
 * Safety:
 * - Suppress-empty check before sending
 * - Fire-and-forget: delivery failures don't fail the run
 * - Strip local file paths from results before sending
 */
async function deliverToChannel(
  channelDelivery: AutomationChannelDelivery,
  run: AutomationRun,
  automation: Automation,
): Promise<boolean> {
  try {
    if (shouldSuppressSuccessNotification(channelDelivery, run)) {
      logger.info('Channel delivery suppressed (silent successful run)', {
        automationId: automation.id,
        runId: run.id,
        platform: channelDelivery.platform,
      });
      return true;
    }

    // Suppress-empty check
    if (
      channelDelivery.suppressEmpty &&
      shouldSuppressDelivery(run.result, channelDelivery)
    ) {
      logger.info('Delivery suppressed (empty/HEARTBEAT_OK)', {
        automationId: automation.id,
        runId: run.id,
      });
      void emit('run:delivery_suppressed', {
        automationId: automation.id,
        runId: run.id,
      });
      return false;
    }

    // Duplicate suppression: skip if result is identical to last delivery
    // within the dedup window. Prevents spamming when monitored data is static.
    if (run.result && isDuplicateDelivery(automation, run.result)) {
      logger.info('Delivery suppressed (duplicate within 24h)', {
        automationId: automation.id,
        runId: run.id,
      });
      return false;
    }

    // Strip @@HEARTBEAT_OK token from result for delivery only.
    // The token is an internal protocol signal — never shown to users.
    // Use a local copy to avoid mutating the stored run object.
    let deliveryResult = run.result;
    if (deliveryResult) {
      const stripped = stripHeartbeatToken(deliveryResult);
      if (stripped !== null) {
        deliveryResult = stripped;
      }
    }

    // Desktop notification — no additional emit needed.
    // The engine already emits 'run:completed' with full data (name, result, cost)
    // which the SSE endpoint forwards to the frontend. Emitting again here would
    // cause duplicate toast notifications.
    if (channelDelivery.platform === 'desktop') {
      return true;
    }

    // Channel plugin delivery — try configId first, fall back to platform name lookup
    const manager = getChannelManager();
    const plugin =
      (channelDelivery.configId
        ? manager.getPlugin(channelDelivery.configId)
        : undefined) ?? manager.getPluginByPlatform(channelDelivery.platform);
    if (!plugin) {
      logger.warn(
        `Channel ${channelDelivery.platform} not connected — skipping delivery`,
        { automationId: automation.id },
      );
      return false;
    }

    // Format run result for the platform (use stripped result for delivery)
    const deliveryRun =
      deliveryResult !== run.result ? { ...run, result: deliveryResult } : run;
    const responses = formatForChannel(deliveryRun, automation);

    // Send each chunk (multi-message for long results). Suppress link unfurls
    // so source citations don't dwarf the report body in Slack/Discord.
    for (const response of responses) {
      response.text = stripLocalPaths(response.text);
      response.unfurl = false;
      await plugin.sendMessage(channelDelivery.conversationId, response);
    }

    logger.info('Delivered to channel', {
      automationId: automation.id,
      platform: channelDelivery.platform,
      chunks: responses.length,
    });
    return true;
  } catch (err) {
    logger.error('Channel delivery failed:', {
      automationId: automation.id,
      runId: run.id,
      platform: channelDelivery.platform,
      error: err,
    });
    return false;
  }
}

function shouldSuppressSuccessNotification(
  delivery: Pick<
    AutomationDelivery | AutomationChannelDelivery,
    'wakeMode' | 'suppressSuccessNotification'
  >,
  run: AutomationRun,
): boolean {
  if (run.status !== 'completed') return false;
  return (
    delivery.suppressSuccessNotification === true ||
    delivery.wakeMode === 'silent'
  );
}

/**
 * Deliver a system notification (expiry, budget exhaustion, etc.)
 * through the automation's configured channel.
 */
export async function deliverSystemNotification(
  automation: Automation,
  message: string,
  eventType:
    | 'automation:expired'
    | 'automation:max_runs_reached'
    | 'automation:budget_exhausted'
    | 'automation:consecutive_failures' = 'automation:expired',
): Promise<void> {
  if (!automation.channelDelivery) return;

  try {
    if (automation.channelDelivery.platform === 'desktop') {
      void emit(eventType, {
        automationId: automation.id,
        data: { message },
      });
      return;
    }

    const manager = getChannelManager();
    const plugin =
      (automation.channelDelivery.configId
        ? manager.getPlugin(automation.channelDelivery.configId)
        : undefined) ??
      manager.getPluginByPlatform(automation.channelDelivery.platform);
    if (!plugin) return;

    const response = formatSystemNotification(message, automation);
    await plugin.sendMessage(
      automation.channelDelivery.conversationId,
      response,
    );
  } catch (err) {
    logger.error('System notification delivery failed:', {
      automationId: automation.id,
      error: err,
    });
  }
}

// ============================================================================
// Suppress-Empty Detection
// ============================================================================

/**
 * Detect "nothing to report" results and determine if delivery should be suppressed.
 *
 * Strategy: STRUCTURED SIGNAL, not keyword matching.
 *
 * Detection layers (language-agnostic):
 * 1. Result is empty or whitespace-only → suppress
 * 2. Result starts with "@@HEARTBEAT_OK" (exact ASCII token) → suppress
 * 3. Result is shorter than 50 chars AND contains no URLs, numbers,
 *    or proper nouns → likely empty (conservative heuristic)
 */
export function shouldSuppressDelivery(
  result: string | undefined,
  config: AutomationChannelDelivery,
): boolean {
  if (!config.suppressEmpty) return false;

  // If result is undefined, we can't determine emptiness — do NOT suppress.
  // Suppressing unknown results causes false positives (e.g., weather forecast
  // text was captured but result field wasn't populated).
  if (result === undefined) return false;

  // Layer 1: Explicitly empty or whitespace-only
  if (result.trim().length === 0) return true;

  const trimmed = result.trim();

  // Layer 2: Structured HEARTBEAT_OK token (language-agnostic)
  // Matches: "@@HEARTBEAT_OK", "@@HEARTBEAT_OK.", "**@@HEARTBEAT_OK**",
  // "<b>@@HEARTBEAT_OK</b>", and variants with trailing punctuation.
  // Following OpenClaw's stripHeartbeatToken pattern.
  const stripped = stripHeartbeatToken(trimmed);
  if (stripped !== null) {
    // Token was found and stripped. If remainder is short (< ackMaxChars),
    // treat as "nothing to report" and suppress.
    if (stripped.length < SUPPRESS_EMPTY_ACK_MAX_CHARS) return true;
  }

  // Layer 3: Very short result heuristic (conservative)
  if (trimmed.length < SUPPRESS_EMPTY_MIN_LENGTH) {
    // Check if it contains URLs, numbers, or meaningful content
    const hasUrl = /https?:\/\//.test(trimmed);
    const hasNumbers = /\d{2,}/.test(trimmed);
    if (!hasUrl && !hasNumbers) return true;
  }

  return false;
}

/**
 * Strip the @@HEARTBEAT_OK token from a response.
 * Returns the remainder (possibly empty), or null if token was not found.
 *
 * Handles:
 * - Bare token: "@@HEARTBEAT_OK"
 * - With trailing punctuation: "@@HEARTBEAT_OK.", "@@HEARTBEAT_OK!"
 * - Wrapped in markdown: "**@@HEARTBEAT_OK**"
 * - Wrapped in HTML: "<b>@@HEARTBEAT_OK</b>"
 * - At start or end of text
 */
function stripHeartbeatToken(text: string): string | null {
  // Build pattern: optional markdown/HTML wrappers, the token, optional punctuation
  const pattern = new RegExp(
    `(?:\\*\\*|<b>)?${HEARTBEAT_OK_TOKEN}(?:\\*\\*|<\\/b>)?[.!?]{0,4}`,
    'i',
  );
  const match = text.match(pattern);
  if (!match) return null;

  // Remove the matched token and collapse whitespace
  const remainder = text.replace(pattern, '').replace(/\s+/g, ' ').trim();
  return remainder;
}

// ============================================================================
// Slack Delivery
// ============================================================================

/**
 * Send a Slack Block Kit notification about a run.
 */
async function deliverSlack(
  webhookUrl: string,
  run: AutomationRun,
  automationName: string,
): Promise<void> {
  const statusEmoji = getStatusEmoji(run.status);
  const duration = run.durationMs ? formatDuration(run.durationMs) : 'N/A';

  // Use Record<string, unknown> array to avoid strict block type inference issues
  const blocks: Record<string, unknown>[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${statusEmoji} Automation Run: ${automationName}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Status:*\n${run.status}` },
        { type: 'mrkdwn', text: `*Duration:*\n${duration}` },
        { type: 'mrkdwn', text: `*Triggered by:*\n${run.triggeredBy}` },
        {
          type: 'mrkdwn',
          text: `*Cost:*\n${run.cost ? `$${run.cost.toFixed(4)}` : 'N/A'}`,
        },
      ],
    },
  ];

  // Add result or error section
  if (run.error) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Error:*\n\`\`\`${run.error.slice(0, SLACK_ERROR_MAX_LENGTH)}\`\`\``,
      },
    });
  } else if (run.result) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Result:*\n${run.result.slice(0, SLACK_RESULT_MAX_LENGTH)}`,
      },
    });
  }

  const payload = { blocks };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    logger.warn('Slack delivery returned non-OK status', {
      status: response.status,
      runId: run.id,
    });
  }
}

// ============================================================================
// Webhook Delivery
// ============================================================================

/**
 * Send an HTTP webhook notification about a run.
 */
async function deliverWebhook(url: string, run: AutomationRun): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      event: 'automation.run.completed',
      run: {
        id: run.id,
        automationId: run.automationId,
        status: run.status,
        triggeredBy: run.triggeredBy,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.durationMs,
        result: run.result,
        error: run.error,
        cost: run.cost,
      },
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    logger.warn('Webhook delivery returned non-OK status', {
      status: response.status,
      runId: run.id,
    });
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate a delivery URL against SSRF risks.
 * Reuses the shared URL validator but disallows localhost for webhooks
 * (unlike provider base URLs, delivery URLs should never target local services).
 */
function validateDeliveryUrl(url: string): { valid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // Delivery webhooks must use HTTPS
  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      reason: 'Webhook URLs must use HTTPS',
    };
  }

  // Delivery webhooks must never target localhost/loopback
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname === '::1' ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  ) {
    return {
      valid: false,
      reason: 'Webhook URLs must not target localhost',
    };
  }

  // Delegate remaining checks (private IPs, metadata, etc.) to shared validator
  return validateBaseUrl(url);
}

function getStatusEmoji(status: string): string {
  const map: Record<string, string> = {
    completed: '✅',
    failed: '❌',
    timed_out: '⏰',
    cancelled: '🚫',
  };
  return map[status] ?? '🔔';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Strip local file paths from text before sending to external channels.
 * Matches common path patterns (/Users/..., /home/..., C:\...) and replaces
 * with a safe placeholder.
 */
function stripLocalPaths(text: string): string {
  return text.replace(
    /(?:\/(?:Users|home|var|tmp|Volumes|opt|etc)\/[^\s"'`)]+|[A-Z]:\\[^\s"'`)]+)/g,
    '[local path]',
  );
}
