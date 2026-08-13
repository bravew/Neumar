import { describe, expect, it, vi } from 'vitest';

import { CircuitBreaker } from '@/shared/services/gateway/core/circuit-breaker';

describe('CircuitBreaker', () => {
  it('opens after consecutive failures inside the window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_200);

    const breaker = new CircuitBreaker({
      maxConsecutiveFailures: 3,
      windowMs: 1_000,
      halfOpenAfterMs: 500,
      maxCooldownMs: 5_000,
    });

    expect(breaker.recordFailure(1_000)).toBe('closed');
    expect(breaker.recordFailure(1_100)).toBe('closed');
    expect(breaker.recordFailure(1_200)).toBe('open');
    expect(breaker.canAttempt()).toBe(false);
  });

  it('moves to half-open after cooldown and closes on success', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const breaker = new CircuitBreaker({
      maxConsecutiveFailures: 1,
      windowMs: 1_000,
      halfOpenAfterMs: 500,
      maxCooldownMs: 5_000,
    });

    expect(breaker.recordFailure()).toBe('open');
    vi.setSystemTime(499);
    expect(breaker.state).toBe('open');
    vi.setSystemTime(500);
    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.state).toBe('half-open');

    breaker.recordSuccess();
    expect(breaker.state).toBe('closed');
  });

  it('doubles cooldown after half-open failure', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const breaker = new CircuitBreaker({
      maxConsecutiveFailures: 1,
      windowMs: 1_000,
      halfOpenAfterMs: 100,
      maxCooldownMs: 250,
    });

    breaker.recordFailure();
    vi.setSystemTime(100);
    expect(breaker.state).toBe('half-open');
    breaker.recordFailure();

    expect(breaker.state).toBe('open');
    expect(breaker.nextProbeAt).toBe(300);
  });
});
