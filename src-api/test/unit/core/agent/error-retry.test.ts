import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  calculateDelay,
  categorizeError,
  classifyRunFailure,
  retryWithStrategy,
  shouldAutoRetryRun,
} from '@/core/agent/error-retry';

describe('error-retry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('allows one transient retry only before observable side effects', () => {
    const transient = classifyRunFailure({
      status: 502,
      message: 'upstream failed',
    });
    const safe = {
      attempt: 0,
      visibleOutput: false,
      toolCall: false,
      artifactWrite: false,
      liveArtifact: false,
      cancelled: false,
    };
    expect(shouldAutoRetryRun(transient, safe)).toBe(true);
    for (const unsafe of [
      { ...safe, attempt: 1 },
      { ...safe, visibleOutput: true },
      { ...safe, toolCall: true },
      { ...safe, artifactWrite: true },
      { ...safe, liveArtifact: true },
      { ...safe, cancelled: true },
    ]) {
      expect(shouldAutoRetryRun(transient, unsafe)).toBe(false);
    }
  });

  describe('categorizeError', () => {
    it('maps 429 to aggressive backoff', () => {
      const strategy = categorizeError(429);
      expect(strategy.maxRetries).toBe(5);
      expect(strategy.initialDelayMs).toBe(2000);
      expect(strategy.maxDelayMs).toBe(60_000);
      expect(strategy.action).toBe('backoff');
      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.failureCause).toBe('quota');
      expect(strategy.retryDisposition).toBe('safe_auto_retry');
    });

    it('maps 401 to immediate fail (no token refresh wired)', () => {
      const strategy = categorizeError(401);
      expect(strategy.maxRetries).toBe(0);
      expect(strategy.action).toBe('fail');
      expect(strategy.shouldRetry).toBe(false);
      expect(strategy.failureCause).toBe('auth');
      expect(strategy.recoveryAction.type).toBe('configure_auth');
    });

    it('maps 500 to standard backoff', () => {
      const strategy = categorizeError(500);
      expect(strategy.maxRetries).toBe(3);
      expect(strategy.initialDelayMs).toBe(1000);
      expect(strategy.action).toBe('backoff');
    });

    it('maps 502 to standard backoff', () => {
      const strategy = categorizeError(502);
      expect(strategy.maxRetries).toBe(3);
      expect(strategy.action).toBe('backoff');
    });

    it('maps 503 to standard backoff', () => {
      const strategy = categorizeError(503);
      expect(strategy.maxRetries).toBe(3);
      expect(strategy.action).toBe('backoff');
    });

    it('maps 400 to no-retry fail', () => {
      const strategy = categorizeError(400);
      expect(strategy.maxRetries).toBe(0);
      expect(strategy.shouldRetry).toBe(false);
      expect(strategy.action).toBe('fail');
      expect(strategy.retryDisposition).toBe('do_not_retry');
    });

    it('maps unknown status to conservative default', () => {
      const strategy = categorizeError(418);
      expect(strategy.maxRetries).toBe(2);
      expect(strategy.initialDelayMs).toBe(1000);
      expect(strategy.maxDelayMs).toBe(16_000);
      expect(strategy.action).toBe('backoff');
      expect(strategy.failureCause).toBe('unknown');
      expect(strategy.shouldRetry).toBe(false);
      expect(strategy.retryDisposition).toBe('hitl_required');
    });

    it('auto-retries network failures classified from error text', () => {
      const strategy = categorizeError(0, 'fetch failed: ENOTFOUND api.test');

      expect(strategy.failureCause).toBe('network');
      expect(strategy.retryDisposition).toBe('safe_auto_retry');
      expect(strategy.shouldRetry).toBe(true);
    });
  });

  describe('classifyRunFailure', () => {
    it('classifies auth failures with a credential recovery action', () => {
      const failure = classifyRunFailure({
        message: 'Invalid API key. Please run /login.',
      });

      expect(failure).toMatchObject({
        cause: 'auth',
        retryDisposition: 'hitl_required',
        retryable: false,
        recoveryAction: { type: 'configure_auth' },
      });
    });

    it('classifies 504 failures as safe timeout retries', () => {
      const failure = classifyRunFailure({
        status: 504,
        message: 'gateway timeout',
      });

      expect(failure).toMatchObject({
        cause: 'timeout',
        retryDisposition: 'safe_auto_retry',
        retryable: true,
        recoveryAction: { type: 'raise_timeout' },
        reason: 'http_status_504',
      });
    });

    it('classifies model refusals as human-in-the-loop revisions', () => {
      const failure = classifyRunFailure({
        message: 'Output blocked by content policy safety filter',
      });

      expect(failure).toMatchObject({
        cause: 'model_refusal',
        retryDisposition: 'hitl_required',
        retryable: false,
        recoveryAction: { type: 'revise_request' },
      });
    });

    it('preserves Anthropic structured refusal categories', () => {
      const failure = classifyRunFailure({
        terminalReason: 'refusal',
        refusalCategory: 'frontier_llm',
      });

      expect(failure).toMatchObject({
        cause: 'model_refusal',
        retryDisposition: 'hitl_required',
        retryable: false,
        recoveryAction: { type: 'revise_request' },
        refusalCategory: 'frontier_llm',
      });
    });

    it('classifies frontier_llm refusal text on legacy error surfaces', () => {
      const failure = classifyRunFailure({
        message: 'Anthropic refusal category frontier_llm',
      });

      expect(failure).toMatchObject({
        cause: 'model_refusal',
        retryDisposition: 'hitl_required',
        retryable: false,
      });
    });

    it('classifies tool failures as fix-tool-input recovery', () => {
      const failure = classifyRunFailure({
        message: 'Tool result ERROR Bash: ENOENT file not found',
      });

      expect(failure).toMatchObject({
        cause: 'tool_error',
        retryDisposition: 'hitl_required',
        recoveryAction: { type: 'fix_tool_input' },
      });
    });

    it('classifies missing runtime binaries with install guidance', () => {
      for (const message of [
        'spawn codex ENOENT',
        'Codex CLI binary not found on PATH. Install with npm.',
        'command not found: opencode',
      ]) {
        const failure = classifyRunFailure({ message });

        expect(failure).toMatchObject({
          cause: 'missing_binary',
          retryDisposition: 'hitl_required',
          retryable: false,
          recoveryAction: { type: 'install_runtime' },
        });
      }
    });

    it('classifies spawn permission errors without catching read permission prose', () => {
      const failure = classifyRunFailure({
        message: 'spawn /usr/local/bin/codex EACCES',
      });

      expect(failure).toMatchObject({
        cause: 'spawn_permission',
        retryDisposition: 'hitl_required',
        retryable: false,
        recoveryAction: { type: 'fix_spawn_permissions' },
      });

      expect(
        classifyRunFailure({
          message: 'Permission denied: cannot read from disk',
        }).cause,
      ).not.toBe('spawn_permission');
    });

    it('classifies provider model routing mismatches distinctly', () => {
      for (const message of [
        'Model routing mismatch: openrouter cannot serve claude-sonnet here',
        'Provider anthropic does not support model gpt-5',
        'Selected model is not available for this provider',
      ]) {
        const failure = classifyRunFailure({ message });

        expect(failure).toMatchObject({
          cause: 'routing_mismatch',
          retryDisposition: 'hitl_required',
          retryable: false,
          recoveryAction: { type: 'choose_supported_model' },
        });
      }
    });

    it('classifies user cancellation as do-not-retry', () => {
      const failure = classifyRunFailure({
        message: 'Run stopped by user',
      });

      expect(failure).toMatchObject({
        cause: 'cancelled',
        retryDisposition: 'do_not_retry',
        retryable: false,
        recoveryAction: { type: 'none' },
      });
    });

    it('classifies invalid requests as terminal until revised', () => {
      const failure = classifyRunFailure({
        message: 'Invalid request: prompt too large for context length',
      });

      expect(failure).toMatchObject({
        cause: 'invalid_request',
        retryDisposition: 'do_not_retry',
        retryable: false,
        recoveryAction: { type: 'revise_request' },
      });
    });

    it('classifies provider socket/body close failures as safe network retries', () => {
      for (const message of [
        'provider socket closed before response completed',
        'HTTP/2 body closed',
        'upstream disconnected during stream',
        'ECONNRESET while reading upstream response',
      ]) {
        const failure = classifyRunFailure({ message });

        expect(failure).toMatchObject({
          cause: 'network',
          retryDisposition: 'safe_auto_retry',
          retryable: true,
          recoveryAction: { type: 'check_network' },
        });
      }
    });

    it('classifies explicit user interrupts as do-not-retry cancellation', () => {
      const failure = classifyRunFailure({
        message: 'Interrupted by user while streaming',
      });

      expect(failure).toMatchObject({
        cause: 'cancelled',
        retryDisposition: 'do_not_retry',
        retryable: false,
      });
    });

    it('does not classify ordinary prose read/write words as tool failures', () => {
      for (const message of [
        'I will write the file after reviewing it',
        'Permission denied: cannot read from disk',
      ]) {
        const failure = classifyRunFailure({ message });

        expect(failure.cause).not.toBe('tool_error');
      }
    });

    it('classifies unsupported models and fabricated role markers as terminal invalid requests', () => {
      for (const message of [
        'Unsupported model: vela-preview',
        'ACP rejected fabricated role marker in assistant output',
      ]) {
        const failure = classifyRunFailure({ message });

        expect(failure).toMatchObject({
          cause: 'invalid_request',
          retryDisposition: 'do_not_retry',
          retryable: false,
          recoveryAction: { type: 'revise_request' },
        });
      }
    });

    it('keeps tool input validation failures in human-in-the-loop tool recovery', () => {
      const failure = classifyRunFailure({
        message: 'Tool input validation failed: missing required path',
      });

      expect(failure).toMatchObject({
        cause: 'tool_error',
        retryDisposition: 'hitl_required',
        retryable: false,
        recoveryAction: { type: 'fix_tool_input' },
      });
    });

    it('classifies stale profile and hard quota failures as human-in-the-loop', () => {
      const staleProfile = classifyRunFailure({
        message: 'Stale profile token for provider account',
      });
      expect(staleProfile).toMatchObject({
        cause: 'auth',
        retryDisposition: 'hitl_required',
        recoveryAction: { type: 'configure_auth' },
      });

      const quota = classifyRunFailure({
        message: 'Account hard limit reached: insufficient credits',
      });
      expect(quota).toMatchObject({
        cause: 'quota',
        retryDisposition: 'hitl_required',
        recoveryAction: { type: 'wait_or_switch_model' },
      });
    });
  });

  describe('calculateDelay', () => {
    it('applies jitter in 50-100% range', () => {
      const strategy = categorizeError(500);
      const delays: number[] = [];
      for (let i = 0; i < 100; i++) {
        delays.push(calculateDelay(0, strategy));
      }
      // Base delay at attempt 0: min(1000 * 2^0, 32000) = 1000
      // With jitter: 500-1000
      expect(delays.every((d) => d >= 500 && d <= 1000)).toBe(true);
    });

    it('increases exponentially', () => {
      const strategy = categorizeError(500);
      // Attempt 0: base = 1000, jittered = 500-1000
      // Attempt 2: base = 4000, jittered = 2000-4000
      const d0 = calculateDelay(0, strategy);
      const d2 = calculateDelay(2, strategy);
      // Even the max of attempt 0 (1000) should be less than min of attempt 2 (2000)
      expect(d0).toBeLessThanOrEqual(1000);
      expect(d2).toBeGreaterThanOrEqual(2000);
    });

    it('caps at maxDelayMs', () => {
      const strategy = categorizeError(500); // max 32000
      const delay = calculateDelay(20, strategy); // 2^20 would overflow, capped
      expect(delay).toBeLessThanOrEqual(32_000);
    });
  });

  describe('retryWithStrategy', () => {
    it('returns on first success', async () => {
      let callCount = 0;
      const result = await retryWithStrategy(
        async () => {
          callCount++;
          return 'success';
        },
        () => 500,
      );
      expect(result).toBe('success');
      expect(callCount).toBe(1);
    });

    it('retries on retryable error and succeeds', async () => {
      let callCount = 0;
      const result = await retryWithStrategy(
        async () => {
          callCount++;
          if (callCount < 3) throw new Error('server error');
          return 'ok';
        },
        () => 500,
      );
      expect(result).toBe('ok');
      expect(callCount).toBe(3);
    });

    it('throws immediately for non-retryable error (400)', async () => {
      let callCount = 0;
      await expect(
        retryWithStrategy(
          async () => {
            callCount++;
            throw new Error('bad request');
          },
          () => 400,
        ),
      ).rejects.toThrow('bad request');
      expect(callCount).toBe(1);
    });

    it('throws immediately for 401 (no retry)', async () => {
      let callCount = 0;
      await expect(
        retryWithStrategy(
          async () => {
            callCount++;
            throw new Error('auth failed');
          },
          () => 401,
        ),
      ).rejects.toThrow('auth failed');
      // 401: shouldRetry=false, so only 1 call (no retry)
      expect(callCount).toBe(1);
    });

    it('removes the abort listener after a retry delay completes', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(1);
      const controller = new AbortController();
      const addListener = vi.spyOn(controller.signal, 'addEventListener');
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
      let callCount = 0;

      const result = retryWithStrategy(
        async () => {
          callCount++;
          if (callCount === 1) throw new Error('server error');
          return 'ok';
        },
        () => 500,
        controller.signal,
      );

      await vi.advanceTimersByTimeAsync(1000);

      await expect(result).resolves.toBe('ok');
      expect(addListener).toHaveBeenCalledTimes(1);
      expect(removeListener).toHaveBeenCalledTimes(1);
    });
  });
});
