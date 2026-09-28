/**
 * Claude Agent SDK stream signals (SDK 0.3.240–0.3.283).
 *
 * Maps SDK stream fields the message switch in `index.ts` did not consume
 * into structured `AgentMessage`s, and owns the result-cost bookkeeping:
 *
 * - `system/informational`            → notice rows
 * - `rate_limit_event`, `api_retry`   → rate-limit / retry countdown
 * - `system/init.plugin_errors`       → plugin health store + notice
 * - `conversation_reset`,
 *   `system/session_state_changed`    → task status
 * - `tool_use_result.resourceLinks`,
 *   `task_notification.resource_links`→ returned files (artifacts)
 * - `result.startup_failure_reason`   → actionable error
 * - `result` telemetry: per-message-ID usage dedupe, `modelUsage`
 *   thinking tokens / cost basis, `result_index`, `queued_turn_count`, and
 *   cost continuity after resume (a resumed session's `total_cost_usd`
 *   includes spend restored from its transcript — log only the delta).
 *
 * See https://code.claude.com/docs/en/agent-sdk/cost-tracking.
 */

import type {
  AgentMessage,
  AgentResourceLink,
  AgentStreamSignal,
} from '@/core/agent/types';

import { getDatabase } from '@/shared/db';
import { recordClaudePluginErrors } from '@/shared/plugins/claude-plugin-health';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ClaudeStreamSignals');

/**
 * Env the SDK needs to emit the opt-in signals mapped here. Spread into the
 * query env.
 */
export const CLAUDE_STREAM_SIGNAL_ENV: Readonly<Record<string, string>> = {
  CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1',
};

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function signalMessage(
  streamSignal: AgentStreamSignal,
  content: string,
  isProgress = true,
): AgentMessage {
  return {
    type: 'system',
    subtype: streamSignal.kind,
    content,
    streamSignal,
    isProgress,
  };
}

const NOTICE_LEVELS = new Set(['info', 'notice', 'suggestion', 'warning']);
const SESSION_STATES = new Set(['idle', 'running', 'requires_action']);
const RATE_LIMIT_STATUSES = new Set(['allowed', 'allowed_warning', 'rejected']);
/** Mirrors the SDK cap on returned links per tool result. */
const MAX_RESOURCE_LINKS = 50;

export function parseResourceLinks(value: unknown): AgentResourceLink[] {
  if (!Array.isArray(value)) return [];
  const links: AgentResourceLink[] = [];
  for (const item of value.slice(0, MAX_RESOURCE_LINKS)) {
    if (!isRecord(item)) continue;
    const uri = str(item.uri);
    const name = str(item.name);
    if (!uri || !name) continue;
    links.push({
      uri,
      name,
      ...(str(item.title) ? { title: str(item.title) } : {}),
      ...(str(item.description) ? { description: str(item.description) } : {}),
      ...(str(item.mimeType) ? { mimeType: str(item.mimeType) } : {}),
      ...(num(item.size) !== undefined ? { size: num(item.size) } : {}),
    });
  }
  return links;
}

function mapRateLimit(msg: Raw): AgentMessage[] {
  const info = msg.rate_limit_info;
  if (!isRecord(info)) return [];
  const status = str(info.status);
  if (!status || !RATE_LIMIT_STATUSES.has(status) || status === 'allowed') {
    return [];
  }
  const resetsAtSec = num(info.resetsAt);
  const utilization = num(info.utilization);
  const signal: AgentStreamSignal = {
    kind: 'rate_limit',
    status: status as 'allowed_warning' | 'rejected',
    ...(resetsAtSec !== undefined ? { resetsAt: resetsAtSec * 1000 } : {}),
    ...(utilization !== undefined ? { utilization } : {}),
    ...(str(info.rateLimitType)
      ? { rateLimitType: str(info.rateLimitType) }
      : {}),
  };
  const content =
    status === 'rejected'
      ? `Rate limited — resets at ${resetsAtSec !== undefined ? new Date(resetsAtSec * 1000).toISOString() : 'unknown'}`
      : `Approaching rate limit (${Math.round((utilization ?? 0) * 100)}% used)`;
  return [signalMessage(signal, content)];
}

function mapSystem(msg: Raw): AgentMessage[] {
  switch (msg.subtype) {
    case 'informational': {
      const content = str(msg.content);
      const level = str(msg.level) ?? 'info';
      if (!content || !NOTICE_LEVELS.has(level)) return [];
      return [
        signalMessage(
          {
            kind: 'notice',
            level: level as 'info' | 'notice' | 'suggestion' | 'warning',
            content,
            ...(msg.prevent_continuation === true
              ? { preventContinuation: true }
              : {}),
          },
          content,
          // Transcript-only info lines stay out of conversation history.
          level === 'info',
        ),
      ];
    }
    case 'api_retry': {
      const attempt = num(msg.attempt) ?? 1;
      const maxRetries = num(msg.max_retries) ?? attempt;
      const retryDelayMs = num(msg.retry_delay_ms) ?? 0;
      const errorStatus = num(msg.error_status) ?? null;
      const error = str(msg.error) ?? 'unknown';
      return [
        signalMessage(
          {
            kind: 'api_retry',
            attempt,
            maxRetries,
            retryDelayMs,
            errorStatus,
            error,
          },
          `API request failed (${errorStatus ?? error}) — retry ${attempt}/${maxRetries} in ${Math.ceil(retryDelayMs / 1000)}s`,
        ),
      ];
    }
    case 'init': {
      const raw = Array.isArray(msg.plugin_errors) ? msg.plugin_errors : [];
      const errors = raw.filter(isRecord).map((e) => ({
        plugin: str(e.plugin) ?? 'unknown',
        type: str(e.type) ?? 'generic-error',
        message: str(e.message) ?? '',
      }));
      // The key is omitted when there are no errors. (Remote Control workers
      // also omit it, but this adapter only runs local sessions.)
      recordClaudePluginErrors(errors);
      if (errors.length === 0) return [];
      logger.warn(
        `Claude plugin load errors: ${errors.map((e) => `${e.plugin} (${e.type})`).join(', ')}`,
      );
      return [
        signalMessage(
          { kind: 'plugin_errors', errors },
          `${errors.length} plugin(s) failed to load`,
        ),
      ];
    }
    case 'session_state_changed': {
      const state = str(msg.state);
      if (!state || !SESSION_STATES.has(state)) return [];
      return [
        signalMessage(
          {
            kind: 'session_state',
            state: state as 'idle' | 'running' | 'requires_action',
          },
          `Session ${state}`,
        ),
      ];
    }
    case 'task_notification': {
      // Backgrounded MCP task: its files arrive here, not on the tool result.
      const links = parseResourceLinks(msg.resource_links);
      if (links.length === 0) return [];
      return [
        signalMessage(
          {
            kind: 'resource_links',
            toolUseId: str(msg.tool_use_id),
            links,
          },
          `${links.length} file(s) returned`,
        ),
      ];
    }
    default:
      return [];
  }
}

function mapUser(msg: Raw): AgentMessage[] {
  const result = msg.tool_use_result;
  if (!isRecord(result)) return [];
  const links = parseResourceLinks(result.resourceLinks);
  if (links.length === 0) return [];
  // The CLI emits one user message per tool result; take its id from the
  // block so the UI can attach the files to the originating call.
  const content = isRecord(msg.message) ? msg.message.content : undefined;
  const block = Array.isArray(content)
    ? content.find((b) => isRecord(b) && b.type === 'tool_result')
    : undefined;
  const toolUseId = isRecord(block) ? str(block.tool_use_id) : undefined;
  return [
    signalMessage(
      { kind: 'resource_links', ...(toolUseId ? { toolUseId } : {}), links },
      `${links.length} file(s) returned`,
    ),
  ];
}

/**
 * Actionable remediation for each known `startup_failure_reason`. Unknown
 * values (the set is open) fall back to the SDK's own error text.
 */
const STARTUP_FAILURE_ACTIONS: Record<string, string> = {
  org_pin_api_key_conflict:
    'The configured API key belongs to a different organization than the one this install is pinned to. Update the API key in Settings → Models or remove the organization pin.',
  org_verify_failed:
    'Claude could not verify your organization. Check your network connection and sign in again.',
  org_pin_mismatch:
    'Your account does not match the organization this install is pinned to. Sign in with the correct account.',
  managed_settings_invalid:
    'Managed settings are invalid. Ask your administrator to fix the managed settings file.',
  remote_settings_required_unavailable:
    'Required remote settings could not be loaded. Check your network connection and try again.',
  gateway_signin_required:
    'Your gateway requires sign-in. Sign in to the gateway and try again.',
  gateway_access_denied:
    'The gateway denied access. Ask your administrator for access or switch provider.',
  proxy_invalid:
    'The proxy configuration is invalid. Fix HTTPS_PROXY / HTTP_PROXY and try again.',
  temp_dir_unusable:
    'The temporary directory is not writable. Check TMPDIR permissions and free disk space.',
  cwd_unavailable:
    'The task working directory is missing or not accessible. Choose another folder for this task.',
  shell_tool_missing:
    'No usable shell was found. Install bash (or Git Bash on Windows) and restart the app.',
  session_held_by_background:
    'This session is still held by a background process. Wait for it to finish or start a new conversation.',
  worktree_resume_refused:
    'This session was started in a different worktree and cannot resume here. Start a new conversation.',
  worktree_unverified:
    'The session worktree could not be verified. Start a new conversation.',
  cli_version_too_old:
    'The bundled Claude Code CLI is too old for this setting. Update the app.',
  bypass_root:
    'Bypass-permissions mode cannot run as root. Run the app as a regular user or pick another permission mode.',
};

function mapStartupFailure(msg: Raw): AgentMessage[] {
  const reason = str(msg.startup_failure_reason);
  if (!reason) return [];
  const errors = Array.isArray(msg.errors)
    ? msg.errors.filter((e): e is string => typeof e === 'string')
    : [];
  const message =
    STARTUP_FAILURE_ACTIONS[reason] ??
    errors[0] ??
    `Claude failed to start (${reason}).`;
  logger.warn(`Claude startup failure: ${reason}`);
  return [
    {
      type: 'error',
      subtype: 'startup_failure',
      code: reason,
      message,
    },
  ];
}

/**
 * Pure mapper from one raw SDK message to the extra `AgentMessage`s it
 * carries. Returns `[]` for anything it does not recognise. The message
 * switch keeps handling the base message itself.
 */
export function mapClaudeStreamSignals(message: unknown): AgentMessage[] {
  if (!isRecord(message)) return [];
  switch (message.type) {
    case 'rate_limit_event':
      return mapRateLimit(message);
    case 'system':
      return mapSystem(message);
    case 'conversation_reset': {
      const id = str(message.new_conversation_id);
      if (!id) return [];
      const trigger = str(message.trigger);
      return [
        signalMessage(
          {
            kind: 'conversation_reset',
            newConversationId: id,
            ...(trigger ? { trigger } : {}),
          },
          'Conversation reset',
          false,
        ),
      ];
    }
    case 'user':
      return mapUser(message);
    case 'result':
      return mapStartupFailure(message);
    default:
      return [];
  }
}

// ── Usage / cost telemetry ──────────────────────────────────────────────────

interface StepUsage {
  seenMessageIds: Set<string>;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** Keyed by the adapter's run session id; released when its result settles. */
const stepUsageBySession = new Map<string, StepUsage>();

/** Last cumulative SDK cost seen per SDK session id (bounded, LRU-ish). */
const cumulativeCostBySdkSession = new Map<string, number>();
const MAX_TRACKED_SDK_SESSIONS = 500;

function rememberCumulativeCost(sdkSessionId: string, cost: number): void {
  cumulativeCostBySdkSession.delete(sdkSessionId);
  cumulativeCostBySdkSession.set(sdkSessionId, cost);
  if (cumulativeCostBySdkSession.size > MAX_TRACKED_SDK_SESSIONS) {
    const oldest = cumulativeCostBySdkSession.keys().next().value;
    if (oldest !== undefined) cumulativeCostBySdkSession.delete(oldest);
  }
}

/**
 * Accumulate main-loop per-step usage, counting each API response once:
 * parallel tool calls stream several assistant messages that share
 * `message.id` and identical usage.
 */
export function observeClaudeStepUsage(
  sessionId: string,
  message: unknown,
): void {
  if (!isRecord(message) || message.type !== 'assistant') return;
  if (message.parent_tool_use_id) return; // subagent step
  const inner = message.message;
  if (!isRecord(inner)) return;
  const id = str(inner.id);
  if (!id) return;
  let entry = stepUsageBySession.get(sessionId);
  if (!entry) {
    entry = {
      seenMessageIds: new Set(),
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    stepUsageBySession.set(sessionId, entry);
  }
  if (entry.seenMessageIds.has(id)) return;
  entry.seenMessageIds.add(id);
  const usage = isRecord(inner.usage) ? inner.usage : {};
  entry.inputTokens += num(usage.input_tokens) ?? 0;
  entry.cacheReadTokens += num(usage.cache_read_input_tokens) ?? 0;
  entry.cacheCreationTokens += num(usage.cache_creation_input_tokens) ?? 0;
}

/**
 * Last cumulative cost logged for an SDK session by an earlier process, so a
 * resume after an app restart still subtracts the restored spend.
 */
export function lookupPersistedCumulativeCost(
  sdkSessionId: string,
  taskId?: string,
): number | undefined {
  try {
    // `created_at` is second-resolution, so several results in one run can
    // tie. `rowid` is the insert order. A zero cumulative is never a usable
    // baseline (including a crashed turn that persisted 0), so those rows
    // are skipped and the previous positive total is used instead.
    // `task_id` is indexed and narrows the JSON scan when the run has one.
    const scoped = taskId != null && taskId !== '';
    const row = getDatabase()
      .prepare(
        `SELECT json_extract(metadata, '$.sdk_cumulative_cost_usd') AS cost
           FROM usage_logs
          WHERE call_type = 'agent'
            ${scoped ? 'AND task_id = ?' : ''}
            AND json_extract(metadata, '$.sdk_session_id') = ?
            AND CAST(json_extract(metadata, '$.sdk_cumulative_cost_usd') AS REAL) > 0
          ORDER BY rowid DESC
          LIMIT 1`,
      )
      .get(...(scoped ? [taskId, sdkSessionId] : [sdkSessionId])) as
      | { cost?: unknown }
      | undefined;
    return num(row?.cost);
  } catch (err) {
    logger.debug('Cumulative cost lookup failed', err);
    return undefined;
  }
}

export interface ModelUsageSummary {
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cost_basis?: string;
}

export interface ClaudeResultTelemetry {
  /** Spend attributable to this query() call — log this, not the cumulative. */
  billableCostUsd: number | undefined;
  /** The SDK's running total (includes spend restored on resume). */
  cumulativeCostUsd: number | undefined;
  /** Main-loop input tokens; falls back to deduped steps on a zeroed crash result. */
  inputTokens: number | undefined;
  cacheReadTokens: number | undefined;
  cacheCreationTokens: number | undefined;
  resultIndex: number | undefined;
  queuedTurnCount: number | undefined;
  /** Extra `usage_logs.metadata` keys. */
  metadata: Record<string, unknown>;
}

function summarizeModelUsage(value: unknown): {
  models: Record<string, ModelUsageSummary>;
  thinkingTokens: number | undefined;
} {
  const models: Record<string, ModelUsageSummary> = {};
  let thinkingTokens: number | undefined;
  if (!isRecord(value)) return { models, thinkingTokens };
  for (const [model, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const thinking = num(raw.thinkingTokens);
    if (thinking !== undefined)
      thinkingTokens = (thinkingTokens ?? 0) + thinking;
    models[model] = {
      cost_usd: num(raw.costUSD),
      input_tokens: num(raw.inputTokens),
      output_tokens: num(raw.outputTokens),
      ...(thinking !== undefined ? { thinking_tokens: thinking } : {}),
      // Absent (e.g. right after --resume) means list price.
      cost_basis: str(raw.costBasis) ?? 'list',
    };
  }
  return { models, thinkingTokens };
}

/**
 * Settle a `result` message: compute the billable delta, read the new
 * telemetry fields, and release the run's step-usage state.
 */
export function settleClaudeResultUsage(
  sessionId: string,
  message: unknown,
  lookupPersisted: (
    sdkSessionId: string,
    taskId?: string,
  ) => number | undefined = lookupPersistedCumulativeCost,
  taskId?: string,
): ClaudeResultTelemetry {
  const steps = stepUsageBySession.get(sessionId);
  stepUsageBySession.delete(sessionId);
  const msg = isRecord(message) ? message : {};
  const usage = isRecord(msg.usage) ? msg.usage : undefined;
  const cumulative = num(msg.total_cost_usd);
  const sdkSessionId = str(msg.session_id);
  const zeroedError =
    msg.subtype !== 'success' &&
    (cumulative ?? 0) === 0 &&
    (num(usage?.input_tokens) ?? 0) === 0;

  let billable = cumulative;
  if (cumulative !== undefined && sdkSessionId) {
    const baseline =
      cumulativeCostBySdkSession.get(sdkSessionId) ??
      lookupPersisted(sdkSessionId, taskId) ??
      0;
    // A total below the baseline means the SDK started over (no transcript
    // totals restored) — the whole total is this call's own spend.
    billable = cumulative >= baseline ? cumulative - baseline : cumulative;
    // A zeroed crash result must not reset the baseline, or the next resume
    // (which restores the transcript total) would be logged twice.
    if (!zeroedError) rememberCumulativeCost(sdkSessionId, cumulative);
  }

  const { models, thinkingTokens } = summarizeModelUsage(msg.modelUsage);
  const resultIndex = num(msg.result_index);
  const queuedTurnCount = num(msg.queued_turn_count);
  const useSteps = zeroedError && steps && steps.seenMessageIds.size > 0;

  return {
    billableCostUsd: billable,
    cumulativeCostUsd: cumulative,
    inputTokens: useSteps ? steps.inputTokens : num(usage?.input_tokens),
    cacheReadTokens: useSteps
      ? steps.cacheReadTokens
      : num(usage?.cache_read_input_tokens),
    cacheCreationTokens: useSteps
      ? steps.cacheCreationTokens
      : num(usage?.cache_creation_input_tokens),
    resultIndex,
    queuedTurnCount,
    metadata: {
      // A zeroed crash result must not become the persisted baseline. After a
      // restart the lookup reads the newest row; a stored 0 would re-bill the
      // restored transcript on the next resume.
      ...(sdkSessionId && !zeroedError ? { sdk_session_id: sdkSessionId } : {}),
      ...(cumulative !== undefined && !zeroedError
        ? { sdk_cumulative_cost_usd: cumulative }
        : {}),
      ...(steps ? { api_steps: steps.seenMessageIds.size } : {}),
      ...(Object.keys(models).length > 0 ? { model_usage: models } : {}),
      ...(thinkingTokens !== undefined
        ? { model_thinking_tokens: thinkingTokens }
        : {}),
      ...(resultIndex !== undefined ? { result_index: resultIndex } : {}),
      ...(queuedTurnCount !== undefined
        ? { queued_turn_count: queuedTurnCount }
        : {}),
      ...(useSteps ? { usage_source: 'deduped_steps' } : {}),
    },
  };
}

/** Test hook: clear module state between cases. */
export function resetClaudeStreamSignalState(): void {
  stepUsageBySession.clear();
  cumulativeCostBySdkSession.clear();
}
