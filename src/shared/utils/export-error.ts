// Shared export/preview failure classification (07-06 Open Design sync,
// upstream 1eb389879). User-facing messages stay specific; these codes give
// recovery UI and local traces a stable, low-cardinality vocabulary. Never
// widen codes with raw exception names, file paths, request ids, or
// model-generated text.
export type ExportErrorCode =
  | 'dependency_missing'
  | 'export_blocked_by_lint'
  | 'attribution_blocked'
  | 'renderer_unavailable'
  | 'snapshot_timeout'
  | 'capture_failed'
  | 'webcodecs_encoder'
  | 'invalid_input'
  | 'network'
  | 'unknown';

export interface ClassifiedExportError {
  code: ExportErrorCode;
  message: string;
  dependency?: string;
  source?: string;
  retryable: boolean;
}

const EXPORT_ERROR_CODES: ReadonlySet<string> = new Set([
  'dependency_missing',
  'export_blocked_by_lint',
  'attribution_blocked',
  'renderer_unavailable',
  'snapshot_timeout',
  'capture_failed',
  'webcodecs_encoder',
  'invalid_input',
  'network',
  'unknown',
] satisfies ExportErrorCode[]);

// Retry is a sensible first recovery action for transient renderer/capture/
// network failures; the rest need a different fix (install a dependency,
// override lint, correct the input).
const RETRYABLE_CODES: ReadonlySet<ExportErrorCode> = new Set([
  'renderer_unavailable',
  'snapshot_timeout',
  'capture_failed',
  'network',
]);

const WEBCODECS_ENCODER_PATTERN =
  /Encoder emitted non-monotonic write|Encoder did not produce an output buffer|^Frame \d+ did not render$/;

function isExportErrorCode(value: unknown): value is ExportErrorCode {
  return typeof value === 'string' && EXPORT_ERROR_CODES.has(value);
}

// Duck-typed to DesignApiError (message + status + data payload) so this
// utility does not depend on the hooks layer.
function apiErrorData(err: unknown): Record<string, unknown> | undefined {
  if (!(err instanceof Error)) return undefined;
  const data = (err as Error & { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return undefined;
  return data as Record<string, unknown>;
}

function classifyFromShape(
  message: string,
  dependency: string | undefined,
): ExportErrorCode {
  if (dependency === 'asset attribution') return 'attribution_blocked';
  if (dependency === 'slides.json') return 'invalid_input';
  if (dependency) return 'dependency_missing';
  if (message.includes('P0 DesignMode lint')) return 'export_blocked_by_lint';
  if (message.includes('Preview snapshot timed out')) return 'snapshot_timeout';
  if (message.includes('Preview frame is not ready')) {
    return 'renderer_unavailable';
  }
  if (message.includes('Preview snapshot image failed')) {
    return 'capture_failed';
  }
  if (/^chunk POST \d+/.test(message)) return 'network';
  if (
    /failed to fetch|networkerror when attempting|load failed/i.test(message)
  ) {
    return 'network';
  }
  if (WEBCODECS_ENCODER_PATTERN.test(message)) return 'webcodecs_encoder';
  if (message.startsWith('Render host input')) return 'invalid_input';
  return 'unknown';
}

export function classifyExportError(err: unknown): ClassifiedExportError {
  const message = err instanceof Error ? err.message : String(err);
  const data = apiErrorData(err);
  const dependency =
    typeof data?.dependency === 'string' ? data.dependency : undefined;
  const source = typeof data?.source === 'string' ? data.source : undefined;
  // A structured code from the API wins over message classification, but only
  // codes in the shared vocabulary — anything else would leak arbitrary
  // strings into the low-cardinality set.
  const code = isExportErrorCode(data?.code)
    ? data.code
    : classifyFromShape(message, dependency);
  return {
    code,
    message,
    ...(dependency !== undefined && { dependency }),
    ...(source !== undefined && { source }),
    retryable: RETRYABLE_CODES.has(code),
  };
}
