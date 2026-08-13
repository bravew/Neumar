/**
 * Usage Logger Service
 *
 * Tracks all model/API calls with per-request granularity.
 * Data is stored in `usage_logs` with soft references to tasks/sessions
 * (no CASCADE — survives deletion).
 *
 * Costs are stored in micro-dollars (1 USD = 1,000,000) as INTEGERs
 * to avoid IEEE 754 float precision errors.
 */

import { getDatabase } from '@/shared/db';
import { getSetting, invalidateBudgetSpendCache } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('UsageLogger');

// ============================================================================
// Types
// ============================================================================

export type CallType =
  | 'agent'
  | 'title'
  | 'embedding'
  | 'image'
  | 'video'
  | 'render'
  | 'speech'
  | 'ptc'
  | 'other';

export type BillingType = 'api' | 'subscription' | 'free';

export interface OutputTokensDetails {
  thinking_tokens?: number;
}

export interface UsageLogInput {
  taskId?: string;
  sessionId?: string;
  parentId?: string;
  callType: CallType;
  providerId?: string; // AIProvider.id — used to resolve billing type
  provider?: string; // Display name: 'anthropic' | 'openai' | 'google' | etc.
  model?: string;
  billingType?: BillingType; // Override; default: resolved from providerId
  billingScope?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  outputTokensDetails?: OutputTokensDetails | null;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  totalCostMicro?: number; // If already computed (in micro-dollars)
  totalCostUsd?: number; // If already computed (in USD — will be converted)
  unitCostMicro?: number; // For non-token costs
  unitType?: string;
  unitCount?: number;
  latencyMs?: number;
  status?: 'success' | 'error' | 'cancelled';
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface UsageLog {
  id: string;
  task_id: string | null;
  session_id: string | null;
  parent_id: string | null;
  call_type: CallType;
  provider: string | null;
  model: string | null;
  billing_type: BillingType;
  billing_scope: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  input_cost: number;
  output_cost: number;
  cache_read_cost: number;
  cache_creation_cost: number;
  total_cost: number;
  unit_cost: number;
  unit_type: string | null;
  unit_count: number;
  latency_ms: number;
  status: string;
  error_message: string | null;
  metadata: string;
  created_at: string;
}

export interface UsageSummary {
  totalRequests: number;
  costByBilling: {
    api: { cost: number; requests: number; tokens: number };
    subscription: { cost: number; requests: number; tokens: number };
    free: { cost: number; requests: number; tokens: number };
  };
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalEstimatedCost: number;
}

export interface ProviderSummary {
  provider: string;
  billing_type: BillingType;
  requests: number;
  cost: number;
  tokens: number;
}

export interface ModelSummary {
  model: string;
  provider: string;
  billing_type: BillingType;
  requests: number;
  cost: number;
  tokens: number;
}

export interface CallTypeSummary {
  call_type: CallType;
  requests: number;
  cost: number;
  tokens: number;
}

export interface DailyUsage {
  date: string;
  requests: number;
  cost: number;
  tokens: number;
  cost_api: number;
  cost_subscription: number;
  cost_free: number;
}

// ============================================================================
// Helpers
// ============================================================================

/** Convert USD to micro-dollars (1 USD = 1,000,000) */
export function toMicrodollars(usd: number): number {
  return Math.round(usd * 1_000_000);
}

/** Convert micro-dollars to USD */
export function fromMicrodollars(micro: number): number {
  return micro / 1_000_000;
}

/** Format micro-dollars for display */
export function formatCost(micro: number): string {
  return `$${fromMicrodollars(micro).toFixed(4)}`;
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function buildUsageMetadata(input: UsageLogInput): Record<string, unknown> {
  const metadata = { ...(input.metadata ?? {}) };
  const reasoningOutputTokens = finiteNumber(input.reasoningOutputTokens);
  const outputTokensDetails = normalizeOutputTokensDetails(
    input.outputTokensDetails,
  );

  if (
    reasoningOutputTokens != null &&
    metadata.reasoning_output_tokens == null
  ) {
    metadata.reasoning_output_tokens = reasoningOutputTokens;
  }

  if (outputTokensDetails != null && metadata.output_tokens_details == null) {
    metadata.output_tokens_details = outputTokensDetails;
  }

  return metadata;
}

function normalizeOutputTokensDetails(
  details: OutputTokensDetails | null | undefined,
): OutputTokensDetails | undefined {
  if (!details) return undefined;

  const thinkingTokens = finiteNumber(details.thinking_tokens);
  return thinkingTokens == null
    ? undefined
    : { thinking_tokens: thinkingTokens };
}

// ============================================================================
// Billing Type Resolution
// ============================================================================

interface AIProviderBilling {
  billingType?: BillingType;
  billingScope?: string;
}

/**
 * Resolve billing type from provider configuration.
 * Reads the provider settings stored by the frontend.
 */
export function resolveBillingType(
  providerId?: string,
  model?: string,
): {
  billingType: BillingType;
  billingScope?: string;
} {
  try {
    const providersJson = getSetting('providers');
    const providers = providersJson
      ? (JSON.parse(providersJson) as (AIProviderBilling & { id: string })[])
      : [];

    if (providerId) {
      const provider = providers.find((p) => p.id === providerId);
      if (provider?.billingType) {
        return {
          billingType: provider.billingType,
          billingScope: provider.billingScope ?? undefined,
        };
      }
    }

    // Fall back to model-level default_billing_type from pricing table
    if (model) {
      const db = getDatabase();
      const baseModel = model.replace(/-\d{8}$/, '');
      const row = db
        .prepare(
          'SELECT default_billing_type FROM model_pricing WHERE model_id = ? OR model_id = ? LIMIT 1',
        )
        .get(model, baseModel) as
        | { default_billing_type: BillingType }
        | undefined;
      if (row?.default_billing_type && row.default_billing_type !== 'api') {
        return { billingType: row.default_billing_type };
      }
    }
  } catch {
    // fall through
  }

  return { billingType: 'api' };
}

// ============================================================================
// Core Write
// ============================================================================

/**
 * Log a usage record. Returns the log ID.
 */
export function logUsage(input: UsageLogInput): string {
  const id = crypto.randomUUID();

  // Resolve billing type from provider config (or model default) if not explicitly set
  const billing =
    input.billingType != null
      ? { billingType: input.billingType, billingScope: input.billingScope }
      : resolveBillingType(input.providerId, input.model);

  // Subscription and free billing types have zero cost — the user pays a flat
  // subscription fee, not per-token.  The SDK may still report total_cost_usd
  // based on API pricing, so we override it to 0.
  const isZeroCostBilling =
    billing.billingType === 'subscription' || billing.billingType === 'free';

  // Compute total cost in micro-dollars
  let totalCost = 0;
  if (!isZeroCostBilling) {
    totalCost = input.totalCostMicro ?? 0;
    if (input.totalCostMicro == null && input.totalCostUsd != null) {
      totalCost = toMicrodollars(input.totalCostUsd);
    }
  }

  const unitCost = isZeroCostBilling ? 0 : (input.unitCostMicro ?? 0);
  const unitCount = input.unitCount ?? 0;

  // If no total cost provided but we have unit cost, compute it
  if (
    !isZeroCostBilling &&
    input.totalCostMicro == null &&
    input.totalCostUsd == null &&
    unitCost > 0 &&
    unitCount > 0
  ) {
    totalCost = unitCost * unitCount;
  }

  try {
    const db = getDatabase();
    const metadata = buildUsageMetadata(input);
    const stmt = db.prepare(`
      INSERT INTO usage_logs (
        id, task_id, session_id, parent_id,
        call_type, provider, model,
        billing_type, billing_scope,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        input_cost, output_cost, cache_read_cost, cache_creation_cost, total_cost,
        unit_cost, unit_type, unit_count,
        latency_ms, status, error_message, metadata
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        0, 0, 0, 0, ?,
        ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    stmt.run(
      id,
      input.taskId ?? null,
      input.sessionId ?? null,
      input.parentId ?? null,
      input.callType,
      input.provider ?? null,
      input.model ?? null,
      billing.billingType,
      billing.billingScope ?? null,
      input.inputTokens ?? 0,
      input.outputTokens ?? 0,
      input.cacheReadTokens ?? 0,
      input.cacheCreationTokens ?? 0,
      totalCost,
      unitCost,
      input.unitType ?? null,
      unitCount,
      input.latencyMs ?? 0,
      input.status ?? 'success',
      input.errorMessage ?? null,
      JSON.stringify(metadata),
    );

    logger.debug(
      `Logged usage: ${input.callType} ${input.provider ?? ''}/${input.model ?? ''} cost=${formatCost(totalCost)}`,
    );

    // Invalidate budget spend cache so next preflight re-computes from usage_logs
    if (totalCost > 0) {
      try {
        invalidateBudgetSpendCache();
      } catch {
        // Non-fatal — cache will be re-computed on next preflight
      }
    }

    return id;
  } catch (err) {
    logger.error('Failed to log usage:', err);
    return id; // Return ID even on failure — don't break caller flow
  }
}

// ============================================================================
// Query Functions
// ============================================================================

interface TimeRangeParams {
  start?: string;
  end?: string;
  billingType?: BillingType;
  /** Filter by origin: 'channel' = billing_scope starts with 'channel:', 'desktop' = all others */
  source?: 'channel' | 'desktop';
}

function buildWhereClause(params: TimeRangeParams): {
  where: string;
  values: unknown[];
} {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.start) {
    conditions.push('created_at >= ?');
    values.push(params.start);
  }
  if (params.end) {
    conditions.push('created_at <= ?');
    values.push(params.end);
  }
  if (params.billingType) {
    conditions.push('billing_type = ?');
    values.push(params.billingType);
  }
  if (params.source === 'channel') {
    conditions.push(`billing_scope LIKE 'channel:%'`);
  } else if (params.source === 'desktop') {
    conditions.push(
      `(billing_scope IS NULL OR billing_scope NOT LIKE 'channel:%')`,
    );
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, values };
}

/** Get overall usage summary with billing breakdown */
export function getUsageSummary(params: TimeRangeParams): UsageSummary {
  const db = getDatabase();
  const { where, values } = buildWhereClause(params);

  const rows = db
    .prepare(
      `
    SELECT
      billing_type,
      COUNT(*) as requests,
      COALESCE(SUM(total_cost), 0) as cost,
      COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0) as tokens,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens
    FROM usage_logs
    ${where}
    GROUP BY billing_type
  `,
    )
    .all(...values) as {
    billing_type: BillingType;
    requests: number;
    cost: number;
    tokens: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  }[];

  const result: UsageSummary = {
    totalRequests: 0,
    costByBilling: {
      api: { cost: 0, requests: 0, tokens: 0 },
      subscription: { cost: 0, requests: 0, tokens: 0 },
      free: { cost: 0, requests: 0, tokens: 0 },
    },
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalEstimatedCost: 0,
  };

  for (const row of rows) {
    const bt = row.billing_type as keyof typeof result.costByBilling;
    if (result.costByBilling[bt]) {
      result.costByBilling[bt] = {
        cost: row.cost,
        requests: row.requests,
        tokens: row.tokens,
      };
    }
    result.totalRequests += row.requests;
    result.totalTokens += row.tokens;
    result.totalInputTokens += row.input_tokens;
    result.totalOutputTokens += row.output_tokens;
    result.totalCacheReadTokens += row.cache_read_tokens;
    result.totalCacheCreationTokens += row.cache_creation_tokens;
    result.totalEstimatedCost += row.cost;
  }

  return result;
}

/** Get usage grouped by provider */
export function getUsageByProvider(params: TimeRangeParams): ProviderSummary[] {
  const db = getDatabase();
  const { where, values } = buildWhereClause(params);

  return db
    .prepare(
      `
    SELECT
      COALESCE(provider, 'unknown') as provider,
      billing_type,
      COUNT(*) as requests,
      COALESCE(SUM(total_cost), 0) as cost,
      COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0) as tokens
    FROM usage_logs
    ${where}
    GROUP BY provider, billing_type
    ORDER BY cost DESC
  `,
    )
    .all(...values) as ProviderSummary[];
}

/** Get usage grouped by model */
export function getUsageByModel(params: TimeRangeParams): ModelSummary[] {
  const db = getDatabase();
  const { where, values } = buildWhereClause(params);

  return db
    .prepare(
      `
    SELECT
      COALESCE(model, 'unknown') as model,
      COALESCE(provider, 'unknown') as provider,
      billing_type,
      COUNT(*) as requests,
      COALESCE(SUM(total_cost), 0) as cost,
      COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0) as tokens
    FROM usage_logs
    ${where}
    GROUP BY model, provider, billing_type
    ORDER BY cost DESC
  `,
    )
    .all(...values) as ModelSummary[];
}

/** Get usage grouped by call type */
export function getUsageByCallType(params: TimeRangeParams): CallTypeSummary[] {
  const db = getDatabase();
  const { where, values } = buildWhereClause(params);

  return db
    .prepare(
      `
    SELECT
      call_type,
      COUNT(*) as requests,
      COALESCE(SUM(total_cost), 0) as cost,
      COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0) as tokens
    FROM usage_logs
    ${where}
    GROUP BY call_type
    ORDER BY cost DESC
  `,
    )
    .all(...values) as CallTypeSummary[];
}

/** Get daily usage aggregation */
export function getDailyUsage(params: TimeRangeParams): DailyUsage[] {
  const db = getDatabase();
  const { where, values } = buildWhereClause(params);

  return db
    .prepare(
      `
    SELECT
      DATE(created_at) as date,
      COUNT(*) as requests,
      COALESCE(SUM(total_cost), 0) as cost,
      COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0) as tokens,
      COALESCE(SUM(CASE WHEN billing_type = 'api' THEN total_cost ELSE 0 END), 0) as cost_api,
      COALESCE(SUM(CASE WHEN billing_type = 'subscription' THEN total_cost ELSE 0 END), 0) as cost_subscription,
      COALESCE(SUM(CASE WHEN billing_type = 'free' THEN total_cost ELSE 0 END), 0) as cost_free
    FROM usage_logs
    ${where}
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `,
    )
    .all(...values) as DailyUsage[];
}

const ALLOWED_SORT_COLUMNS: Record<string, string> = {
  created_at: 'created_at',
  total_cost: 'total_cost',
  tokens:
    '(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens)',
  latency_ms: 'latency_ms',
};

const LOCAL_PROVIDERS_SQL = `('ollama', 'lmstudio', 'local')`;

/** Get paginated request logs */
export function getRequestLogs(params: {
  start?: string;
  end?: string;
  model?: string;
  provider?: string;
  callType?: CallType;
  billingType?: BillingType;
  locality?: 'local' | 'non_local';
  source?: 'channel' | 'desktop';
  sortField?: string;
  sortDir?: 'asc' | 'desc';
  limit: number;
  offset: number;
}): { items: UsageLog[]; total: number } {
  const db = getDatabase();
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.start) {
    conditions.push('created_at >= ?');
    values.push(params.start);
  }
  if (params.end) {
    conditions.push('created_at <= ?');
    values.push(params.end);
  }
  if (params.model) {
    conditions.push('model = ?');
    values.push(params.model);
  }
  if (params.provider) {
    conditions.push('provider = ?');
    values.push(params.provider);
  }
  if (params.callType) {
    conditions.push('call_type = ?');
    values.push(params.callType);
  }
  if (params.billingType) {
    conditions.push('billing_type = ?');
    values.push(params.billingType);
  }
  if (params.locality === 'local') {
    conditions.push(`LOWER(COALESCE(provider, '')) IN ${LOCAL_PROVIDERS_SQL}`);
  } else if (params.locality === 'non_local') {
    conditions.push(
      `LOWER(COALESCE(provider, '')) NOT IN ${LOCAL_PROVIDERS_SQL}`,
    );
  }
  if (params.source === 'channel') {
    conditions.push(`billing_scope LIKE 'channel:%'`);
  } else if (params.source === 'desktop') {
    conditions.push(
      `(billing_scope IS NULL OR billing_scope NOT LIKE 'channel:%')`,
    );
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (
    db
      .prepare(`SELECT COUNT(*) as count FROM usage_logs ${where}`)
      .get(...values) as { count: number }
  ).count;

  const sortCol = ALLOWED_SORT_COLUMNS[params.sortField ?? ''] ?? 'created_at';
  const sortDir = params.sortDir === 'asc' ? 'ASC' : 'DESC';

  const items = db
    .prepare(
      `
    SELECT * FROM usage_logs
    ${where}
    ORDER BY ${sortCol} ${sortDir}
    LIMIT ? OFFSET ?
  `,
    )
    .all(...values, params.limit, params.offset) as UsageLog[];

  return { items, total };
}

/** Delete all rows from usage_logs. Returns number of rows deleted. */
export function clearUsageLogs(): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM usage_logs').run();
  invalidateBudgetSpendCache();
  return result.changes;
}
