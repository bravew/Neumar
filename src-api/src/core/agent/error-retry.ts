/**
 * Categorized Error Retry
 *
 * Provides intelligent retry strategies based on HTTP status codes,
 * with jittered exponential backoff to prevent thundering herd.
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ErrorRetry');

// ============================================================================
// Types
// ============================================================================

export interface RetryStrategy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  shouldRetry: boolean;
  action: 'backoff' | 'fail';
  failureCause: FailureCause;
  retryDisposition: RetryDisposition;
  recoveryAction: FailureRecoveryAction;
}

export type FailureCause =
  | 'auth'
  | 'quota'
  | 'timeout'
  | 'model_refusal'
  | 'tool_error'
  | 'missing_binary'
  | 'spawn_permission'
  | 'routing_mismatch'
  | 'network'
  | 'invalid_request'
  | 'server'
  | 'cancelled'
  | 'unknown';

export type RetryDisposition =
  | 'safe_auto_retry'
  | 'hitl_required'
  | 'do_not_retry';

export interface FailureRecoveryAction {
  type:
    | 'configure_auth'
    | 'wait_or_switch_model'
    | 'raise_timeout'
    | 'revise_request'
    | 'fix_tool_input'
    | 'install_runtime'
    | 'fix_spawn_permissions'
    | 'choose_supported_model'
    | 'check_network'
    | 'retry_later'
    | 'none'
    | 'inspect_logs';
  label: string;
  hint: string;
}

export interface FailureClassification {
  cause: FailureCause;
  retryDisposition: RetryDisposition;
  recoveryAction: FailureRecoveryAction;
  retryable: boolean;
  reason: string;
  status?: number;
  refusalCategory?: string;
}

export interface RetrySafetyContext {
  attempt: number;
  visibleOutput: boolean;
  toolCall: boolean;
  artifactWrite: boolean;
  liveArtifact: boolean;
  cancelled: boolean;
}

export function shouldAutoRetryRun(
  classification: FailureClassification,
  context: RetrySafetyContext,
): boolean {
  return (
    classification.retryDisposition === 'safe_auto_retry' &&
    context.attempt === 0 &&
    !context.visibleOutput &&
    !context.toolCall &&
    !context.artifactWrite &&
    !context.liveArtifact &&
    !context.cancelled
  );
}

// ============================================================================
// Error Categorization
// ============================================================================

const AUTH_ERROR_RE =
  /\b(api[_ -]?key|auth(?:entication|orization)?|unauthori[sz]ed|forbidden|login|credential|token|missing (?:api[_ -]?)?key|stale profile|expired profile)\b/i;
const QUOTA_ERROR_RE =
  /\b(rate limit|too many requests|quota|credit|billing|budget|usage limit|limit reached|limit exceeded|hard limit|insufficient credits?)\b/i;
const TIMEOUT_ERROR_RE = /\b(timeout|timed out|deadline|etimedout)\b/i;
const MODEL_REFUSAL_RE =
  /\b(refus(?:al|ed)|safety|content policy|policy violation|blocked by policy|sensitive content|frontier_llm|reasoning_extraction)\b/i;
const MISSING_BINARY_RE =
  /\b(?:spawn\s+\S+\s+enoent|enoent\b.*\b(?:executable|binary|command|cli)\b|(?:executable|binary|command|cli)\b.*\b(?:not found|missing)|command not found)\b/i;
const SPAWN_PERMISSION_RE =
  /\b(?:spawn\s+\S+\s+eacces|eacces\b.*\b(?:spawn|execute|executable|permission denied)\b|permission denied\b.*\b(?:spawn|execute|executable|binary|command)\b)\b/i;
const ROUTING_MISMATCH_RE =
  /\b(?:model routing|routing mismatch|provider[^\n.]*does not support[^\n.]*model|model[^\n.]*not available[^\n.]*provider|model[^\n.]*not supported[^\n.]*provider|selected model[^\n.]*not available|configured model[^\n.]*not available|provider\/model mismatch)\b/i;
const TOOL_ERROR_RE =
  /\b(tool(?: call| result| input)?|mcp__|sandbox_run_script|bash|permission request missing|file not found|enoent)\b/i;
const NETWORK_ERROR_RE =
  /\b(network|fetch failed|connection refused|dns|enotfound|eai_again|socket|tls|certificate|proxy|http\/2 body closed|body closed|econnreset|connection reset|socket hang up|upstream disconnect(?:ed)?|stream closed|terminated)\b/i;
const CANCELLED_ERROR_RE =
  /\b(cancell?ed by user|user (?:abort|cancel|interrupt)|interrupted by user|run stopped by user|session stopped by user)\b/i;
const INVALID_REQUEST_RE =
  /\b(bad request|invalid request|malformed|schema|validation|unsupported|unsupported model|unknown model|model not found|context length|prompt too large|fabricated role marker|role marker)\b/i;

const RECOVERY_ACTIONS: Record<FailureCause, FailureRecoveryAction> = {
  auth: {
    type: 'configure_auth',
    label: 'Reconnect or update credentials',
    hint: 'Update the provider credentials, reconnect the account, then retry.',
  },
  quota: {
    type: 'wait_or_switch_model',
    label: 'Wait, raise quota, or switch model',
    hint: 'Wait for the limit window to reset, raise the quota, or choose a different configured model.',
  },
  timeout: {
    type: 'raise_timeout',
    label: 'Retry with a longer timeout',
    hint: 'Retry once with a longer timeout or reduce the request size.',
  },
  model_refusal: {
    type: 'revise_request',
    label: 'Revise the request',
    hint: 'Change the prompt, input media, or constraints before retrying.',
  },
  tool_error: {
    type: 'fix_tool_input',
    label: 'Fix the tool input',
    hint: 'Inspect the failed tool call, correct the path/arguments/permissions, then retry.',
  },
  missing_binary: {
    type: 'install_runtime',
    label: 'Install or configure the runtime',
    hint: 'Install the missing CLI/runtime or set its executable path, then retry.',
  },
  spawn_permission: {
    type: 'fix_spawn_permissions',
    label: 'Fix executable permissions',
    hint: 'Make the runtime executable and accessible from the workspace, then retry.',
  },
  routing_mismatch: {
    type: 'choose_supported_model',
    label: 'Choose a supported model',
    hint: 'Select a model supported by the configured provider/runtime before retrying.',
  },
  network: {
    type: 'check_network',
    label: 'Check network or proxy',
    hint: 'Verify connectivity, proxy, TLS, and endpoint settings before retrying.',
  },
  invalid_request: {
    type: 'revise_request',
    label: 'Fix the request',
    hint: 'Correct the invalid parameters or reduce the prompt/context size before retrying.',
  },
  server: {
    type: 'retry_later',
    label: 'Retry later',
    hint: 'The upstream provider failed transiently; retry with backoff.',
  },
  cancelled: {
    type: 'none',
    label: 'No recovery needed',
    hint: 'The run was stopped by the user.',
  },
  unknown: {
    type: 'inspect_logs',
    label: 'Inspect run diagnostics',
    hint: 'Open the trace/debug details and retry only after identifying the cause.',
  },
};

function classifyStatus(status?: number): FailureCause | null {
  if (!status) return null;
  if (status === 401 || status === 403) return 'auth';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 409 || status === 429) return 'quota';
  if (status === 400 || status === 404 || status === 422)
    return 'invalid_request';
  if (status >= 500 && status < 600) return 'server';
  return null;
}

function retryDispositionForCause(
  cause: FailureCause,
  status?: number,
): RetryDisposition {
  if (cause === 'cancelled' || cause === 'invalid_request') {
    return 'do_not_retry';
  }
  if (
    cause === 'timeout' ||
    cause === 'network' ||
    cause === 'server' ||
    (cause === 'quota' && status === 429)
  ) {
    return 'safe_auto_retry';
  }
  return 'hitl_required';
}

function classifyMessageCause(input: {
  text: string;
  terminalReason?: string;
  refusalCategory?: string;
}): FailureCause {
  if (input.refusalCategory || input.terminalReason === 'refusal') {
    return 'model_refusal';
  }
  if (CANCELLED_ERROR_RE.test(input.text)) return 'cancelled';
  if (AUTH_ERROR_RE.test(input.text)) return 'auth';
  if (QUOTA_ERROR_RE.test(input.text)) return 'quota';
  if (TIMEOUT_ERROR_RE.test(input.text)) return 'timeout';
  if (MODEL_REFUSAL_RE.test(input.text)) return 'model_refusal';
  if (MISSING_BINARY_RE.test(input.text)) return 'missing_binary';
  if (SPAWN_PERMISSION_RE.test(input.text)) return 'spawn_permission';
  if (ROUTING_MISMATCH_RE.test(input.text)) return 'routing_mismatch';
  if (TOOL_ERROR_RE.test(input.text)) return 'tool_error';
  if (INVALID_REQUEST_RE.test(input.text)) return 'invalid_request';
  if (NETWORK_ERROR_RE.test(input.text)) return 'network';
  return 'unknown';
}

export function classifyRunFailure(input: {
  status?: number;
  message?: string;
  code?: string;
  terminalReason?: string;
  refusalCategory?: string | null;
}): FailureClassification {
  const text = [input.code, input.terminalReason, input.message]
    .filter(Boolean)
    .join(' ');
  const statusCause = classifyStatus(input.status);
  const refusalCategory = input.refusalCategory ?? undefined;
  const cause: FailureCause =
    statusCause ??
    classifyMessageCause({
      text,
      terminalReason: input.terminalReason,
      refusalCategory,
    });
  const retryDisposition = retryDispositionForCause(cause, input.status);

  return {
    cause,
    retryDisposition,
    retryable: retryDisposition === 'safe_auto_retry',
    recoveryAction: RECOVERY_ACTIONS[cause],
    reason: statusCause
      ? `http_status_${input.status}`
      : cause === 'unknown'
        ? 'no_pattern_match'
        : 'message_pattern_match',
    ...(input.status ? { status: input.status } : {}),
    ...(refusalCategory ? { refusalCategory } : {}),
  };
}

function withClassification(
  strategy: Omit<
    RetryStrategy,
    'failureCause' | 'retryDisposition' | 'recoveryAction'
  >,
  classification: FailureClassification,
): RetryStrategy {
  return {
    ...strategy,
    shouldRetry:
      strategy.shouldRetry &&
      classification.retryDisposition === 'safe_auto_retry',
    failureCause: classification.cause,
    retryDisposition: classification.retryDisposition,
    recoveryAction: classification.recoveryAction,
  };
}

/**
 * Map HTTP status codes to appropriate retry strategies.
 *
 * - 429 (rate limit): aggressive retry with long backoff
 * - 401 (auth): no retry — fail immediately (no token refresh wired)
 * - 500/502/503 (server): moderate retry with standard backoff
 * - 400 (bad request): no retry — request itself is invalid
 * - default: conservative budget, but auto-retry only for safe classified causes
 */
export function categorizeError(
  status: number,
  errorBody?: string,
): RetryStrategy {
  const classification = classifyRunFailure({
    status,
    message: errorBody,
  });
  switch (status) {
    case 429:
      return withClassification(
        {
          maxRetries: 5,
          initialDelayMs: 2000,
          maxDelayMs: 60_000,
          shouldRetry: true,
          action: 'backoff',
        },
        classification,
      );
    case 401:
    case 403:
      return withClassification(
        {
          maxRetries: 0,
          initialDelayMs: 0,
          maxDelayMs: 0,
          shouldRetry: false,
          action: 'fail',
        },
        classification,
      );
    case 500:
    case 502:
    case 503:
    case 504:
      return withClassification(
        {
          maxRetries: 3,
          initialDelayMs: 1000,
          maxDelayMs: 32_000,
          shouldRetry: true,
          action: 'backoff',
        },
        classification,
      );
    case 400:
    case 404:
    case 422:
      return withClassification(
        {
          maxRetries: 0,
          initialDelayMs: 0,
          maxDelayMs: 0,
          shouldRetry: false,
          action: 'fail',
        },
        classification,
      );
    default:
      return withClassification(
        {
          maxRetries: 2,
          initialDelayMs: 1000,
          maxDelayMs: 16_000,
          shouldRetry: true,
          action: 'backoff',
        },
        classification,
      );
  }
}

// ============================================================================
// Delay Calculation
// ============================================================================

/**
 * Calculate retry delay with jittered exponential backoff.
 * Formula: min(initial * 2^attempt, max) * (0.5 + random * 0.5)
 * Jitter range: 50-100% of the base delay — prevents thundering herd.
 */
export function calculateDelay(
  attempt: number,
  strategy: RetryStrategy,
): number {
  const baseDelay = Math.min(
    strategy.initialDelayMs * Math.pow(2, attempt),
    strategy.maxDelayMs,
  );
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.round(baseDelay * jitter);
}

// ============================================================================
// Retry Wrapper
// ============================================================================

/**
 * Generic retry wrapper using categorizeError + calculateDelay.
 * Logs each attempt and throws the original error after exhausting retries.
 * Accepts an optional AbortSignal to cancel pending retries when the session
 * is torn down — prevents retries firing after the caller has moved on.
 */
export async function retryWithStrategy<T>(
  fn: () => Promise<T>,
  getStatus: (error: unknown) => number,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (signal?.aborted) {
        throw error;
      }

      const status = getStatus(error);
      const errorBody = error instanceof Error ? error.message : String(error);
      const strategy = categorizeError(status, errorBody);

      if (!strategy.shouldRetry || attempt >= strategy.maxRetries) {
        throw error;
      }

      const delay = calculateDelay(attempt, strategy);
      logger.warn(
        `Retry attempt ${attempt + 1}/${strategy.maxRetries} for status ${status} ` +
          `(action=${strategy.action}, delay=${delay}ms)`,
      );

      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const onAbort = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(signal?.reason ?? new Error('Retry aborted'));
        };
        timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, delay);
        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        }
      });
    }
  }

  // Unreachable, but satisfies TypeScript
  throw lastError;
}
