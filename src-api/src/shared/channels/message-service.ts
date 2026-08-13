import { createLogger } from '@/shared/utils/logger';

import type { BasePlugin } from './base-plugin';
import type { OutboundPipeline } from './outbound-pipeline';
import { stripAgentScaffolding } from './slack/result-blocks';

const logger = createLogger('ChannelMessageService');
const THROTTLE_MS = 500;
const CURSOR = '▌';

/**
 * How often to refresh a platform typing indicator (ms).
 * Telegram's typing action lasts ~5s; Discord's lasts ~10s.
 * We refresh every 4s to stay safely within both limits.
 */
const TYPING_REFRESH_MS = 4_000;

/**
 * If no first chunk arrives within this threshold, send a visible
 * placeholder so the user gets immediate feedback on platforms that
 * don't support native typing indicators.
 */
const PLACEHOLDER_DELAY_MS = 5_000;
const PLACEHOLDER_TEXT = '⏳ …';

export class ChannelMessageService {
  /**
   * Streams agent output to a channel via throttled edit-in-place.
   *
   * While waiting for the first chunk:
   *   1. Sends a platform typing indicator every 4s (Telegram / Discord).
   *   2. After 3s with no chunk, sends a visible placeholder message
   *      (for platforms without a typing indicator, or as belt-and-suspenders).
   *
   * Returns the complete final text and the Slack message ID for post-processing.
   */
  async streamToChannel(
    plugin: BasePlugin,
    conversationId: string,
    agentStream: AsyncIterable<string>,
    pipeline: OutboundPipeline,
  ): Promise<{ text: string; messageId: string | null }> {
    let buffer = '';
    let currentMessageId: string | null = null;
    let lastEditAt = 0;

    // ── Typing indicator loop ──────────────────────────────────────────────
    // Fire immediately, then repeat every TYPING_REFRESH_MS until first
    // message is sent or the stream ends.
    let typingStopped = false;
    const wakeUp = { resolve: null as (() => void) | null };
    const typingLoop = (async () => {
      while (!typingStopped) {
        if (plugin.sendTypingAction) {
          await plugin.sendTypingAction(conversationId).catch(() => {});
        }
        await new Promise<void>((r) => {
          wakeUp.resolve = r;
          setTimeout(r, TYPING_REFRESH_MS);
        });
        wakeUp.resolve = null;
      }
    })();

    // ── Placeholder fallback ───────────────────────────────────────────────
    // If no first chunk arrives within PLACEHOLDER_DELAY_MS, send a visible
    // holding message that will be edited in-place when content arrives.
    let placeholderSent = false;
    const placeholderTimer = setTimeout(async () => {
      if (currentMessageId) return; // first chunk already arrived — skip
      try {
        const result = await pipeline.sendWithRetry(() =>
          plugin.sendMessage(conversationId, { text: PLACEHOLDER_TEXT }),
        );
        if (result.messageId && !currentMessageId) {
          currentMessageId = result.messageId;
          placeholderSent = true;
        }
      } catch {
        /* ignore — typing indicator is enough */
      }
    }, PLACEHOLDER_DELAY_MS);

    try {
      for await (const chunk of agentStream) {
        buffer += chunk;
        const now = Date.now();

        if (!currentMessageId) {
          // First chunk — stop typing, cancel placeholder, send real message
          typingStopped = true;
          clearTimeout(placeholderTimer);
          const result = await pipeline.sendWithRetry(() =>
            plugin.sendMessage(conversationId, { text: buffer + CURSOR }),
          );
          currentMessageId = result.messageId;
          lastEditAt = now;
        } else if (
          plugin.capabilities.supportsEditMessage &&
          plugin.editMessage &&
          now - lastEditAt >= THROTTLE_MS
        ) {
          const maxLen = plugin.capabilities.maxMessageLength;
          const truncated =
            maxLen > 0 ? (pipeline.chunk(buffer, maxLen)[0] ?? buffer) : buffer;
          await plugin
            .editMessage(conversationId, currentMessageId, truncated + CURSOR)
            .catch(() => {});
          lastEditAt = now;
        }
      }
    } finally {
      typingStopped = true;
      clearTimeout(placeholderTimer);
      // Wake the typing loop immediately so it exits without waiting for the sleep timer
      wakeUp.resolve?.();
      await typingLoop;
    }

    // ── Final update ───────────────────────────────────────────────────────
    // Scrub leaked agent scaffolding tokens ("[Tool: …]", "[Current message
    // from …]", persona prefixes) before the final render. These leak when
    // a profile prompt teaches the agent to emit a transcript-style response
    // instead of actually calling tools.
    const scrubbed = stripAgentScaffolding(buffer);
    if (
      currentMessageId &&
      plugin.capabilities.supportsEditMessage &&
      plugin.editMessage
    ) {
      const clean = pipeline.stripFilePaths(scrubbed);
      const maxLen = plugin.capabilities.maxMessageLength;
      const chunks = maxLen > 0 ? pipeline.chunk(clean, maxLen) : [clean];
      await plugin
        .editMessage(conversationId, currentMessageId, chunks[0] ?? '')
        .catch(() => {});
      for (const extra of chunks.slice(1)) {
        await pipeline.sendWithRetry(() =>
          plugin.sendMessage(conversationId, { text: extra }),
        );
      }
    } else if (!currentMessageId && scrubbed) {
      // Empty stream but we have buffered text — send it now
      await pipeline.sendWithRetry(() =>
        plugin.sendMessage(conversationId, {
          text: pipeline.stripFilePaths(scrubbed),
        }),
      );
    } else if (placeholderSent && !buffer) {
      // Placeholder was sent but agent produced nothing — clear it
      if (currentMessageId && plugin.editMessage) {
        await plugin
          .editMessage(conversationId, currentMessageId, '(no response)')
          .catch(() => {});
      }
    }

    logger.debug(
      `Stream complete for ${plugin.platform}:${conversationId}, length=${buffer.length}`,
    );
    return { text: buffer, messageId: currentMessageId };
  }
}
