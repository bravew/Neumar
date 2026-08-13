/**
 * Gateway circuit breaker for noisy channel reconnect loops.
 *
 * Keeps restart storms local to the failing adapter and exposes a small
 * state machine that the gateway can surface as channel health.
 */

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  maxConsecutiveFailures: number;
  windowMs: number;
  halfOpenAfterMs: number;
  maxCooldownMs: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxConsecutiveFailures: 10,
  windowMs: 600_000,
  halfOpenAfterMs: 300_000,
  maxCooldownMs: 3_600_000,
};

export class CircuitBreaker {
  private stateValue: CircuitBreakerState = 'closed';
  private failures: number[] = [];
  private openedAt: number | null = null;
  private cooldownMs: number;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cooldownMs = this.config.halfOpenAfterMs;
  }

  get state(): CircuitBreakerState {
    this.refreshHalfOpen();
    return this.stateValue;
  }

  get nextProbeAt(): number | null {
    if (this.openedAt === null) return null;
    return this.openedAt + this.cooldownMs;
  }

  canAttempt(): boolean {
    this.refreshHalfOpen();
    return this.stateValue !== 'open';
  }

  recordSuccess(): void {
    this.failures = [];
    this.openedAt = null;
    this.cooldownMs = this.config.halfOpenAfterMs;
    this.stateValue = 'closed';
  }

  recordFailure(now = Date.now()): CircuitBreakerState {
    if (this.stateValue === 'half-open') {
      this.open(now);
      this.cooldownMs = Math.min(
        this.cooldownMs * 2,
        this.config.maxCooldownMs,
      );
      return this.stateValue;
    }

    const cutoff = now - this.config.windowMs;
    this.failures = this.failures.filter((t) => t >= cutoff);
    this.failures.push(now);

    if (this.failures.length >= this.config.maxConsecutiveFailures) {
      this.open(now);
    }

    return this.stateValue;
  }

  reset(): void {
    this.failures = [];
    this.openedAt = null;
    this.cooldownMs = this.config.halfOpenAfterMs;
    this.stateValue = 'closed';
  }

  private open(now: number): void {
    this.stateValue = 'open';
    this.openedAt = now;
    this.failures = [];
  }

  private refreshHalfOpen(now = Date.now()): void {
    if (
      this.stateValue === 'open' &&
      this.openedAt !== null &&
      now - this.openedAt >= this.cooldownMs
    ) {
      this.stateValue = 'half-open';
    }
  }
}
