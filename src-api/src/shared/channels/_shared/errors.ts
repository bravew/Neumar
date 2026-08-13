export type ProviderErrorClass =
  | 'network_transient'
  | 'rate_limited_429'
  | 'auth_revoked_401'
  | 'provider_5xx'
  | 'format_invalid'
  | 'quota_exhausted'
  | 'not_found'
  | 'unknown';

export interface ProviderError {
  class: ProviderErrorClass;
  provider: string;
  message: string;
  retryable: boolean;
  terminal: boolean;
  status?: number;
  code?: string | number;
  retryAfterMs?: number;
}

export interface ProviderErrorContext {
  provider: string;
  operation?: string;
}

const authCodes = new Set([
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'unauthorized',
  'forbidden',
]);

const rateLimitCodes = new Set([
  'ratelimited',
  'rate_limited',
  'too_many_requests',
]);
const quotaCodes = new Set(['quota_exceeded', 'insufficient_quota']);
const networkCodes = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function getRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === 'object'
    ? (error as Record<string, unknown>)
    : {};
}

function getStatus(error: unknown): number | undefined {
  const record = getRecord(error);
  const response = getRecord(record.response);
  const raw =
    record.status ??
    record.statusCode ??
    record.error_code ??
    response.status ??
    response.statusCode;
  return typeof raw === 'number' ? raw : undefined;
}

function getCode(error: unknown): string | number | undefined {
  const record = getRecord(error);
  const data = getRecord(record.data);
  const raw = record.code ?? record.error ?? data.error;
  return typeof raw === 'string' || typeof raw === 'number' ? raw : undefined;
}

function getRetryAfterMs(error: unknown): number | undefined {
  const record = getRecord(error);
  const parameters = getRecord(record.parameters);
  const retryAfter = record.retryAfter ?? parameters.retry_after;
  if (typeof retryAfter === 'number') return Math.max(0, retryAfter * 1000);
  const response = getRecord(record.response);
  const headers = getRecord(response.headers);
  const header = headers['retry-after'];
  if (typeof header !== 'string') return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : undefined;
}

function getMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  const record = getRecord(error);
  const description = record.description ?? record.message;
  return typeof description === 'string'
    ? description
    : 'Provider request failed';
}

function byStatus(status: number): ProviderErrorClass {
  if (status === 401 || status === 403) return 'auth_revoked_401';
  if (status === 404) return 'not_found';
  if (status === 408) return 'network_transient';
  if (status === 413) return 'quota_exhausted';
  if (status === 429) return 'rate_limited_429';
  if (status >= 500 && status <= 599) return 'provider_5xx';
  return 'format_invalid';
}

function byCode(code: string | number | undefined): ProviderErrorClass | null {
  if (typeof code === 'number') return byStatus(code);
  if (!code) return null;
  if (authCodes.has(code)) return 'auth_revoked_401';
  if (rateLimitCodes.has(code)) return 'rate_limited_429';
  if (quotaCodes.has(code)) return 'quota_exhausted';
  if (networkCodes.has(code)) return 'network_transient';
  return null;
}

function retryable(errorClass: ProviderErrorClass): boolean {
  return (
    errorClass === 'network_transient' ||
    errorClass === 'rate_limited_429' ||
    errorClass === 'provider_5xx'
  );
}

export function classifyProviderError(
  error: unknown,
  context: ProviderErrorContext,
): ProviderError {
  const status = getStatus(error);
  const code = getCode(error);
  const errorClass =
    (status ? byStatus(status) : null) ??
    byCode(code) ??
    (error instanceof TypeError ? 'network_transient' : 'unknown');
  const canRetry = retryable(errorClass);

  return {
    class: errorClass,
    provider: context.provider,
    message: getMessage(error),
    retryable: canRetry,
    terminal: !canRetry,
    status,
    code,
    retryAfterMs: getRetryAfterMs(error),
  };
}

export function providerErrorToPublishClass(
  error: ProviderError,
):
  | 'network_transient'
  | 'rate_limited_429'
  | 'auth_revoked_401'
  | 'provider_5xx'
  | 'format_invalid'
  | 'quota_exhausted' {
  if (error.class === 'not_found' || error.class === 'unknown') {
    return 'provider_5xx';
  }
  return error.class;
}
