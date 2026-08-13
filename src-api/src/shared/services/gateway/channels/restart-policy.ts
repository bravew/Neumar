/**
 * Channel Restart Policy
 *
 * Exponential backoff with jitter for channel reconnection.
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('RestartPolicy');

export interface RestartPolicyConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  resetAfterMs: number;
}

const DEFAULT_CONFIG: RestartPolicyConfig = {
  maxRetries: 10,
  baseDelayMs: 5000,
  maxDelayMs: 300000,
  jitterFactor: 0.3,
  resetAfterMs: 600000,
};

export class RestartPolicy {
  private retryCount = 0;
  private lastStableAt: number | null = null;
  private config: RestartPolicyConfig;

  constructor(config: Partial<RestartPolicyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  markStable(): void {
    this.lastStableAt = Date.now();
  }

  shouldRetry(): boolean {
    // Reset retry count if connection was stable long enough
    if (
      this.lastStableAt &&
      Date.now() - this.lastStableAt > this.config.resetAfterMs
    ) {
      this.retryCount = 0;
    }
    return this.retryCount < this.config.maxRetries;
  }

  getNextDelay(): number {
    const baseDelay = Math.min(
      this.config.baseDelayMs * Math.pow(2, this.retryCount),
      this.config.maxDelayMs,
    );

    // Apply jitter: +/- jitterFactor
    const jitter =
      baseDelay * this.config.jitterFactor * (2 * Math.random() - 1);
    const delay = Math.max(0, Math.round(baseDelay + jitter));

    this.retryCount++;
    logger.debug(
      `Retry ${this.retryCount}/${this.config.maxRetries}, delay: ${delay}ms`,
    );

    return delay;
  }

  reset(): void {
    this.retryCount = 0;
    this.lastStableAt = null;
  }

  get currentRetryCount(): number {
    return this.retryCount;
  }
}
