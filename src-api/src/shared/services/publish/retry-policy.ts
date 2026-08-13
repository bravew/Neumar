import {
  classifyProviderError,
  providerErrorToPublishClass,
} from '@/shared/channels/_shared/errors';

export type PublishErrorClass =
  | 'network_transient'
  | 'rate_limited_429'
  | 'auth_revoked_401'
  | 'provider_5xx'
  | 'format_invalid'
  | 'quota_exhausted'
  | 'reformat_failed'
  | 'stall'
  | 'lifetime_exceeded';

export interface ClassifiedPublishError {
  class: PublishErrorClass;
  retryAfterMs?: number;
  terminal?: boolean;
}

export interface RetryOptions {
  classifier: (error: unknown) => ClassifiedPublishError;
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
}

const terminalClasses = new Set<PublishErrorClass>([
  'auth_revoked_401',
  'format_invalid',
  'reformat_failed',
  'lifetime_exceeded',
]);

export interface RetrySpec {
  maxAttempts?: number;
  backoffMs?: number[];
  respectRetryAfter?: boolean;
  fallbackMs?: number;
  jitterMs?: number;
  terminal?: boolean;
  deferToWindowRoll?: boolean;
  surface?: 'reconnect' | 're-export' | 'check-source';
}

export const RETRY_POLICY: Record<PublishErrorClass, RetrySpec> = {
  network_transient: {
    maxAttempts: 5,
    backoffMs: [1000, 2000, 4000, 8000, 16000],
  },
  rate_limited_429: {
    respectRetryAfter: true,
    fallbackMs: 30000,
    jitterMs: 5000,
  },
  auth_revoked_401: { terminal: true, surface: 'reconnect' },
  quota_exhausted: { deferToWindowRoll: true },
  format_invalid: { terminal: true, surface: 're-export' },
  provider_5xx: {
    maxAttempts: 5,
    backoffMs: [2000, 5000, 10000, 20000, 40000],
  },
  reformat_failed: { terminal: true, surface: 'check-source' },
  stall: { maxAttempts: 3, backoffMs: [5000, 30000, 120000] },
  lifetime_exceeded: { terminal: true },
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const sleep =
    options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const jitter = options.jitter ?? Math.random;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      const classified = options.classifier(error);
      const terminal =
        classified.terminal ?? terminalClasses.has(classified.class);
      if (terminal || attempt >= maxAttempts) {
        throw error;
      }

      const backoff =
        classified.retryAfterMs ??
        Math.round(baseDelayMs * 2 ** (attempt - 1) * (1 + jitter() * 0.2));
      await sleep(backoff);
    }
  }
}

export function classifyHttpStatus(
  status: number,
  retryAfterHeader?: string | null,
): ClassifiedPublishError {
  if (status === 401 || status === 403) return { class: 'auth_revoked_401' };
  if (status === 408) return { class: 'network_transient' };
  if (status === 409 || status === 400 || status === 415) {
    return { class: 'format_invalid' };
  }
  if (status === 429) {
    return {
      class: 'rate_limited_429',
      retryAfterMs: parseRetryAfterMs(retryAfterHeader),
    };
  }
  if (status >= 500 && status <= 599) return { class: 'provider_5xx' };
  return { class: 'format_invalid' };
}

export function classifyPublishError(error: unknown): ClassifiedPublishError {
  const providerError = classifyProviderError(error, { provider: 'publish' });
  return {
    class: providerErrorToPublishClass(providerError),
    retryAfterMs: providerError.retryAfterMs,
    terminal: providerError.terminal,
  };
}

export function parseRetryAfterMs(value?: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}
