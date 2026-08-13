import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ConnectorErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'CONNECTOR_NOT_FOUND'
  | 'CONNECTOR_NOT_CONFIGURED'
  | 'CONNECTOR_NOT_CONNECTED'
  | 'CONNECTOR_AUTH_EXPIRED'
  | 'CONNECTOR_DISABLED'
  | 'CONNECTOR_TOOL_NOT_FOUND'
  | 'CONNECTOR_SAFETY_DENIED'
  | 'CONNECTOR_INPUT_SCHEMA_MISMATCH'
  | 'CONNECTOR_RATE_LIMITED'
  | 'CONNECTOR_OUTPUT_TOO_LARGE'
  | 'CONNECTOR_EXECUTION_FAILED';

export class ConnectorServiceError extends Error {
  readonly code: ConnectorErrorCode;
  readonly status: ContentfulStatusCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ConnectorErrorCode,
    message: string,
    options: {
      status?: ContentfulStatusCode;
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ConnectorServiceError';
    this.code = code;
    this.status = options.status ?? defaultStatusForCode(code);
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function mapComposioHttpError(
  status: number,
  body: unknown,
): ConnectorServiceError {
  const message = extractComposioErrorMessage(body);
  if (status === 401 || status === 403) {
    return new ConnectorServiceError(
      'FORBIDDEN',
      message ?? 'Composio rejected the configured API key.',
      { status: 403, details: { upstreamStatus: status } },
    );
  }
  if (status === 404) {
    return new ConnectorServiceError(
      'CONNECTOR_NOT_FOUND',
      message ?? 'Composio resource was not found.',
      { status: 404, details: { upstreamStatus: status } },
    );
  }
  if (status === 429) {
    return new ConnectorServiceError(
      'CONNECTOR_RATE_LIMITED',
      message ?? 'Composio rate limit exceeded.',
      { status: 429, retryable: true, details: { upstreamStatus: status } },
    );
  }
  if (status >= 400 && status < 500) {
    return new ConnectorServiceError(
      'BAD_REQUEST',
      message ?? 'Composio rejected the connector request.',
      { status: 400, details: { upstreamStatus: status } },
    );
  }
  return new ConnectorServiceError(
    'CONNECTOR_EXECUTION_FAILED',
    message ?? 'Composio request failed.',
    {
      status: 502,
      retryable: status >= 500,
      details: { upstreamStatus: status },
    },
  );
}

function defaultStatusForCode(code: ConnectorErrorCode): ContentfulStatusCode {
  switch (code) {
    case 'BAD_REQUEST':
    case 'VALIDATION_FAILED':
    case 'CONNECTOR_INPUT_SCHEMA_MISMATCH':
      return 400;
    case 'FORBIDDEN':
    case 'CONNECTOR_DISABLED':
    case 'CONNECTOR_SAFETY_DENIED':
      return 403;
    case 'CONNECTOR_NOT_FOUND':
    case 'CONNECTOR_TOOL_NOT_FOUND':
      return 404;
    case 'CONNECTOR_NOT_CONFIGURED':
    case 'CONNECTOR_NOT_CONNECTED':
    case 'CONNECTOR_AUTH_EXPIRED':
      return 412;
    case 'CONNECTOR_RATE_LIMITED':
      return 429;
    case 'CONNECTOR_OUTPUT_TOO_LARGE':
    case 'CONNECTOR_EXECUTION_FAILED':
      return 502;
  }
}

function extractComposioErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  const message = record.message;
  return typeof message === 'string' ? message : undefined;
}

const AUTH_STALE_RE =
  /\b(?:bad credentials|credential(?:s)? expired|token expired|access token expired|invalid token|invalid_grant|reauth(?:orize)?|reconnect|connection expired|unauthorized)\b/i;
const MAX_AUTH_STALE_SCAN_DEPTH = 4;
const MAX_AUTH_STALE_SCAN_ITEMS = 50;

export function boundedJsonValueIncludesAuthStaleSignal(
  value: unknown,
): boolean {
  return scanAuthStaleSignal(value, 0, { seen: 0 });
}

export function isConnectorAuthStaleError(error: unknown): boolean {
  if (!(error instanceof ConnectorServiceError)) return false;
  if (boundedJsonValueIncludesAuthStaleSignal(error.message)) return true;
  if (boundedJsonValueIncludesAuthStaleSignal(error.details)) return true;
  return false;
}

function scanAuthStaleSignal(
  value: unknown,
  depth: number,
  state: { seen: number },
): boolean {
  if (state.seen >= MAX_AUTH_STALE_SCAN_ITEMS) return false;
  state.seen += 1;
  if (typeof value === 'string') return AUTH_STALE_RE.test(value);
  if (
    value === null ||
    typeof value !== 'object' ||
    depth >= MAX_AUTH_STALE_SCAN_DEPTH
  ) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => scanAuthStaleSignal(item, depth + 1, state));
  }
  return Object.values(value as Record<string, unknown>).some((item) =>
    scanAuthStaleSignal(item, depth + 1, state),
  );
}
