/**
 * Frontend types for persisted trace events and cost rollups returned by
 * the backend `/observability/*` routes.
 */

export type TraceEventKind =
  | 'prompt_build'
  | 'agent_run'
  | 'model_call'
  | 'tool_call'
  | 'artifact_write'
  | 'preview_verify'
  | 'approval'
  | 'hook'
  | 'error'
  | 'budget'
  | 'stream_start'
  | 'stream_end'
  | 'finalize';

export type TraceEventStatus =
  | 'ok'
  | 'error'
  | 'denied'
  | 'timeout'
  | 'cancelled'
  | 'running';

/** Raw trace event row as returned by the backend. */
export interface PersistedTraceEvent {
  id: string;
  task_id: string;
  session_id: string | null;
  message_id: string | null;
  parent_event_id: string | null;
  kind: TraceEventKind;
  agent: string | null;
  provider: string | null;
  model: string | null;
  profile: string | null;
  tool: string | null;
  status: TraceEventStatus;
  started_at: number;
  ended_at: number | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read: number | null;
  cache_creation: number | null;
  cost_usd: number | null;
  attrs_json: string | null;
  error_json: string | null;
  created_at: string;
}

export interface TraceListResponse {
  events: PersistedTraceEvent[];
}

export interface CostRollupSummary {
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  p95LatencyMs: number | null;
}

export interface CostRollupGroup {
  key: string;
  provider?: string | null;
  model?: string | null;
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  meanLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export type CostGroupBy = 'provider' | 'model' | 'agent' | 'profile' | 'day';

export interface CostRollupResponse {
  range: string;
  groupBy: CostGroupBy;
  since: number;
  summary: CostRollupSummary;
  groups: CostRollupGroup[];
  source: string;
}
