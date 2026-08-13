import {
  classifyProviderError,
  type ProviderError,
} from '@/shared/channels/_shared/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('OutboundPipeline');

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1_000;

// Regex matching absolute file paths to strip from responses
const LOCAL_PATH_RE =
  /\/(?:Users|home|tmp|var|Volumes)\/[^\s`"'<>|]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg|pdf|mp3|wav|ogg|mp4|mov|avi|mkv|webm)\b/gi;

/** Matches markdown image syntax: ![alt](url-or-path) */
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

export class OutboundPipeline {
  /**
   * Smart-split text at paragraph/sentence/word boundaries.
   */
  chunk(text: string, maxLength: number): string[] {
    if (maxLength <= 0 || text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      let splitIdx = remaining.lastIndexOf('\n\n', maxLength);
      if (splitIdx <= 0) {
        splitIdx = remaining.lastIndexOf('. ', maxLength);
        if (splitIdx > 0) splitIdx += 1;
      }
      if (splitIdx <= 0) splitIdx = remaining.lastIndexOf('\n', maxLength);
      if (splitIdx <= 0) splitIdx = remaining.lastIndexOf(' ', maxLength);
      if (splitIdx <= 0) splitIdx = maxLength;

      chunks.push(remaining.slice(0, splitIdx).trimEnd());
      remaining = remaining.slice(splitIdx).trimStart();
    }

    return chunks.filter(Boolean);
  }

  /**
   * Strip local file paths from text before sending externally.
   */
  stripFilePaths(text: string): string {
    return text
      .replace(MD_IMAGE_RE, '')
      .replace(LOCAL_PATH_RE, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Extract image references from markdown `![alt](url)` syntax.
   * Returns local file paths and remote URLs separately so callers can
   * send them via `sendFiles()` and `sendPhoto(url)` respectively.
   */
  extractMarkdownImages(text: string): {
    localPaths: string[];
    remoteUrls: string[];
  } {
    const localPaths: string[] = [];
    const remoteUrls: string[] = [];
    for (const match of text.matchAll(MD_IMAGE_RE)) {
      const ref = match[2]!;
      if (ref.startsWith('https://')) {
        remoteUrls.push(ref);
      } else if (ref.startsWith('/')) {
        localPaths.push(ref);
      }
    }
    return { localPaths, remoteUrls };
  }

  /**
   * Strip markdown for platforms that don't support it.
   */
  stripMarkdown(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, (m) =>
        m.replace(/^```\w*\n?/, '').replace(/\n?```$/, ''),
      )
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1');
  }

  /**
   * Send with 3-retry exponential backoff.
   */
  async sendWithRetry(
    sendFn: () => Promise<{ messageId: string | null }>,
    retries = MAX_RETRIES,
  ): Promise<{ messageId: string | null; error?: ProviderError }> {
    let lastError: ProviderError | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // `messageId === null` is a valid success per the BasePlugin contract
        // (fire-and-forget sends), so any non-throwing return is success.
        return await sendFn();
      } catch (err) {
        lastError = classifyProviderError(err, { provider: 'channel' });
        if (!lastError.retryable || attempt >= retries) break;
        const delay =
          lastError.retryAfterMs ?? RETRY_BASE_DELAY * Math.pow(2, attempt);
        logger.warn(`Send retry ${attempt + 1}/${retries} after ${delay}ms`, {
          errorClass: lastError.class,
        });
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
    logger.error('All send retries exhausted', { err: lastError });
    return { messageId: null, error: lastError };
  }
}
