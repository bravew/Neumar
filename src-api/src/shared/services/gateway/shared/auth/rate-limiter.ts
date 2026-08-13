/**
 * Rate Limiter
 *
 * Per-user, per-channel message rate limiting using sliding window.
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('RateLimiter');

interface RateWindow {
  timestamps: number[];
}

export class RateLimiter {
  private windows = new Map<string, RateWindow>();
  private maxPerMinute: number;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(maxPerMinute = 20) {
    this.maxPerMinute = maxPerMinute;
    // Auto-cleanup stale entries every 5 minutes (unref to not block process shutdown)
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60_000);
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.windows.clear();
  }

  /**
   * Check if a request is allowed. Returns remaining seconds until next allowed if rate-limited.
   */
  check(key: string): { allowed: boolean; retryAfterSeconds?: number } {
    const now = Date.now();
    const windowMs = 60_000;
    const cutoff = now - windowMs;

    let window = this.windows.get(key);
    if (!window) {
      window = { timestamps: [] };
      this.windows.set(key, window);
    }

    // Remove expired timestamps
    window.timestamps = window.timestamps.filter((t) => t > cutoff);

    if (window.timestamps.length >= this.maxPerMinute) {
      const oldestInWindow = window.timestamps[0]!;
      const retryAfterSeconds = Math.ceil(
        (oldestInWindow + windowMs - now) / 1000,
      );
      logger.debug(
        `Rate limited: ${key} (${window.timestamps.length}/${this.maxPerMinute})`,
      );
      return { allowed: false, retryAfterSeconds };
    }

    window.timestamps.push(now);
    return { allowed: true };
  }

  /** Periodically clean up stale entries */
  cleanup(): void {
    const now = Date.now();
    const cutoff = now - 60_000;
    for (const [key, window] of this.windows) {
      window.timestamps = window.timestamps.filter((t) => t > cutoff);
      if (window.timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }
}
