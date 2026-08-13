export type CloudStorageErrorCode =
  | 'auth_revoked'
  | 'missing_scope'
  | 'permission_denied'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'transient_upstream'
  | 'unsupported'
  | 'feature_disabled'
  | 'site_unreachable';

const STATUS_BY_CODE: Record<CloudStorageErrorCode, number> = {
  auth_revoked: 401,
  missing_scope: 403,
  permission_denied: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  transient_upstream: 502,
  unsupported: 501,
  feature_disabled: 404,
  site_unreachable: 503,
};

export interface CloudStorageErrorPayload {
  error: CloudStorageErrorCode;
  message: string;
  status: number;
  retryAfterMs?: number;
  details?: unknown;
}

export class CloudStorageError extends Error {
  readonly code: CloudStorageErrorCode;
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly details?: unknown;

  constructor(
    code: CloudStorageErrorCode,
    message?: string,
    options?: { status?: number; retryAfterMs?: number; details?: unknown },
  ) {
    super(message ?? code);
    this.name = 'CloudStorageError';
    this.code = code;
    this.status = options?.status ?? STATUS_BY_CODE[code];
    this.retryAfterMs = options?.retryAfterMs;
    this.details = options?.details;
  }

  toJSON(): CloudStorageErrorPayload {
    return {
      error: this.code,
      message: this.message,
      status: this.status,
      retryAfterMs: this.retryAfterMs,
      details: this.details,
    };
  }
}

export function isCloudStorageError(
  error: unknown,
): error is CloudStorageError {
  return error instanceof CloudStorageError;
}

export function errorCodeFromStatus(status: number): CloudStorageErrorCode {
  if (status === 401) return 'auth_revoked';
  if (status === 403) return 'permission_denied';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'transient_upstream';
  return 'transient_upstream';
}

export function normalizeErrorCode(value: unknown): CloudStorageErrorCode {
  const known: CloudStorageErrorCode[] = [
    'auth_revoked',
    'missing_scope',
    'permission_denied',
    'not_found',
    'conflict',
    'rate_limited',
    'transient_upstream',
    'unsupported',
    'feature_disabled',
    'site_unreachable',
  ];
  return typeof value === 'string' &&
    known.includes(value as CloudStorageErrorCode)
    ? (value as CloudStorageErrorCode)
    : 'transient_upstream';
}
