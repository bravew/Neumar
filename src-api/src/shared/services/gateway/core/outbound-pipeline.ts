/**
 * Outbound Pipeline
 *
 * Format, chunk, and send messages through channel adapters.
 * Handles retry with exponential backoff.
 */

import { createLogger } from '@/shared/utils/logger';

import type {
  ChannelAdapter,
  OutboundContent,
  SendResult,
} from '../channels/types';

const logger = createLogger('OutboundPipeline');

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;

/**
 * Smart-split text at paragraph -> sentence -> word boundaries.
 */
export function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at paragraph
    let splitIdx = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIdx <= 0) {
      // Try sentence boundary
      splitIdx = remaining.lastIndexOf('. ', maxLength);
      if (splitIdx > 0) splitIdx += 1; // include the period
    }
    if (splitIdx <= 0) {
      // Try newline
      splitIdx = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitIdx <= 0) {
      // Try space (word boundary)
      splitIdx = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIdx <= 0) {
      // Hard split
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

/**
 * Strip unsupported markdown syntax for channels that don't support it.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (match) => {
      // Keep code content, remove fences
      const inner = match.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
      return inner;
    })
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1');
}

/**
 * Send a message through a channel adapter with retry.
 */
export async function sendWithRetry(
  adapter: ChannelAdapter,
  chatId: string,
  content: OutboundContent,
): Promise<SendResult> {
  const maxLen = adapter.capabilities.maxMessageLength;
  const text = adapter.capabilities.supportsMarkdown
    ? content.text
    : stripMarkdown(content.text);

  const chunks = chunkText(text, maxLen);

  let lastResult: SendResult = {
    messageId: '',
    success: false,
    error: 'No chunks to send',
  };

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx]!;
    const isFirst = chunkIdx === 0;
    const isLast = chunkIdx === chunks.length - 1;
    const chunkContent: OutboundContent = {
      ...content,
      text: chunk,
      // Only attach buttons to the last chunk
      buttons: isLast ? content.buttons : undefined,
      // Only attach files to the first chunk (adapter handles batching)
      files: isFirst ? content.files : undefined,
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        lastResult = await adapter.sendMessage(chatId, chunkContent);
        if (lastResult.success) break;
      } catch (err) {
        lastResult = {
          messageId: '',
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        logger.warn(
          `Send retry ${attempt + 1}/${MAX_RETRIES} for ${adapter.id} after ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    if (!lastResult.success) {
      logger.error(
        `Failed to send message to ${adapter.id}:${chatId} after ${MAX_RETRIES} retries`,
      );
      break;
    }
  }

  return lastResult;
}
