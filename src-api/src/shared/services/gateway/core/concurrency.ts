/**
 * Agent Concurrency Gate
 *
 * Limits concurrent agent runs per identity.
 */

interface BucketState {
  tokens: number;
  refilledAt: number;
  lastSeenAt: number;
}

/**
 * Per-(channel, identity) token-bucket rate limiter.
 *
 * Default budgets follow Phase 6 spec:
 *   - 30 inbound msg/min  (key: `${channelId}:${identityId}:inbound`)
 *   - 10 outbound msg/min (key: `${channelId}:${chatId}:outbound`)
 *   - 200 ACP RPC/min    (key: `acp:${tokenSubject}:rpc`)
 *
 * `Retry-After` (seconds) is returned alongside the boolean so callers can
 * forward it as an HTTP header on 429.
 */
export class RateLimiter {
  private buckets = new Map<string, BucketState>();

  constructor(
    private capacity: number,
    private windowMs: number,
    private maxBuckets = 10_000,
  ) {}

  consume(key: string): { allowed: boolean; retryAfterSecs: number } {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? {
      tokens: this.capacity,
      refilledAt: now,
      lastSeenAt: now,
    };
    bucket.lastSeenAt = now;

    const elapsed = now - bucket.refilledAt;
    if (elapsed >= this.windowMs) {
      bucket.tokens = this.capacity;
      bucket.refilledAt = now;
    }

    if (bucket.tokens <= 0) {
      this.buckets.set(key, bucket);
      this.prune(now);
      const retryAfterSecs = Math.max(
        1,
        Math.ceil((this.windowMs - (now - bucket.refilledAt)) / 1000),
      );
      return { allowed: false, retryAfterSecs };
    }

    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    this.prune(now);
    return { allowed: true, retryAfterSecs: 0 };
  }

  private prune(now: number): void {
    if (this.buckets.size <= this.maxBuckets) return;

    const staleBefore = now - this.windowMs * 2;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastSeenAt < staleBefore) {
        this.buckets.delete(key);
      }
    }

    while (this.buckets.size > this.maxBuckets) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

export const inboundLimiter = new RateLimiter(30, 60_000);
export const outboundLimiter = new RateLimiter(10, 60_000);
export const acpRpcLimiter = new RateLimiter(200, 60_000);

export function inboundKey(channelId: string, identityId: string): string {
  return `${channelId}:${identityId}:inbound`;
}

export function outboundKey(channelId: string, chatId: string): string {
  return `${channelId}:${chatId}:outbound`;
}

export function acpRpcKey(tokenSubject: string): string {
  return `acp:${tokenSubject}:rpc`;
}

export class AgentConcurrencyGate {
  private active = new Map<string, number>();
  private maxConcurrent: number;

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  acquire(identityId: string): boolean {
    const current = this.active.get(identityId) ?? 0;
    if (current >= this.maxConcurrent) return false;
    this.active.set(identityId, current + 1);
    return true;
  }

  release(identityId: string): void {
    const current = this.active.get(identityId) ?? 0;
    if (current <= 1) this.active.delete(identityId);
    else this.active.set(identityId, current - 1);
  }

  getActiveCount(identityId: string): number {
    return this.active.get(identityId) ?? 0;
  }

  get totalActive(): number {
    let total = 0;
    for (const count of this.active.values()) total += count;
    return total;
  }
}
