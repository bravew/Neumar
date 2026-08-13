/**
 * Channel Formatter for Automation Delivery
 *
 * Wraps automation-specific metadata (name, status, cost, duration)
 * around run results and produces a NormalizedResponse that the existing
 * per-plugin formatters handle for platform-specific rendering.
 *
 * This module handles: truncation, multi-message chunking, metadata
 * header/footer injection. It does NOT duplicate per-platform markdown
 * conversion — each plugin's sendMessage() handles that.
 */

import type { NormalizedResponse } from '@/shared/channels/types';

import { CHANNEL_DELIVERY_MAX_RESULT_LENGTH } from './constants';
import type {
  Automation,
  AutomationChannelDelivery,
  AutomationRun,
} from './types';

// ============================================================================
// Platform Max Lengths
// ============================================================================

const PLATFORM_MAX_LENGTHS: Record<string, number> = {
  telegram: 4096,
  discord: 2000,
  // Slack `type: "markdown"` block accepts up to 12 000 chars and chat.postMessage
  // up to 40 000 chars overall. Cap at the markdown-block limit so long automation
  // reports render as a single readable message instead of being chunked.
  slack: 12_000,
  lark: 30_000,
  desktop: 100_000,
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Format automation run result for a specific channel platform.
 *
 * Builds a NormalizedResponse with:
 * - Status emoji + automation name header
 * - Run result body (truncated to platform limit)
 * - Metadata footer (duration, cost, next run)
 *
 * Returns an array of responses (for chunking when result exceeds platform max).
 */
export function formatForChannel(
  run: AutomationRun,
  automation: Automation,
  options?: { maxLength?: number; includeMetadata?: boolean },
): NormalizedResponse[] {
  const platform = automation.channelDelivery?.platform ?? 'desktop';
  const maxLength =
    options?.maxLength ??
    automation.channelDelivery?.maxLength ??
    PLATFORM_MAX_LENGTHS[platform] ??
    4096;
  const includeMetadata = options?.includeMetadata ?? true;

  const statusEmoji = getStatusEmoji(run.status);
  const header = `${statusEmoji} **${automation.name}**`;

  const footer = includeMetadata ? buildFooter(run, automation) : '';

  const body = run.error
    ? `**Error:** ${run.error.slice(0, 500)}`
    : (run.result ?? '');

  // Budget for body after header and footer
  const overhead = header.length + footer.length + 4; // newlines
  const bodyBudget = Math.min(
    maxLength - overhead,
    CHANNEL_DELIVERY_MAX_RESULT_LENGTH,
  );
  const truncatedBody = truncateResult(body, bodyBudget);

  const fullText = [header, '', truncatedBody, footer]
    .filter(Boolean)
    .join('\n');

  // If the full text fits in one message, return single response
  if (fullText.length <= maxLength) {
    return [{ text: fullText }];
  }

  // Otherwise chunk into multiple messages
  return chunkMessage(fullText, maxLength);
}

/**
 * Format a system notification (expiry, budget exhaustion, etc.)
 * for channel delivery. Simpler than run results — no body to chunk.
 */
export function formatSystemNotification(
  message: string,
  _automation: Automation,
): NormalizedResponse {
  return { text: message };
}

// ============================================================================
// Helpers
// ============================================================================

function buildFooter(
  run: AutomationRun,
  automation: AutomationChannelDelivery | Automation,
): string {
  const parts: string[] = [];

  if (run.durationMs) {
    parts.push(formatDuration(run.durationMs));
  }
  if (run.cost) {
    parts.push(`$${run.cost.toFixed(4)}`);
  }

  const a = 'runCount' in automation ? automation : undefined;
  if (a?.runCount) {
    parts.push(`run #${a.runCount}`);
  }

  return parts.length > 0 ? `_${parts.join(' · ')}_` : '';
}

function getStatusEmoji(status: string): string {
  const map: Record<string, string> = {
    completed: '\u2705',
    failed: '\u274C',
    timed_out: '\u23F0',
    cancelled: '\uD83D\uDEAB',
  };
  return map[status] ?? '\uD83D\uDD14';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function truncateResult(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 30) + '\n\n... _(truncated)_';
}

function chunkMessage(text: string, maxLength: number): NormalizedResponse[] {
  const chunks: NormalizedResponse[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push({ text: remaining });
      break;
    }

    // Find a good break point (newline near the limit)
    let breakPoint = remaining.lastIndexOf('\n', maxLength);
    if (breakPoint < maxLength * 0.5) {
      breakPoint = maxLength;
    }

    chunks.push({ text: remaining.slice(0, breakPoint) });
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return chunks;
}
