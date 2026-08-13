/**
 * Usage API Client
 *
 * Frontend functions for querying usage statistics from the backend.
 * All costs returned in micro-dollars — use formatMicroCost() for display.
 */

import { API_BASE_URL } from '@/config';

const USAGE_API = `${API_BASE_URL}/usage`;
const TIMEOUT_MS = 15_000;

// ============================================================================
// Types (mirror backend)
// ============================================================================

export type BillingType = 'api' | 'subscription' | 'free';
export type CallType =
  | 'agent'
  | 'title'
  | 'embedding'
  | 'image'
  | 'speech'
  | 'ptc'
  | 'other';

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

export interface ModelPricing {
  model_id: string;
  provider: string;
  display_name: string;
  input_cost_per_million: number;
  output_cost_per_million: number;
  cache_read_cost_per_million: number;
  cache_creation_cost_per_million: number;
  unit_cost: number;
  unit_type: string | null;
  default_billing_type: BillingType;
  is_default: number;
  updated_at: string;
}

// ============================================================================
// Helpers
// ============================================================================

/** Convert micro-dollars to display string */
export function formatMicroCost(micro: number): string {
  if (micro === 0) return '$0';
  const usd = micro / 1_000_000;
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Returns effective cost for display: subscription-billed entries have $0
 * direct cost (covered by plan), so we zero them out for cost reporting.
 */
export function getEffectiveCost(
  cost: number,
  billingType: BillingType,
): number {
  return billingType === 'subscription' ? 0 : cost;
}

/** Provider IDs that run locally and incur no cloud API cost. */
export const LOCAL_PROVIDER_IDS = new Set(['ollama', 'lmstudio', 'local']);

export function isLocalProvider(provider: string | null | undefined): boolean {
  return provider != null && LOCAL_PROVIDER_IDS.has(provider.toLowerCase());
}

/** Format token count for display */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

async function usageApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${USAGE_API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    signal: options?.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const err = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(err.error || 'Usage API request failed');
  }
  return response.json();
}

function buildQuery(
  params: Record<string, string | number | undefined>,
): string {
  const entries = Object.entries(params).filter(([, v]) => v != null);
  if (entries.length === 0) return '';
  return (
    '?' +
    new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
  );
}

// ============================================================================
// API Functions
// ============================================================================

export interface TimeRangeFilter {
  start?: string;
  end?: string;
  billingType?: BillingType;
  /** Filter by origin: 'channel' = messages from Slack/Discord/Lark/Telegram, 'desktop' = direct agent sessions */
  source?: 'channel' | 'desktop';
  signal?: AbortSignal;
}

export async function fetchUsageSummary(
  filter: TimeRangeFilter = {},
): Promise<UsageSummary> {
  const q = buildQuery({
    start: filter.start,
    end: filter.end,
    billing_type: filter.billingType,
    source: filter.source,
  });
  return usageApi<UsageSummary>(`/summary${q}`, { signal: filter.signal });
}

export async function fetchUsageByProvider(
  filter: TimeRangeFilter = {},
): Promise<ProviderSummary[]> {
  const q = buildQuery({
    start: filter.start,
    end: filter.end,
    billing_type: filter.billingType,
    source: filter.source,
  });
  return usageApi<ProviderSummary[]>(`/by-provider${q}`, {
    signal: filter.signal,
  });
}

export async function fetchUsageByModel(
  filter: TimeRangeFilter = {},
): Promise<ModelSummary[]> {
  const q = buildQuery({
    start: filter.start,
    end: filter.end,
    billing_type: filter.billingType,
    source: filter.source,
  });
  return usageApi<ModelSummary[]>(`/by-model${q}`, { signal: filter.signal });
}

export async function fetchUsageByCallType(
  filter: TimeRangeFilter = {},
): Promise<CallTypeSummary[]> {
  const q = buildQuery({
    start: filter.start,
    end: filter.end,
    billing_type: filter.billingType,
    source: filter.source,
  });
  return usageApi<CallTypeSummary[]>(`/by-call-type${q}`, {
    signal: filter.signal,
  });
}

export async function fetchDailyUsage(
  filter: TimeRangeFilter = {},
): Promise<DailyUsage[]> {
  const q = buildQuery({
    start: filter.start,
    end: filter.end,
    billing_type: filter.billingType,
    source: filter.source,
  });
  return usageApi<DailyUsage[]>(`/daily${q}`, { signal: filter.signal });
}

export async function fetchRequestLogs(
  params: TimeRangeFilter & {
    model?: string;
    provider?: string;
    callType?: CallType;
    locality?: 'local' | 'non_local';
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ items: UsageLog[]; total: number }> {
  const q = buildQuery({
    start: params.start,
    end: params.end,
    billing_type: params.billingType,
    source: params.source,
    model: params.model,
    provider: params.provider,
    call_type: params.callType,
    locality: params.locality,
    sort_field: params.sortField,
    sort_dir: params.sortDir,
    limit: params.limit,
    offset: params.offset,
  });
  return usageApi<{ items: UsageLog[]; total: number }>(`/logs${q}`, {
    signal: params.signal,
  });
}

export async function fetchPricing(
  signal?: AbortSignal,
): Promise<ModelPricing[]> {
  return usageApi<ModelPricing[]>('/pricing', { signal });
}

export async function fetchModelPricing(
  modelId: string,
  signal?: AbortSignal,
): Promise<ModelPricing | null> {
  try {
    return await usageApi<ModelPricing>(
      `/pricing/${encodeURIComponent(modelId)}`,
      { signal },
    );
  } catch {
    return null;
  }
}

export async function createModelPricing(params: {
  model_id: string;
  provider: string;
  display_name?: string;
  default_billing_type?: BillingType;
}): Promise<ModelPricing> {
  return usageApi<ModelPricing>('/pricing', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function renameModelPricing(
  oldModelId: string,
  newModelId: string,
): Promise<ModelPricing | null> {
  try {
    return await usageApi<ModelPricing>(
      `/pricing/${encodeURIComponent(oldModelId)}/rename`,
      { method: 'PATCH', body: JSON.stringify({ new_model_id: newModelId }) },
    );
  } catch {
    return null;
  }
}

export async function clearUsageLogs(
  signal?: AbortSignal,
): Promise<{ deleted: number }> {
  return usageApi<{ deleted: number }>('/logs', { method: 'DELETE', signal });
}

export async function updateModelPricing(
  modelId: string,
  pricing: Partial<{
    input_cost_per_million: number;
    output_cost_per_million: number;
    cache_read_cost_per_million: number;
    cache_creation_cost_per_million: number;
    unit_cost: number;
    unit_type: string;
    default_billing_type: BillingType;
  }>,
): Promise<ModelPricing> {
  return usageApi<ModelPricing>(`/pricing/${encodeURIComponent(modelId)}`, {
    method: 'PUT',
    body: JSON.stringify(pricing),
  });
}
