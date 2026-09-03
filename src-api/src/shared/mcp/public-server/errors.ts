/**
 * Frozen public error envelope for the inbound Neumar MCP server.
 * HTTP command routes and stdio tool results share this shape.
 */

export const EXTERNAL_MCP_ERROR_CODES = [
  'DAEMON_UNREACHABLE',
  'UNAUTHORIZED',
  'FEATURE_DISABLED',
  'WRITE_DISABLED',
  'RUN_DISABLED',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'AMBIGUOUS_RESULT',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'TIMEOUT',
] as const;

export type ExternalMcpErrorCode = (typeof EXTERNAL_MCP_ERROR_CODES)[number];

export interface ExternalMcpErrorEnvelope {
  code: ExternalMcpErrorCode;
  message: string;
  retryable: boolean;
  requestId?: string;
}

const RETRYABLE_READ_CODES = new Set<ExternalMcpErrorCode>([
  'DAEMON_UNREACHABLE',
  'TIMEOUT',
]);

export function isRetryableReadError(code: ExternalMcpErrorCode): boolean {
  return RETRYABLE_READ_CODES.has(code);
}

export function createErrorEnvelope(
  code: ExternalMcpErrorCode,
  message: string,
  requestId?: string,
): ExternalMcpErrorEnvelope {
  const envelope: ExternalMcpErrorEnvelope = {
    code,
    message,
    retryable: isRetryableReadError(code),
  };
  if (requestId) envelope.requestId = requestId;
  return envelope;
}
