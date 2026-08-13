import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import { taskEventBus } from '@/shared/services/task-event-bus';
import { createLogger, redactValue } from '@/shared/utils/logger';

import { dispatchTraceEvent } from './exporters/registry';

const logger = createLogger('TraceEvents');

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

export interface TraceEvent {
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

export interface RecordTraceEventInput {
  id?: string;
  taskId: string;
  sessionId?: string | null;
  messageId?: string | null;
  parentEventId?: string | null;
  kind: TraceEventKind;
  agent?: string | null;
  provider?: string | null;
  model?: string | null;
  profile?: string | null;
  tool?: string | null;
  status?: TraceEventStatus;
  startedAt?: number;
  endedAt?: number | null;
  durationMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheRead?: number | null;
  cacheCreation?: number | null;
  costUsd?: number | null;
  attrs?: Record<string, unknown> | null;
  error?: unknown;
}

let insertStmtCache: {
  db: Database.Database;
  stmt: Database.Statement;
} | null = null;

function stringifyRedacted(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(redactValue(value));
  } catch {
    return JSON.stringify('[UNSERIALIZABLE]');
  }
}

function getInsertStmt(): Database.Statement {
  const db = getDatabase();
  if (!insertStmtCache || insertStmtCache.db !== db) {
    insertStmtCache = {
      db,
      // Use ON CONFLICT DO UPDATE so re-recording the same id (e.g.
      // RUN_FINISHED upserting a RUN_STARTED row) preserves the original
      // created_at — INSERT OR REPLACE deletes + inserts and loses it.
      stmt: db.prepare(`
        INSERT INTO trace_events (
          id, task_id, session_id, message_id, parent_event_id,
          kind, agent, provider, model, profile, tool, status,
          started_at, ended_at, duration_ms,
          input_tokens, output_tokens, cache_read, cache_creation, cost_usd,
          attrs_json, error_json
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          session_id = excluded.session_id,
          message_id = excluded.message_id,
          parent_event_id = excluded.parent_event_id,
          kind = excluded.kind,
          agent = excluded.agent,
          provider = excluded.provider,
          model = excluded.model,
          profile = excluded.profile,
          tool = excluded.tool,
          status = excluded.status,
          ended_at = excluded.ended_at,
          duration_ms = excluded.duration_ms,
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens,
          cache_read = excluded.cache_read,
          cache_creation = excluded.cache_creation,
          cost_usd = excluded.cost_usd,
          attrs_json = excluded.attrs_json,
          error_json = excluded.error_json
      `),
    };
  }
  return insertStmtCache.stmt;
}

export function recordTraceEvent(input: RecordTraceEventInput): TraceEvent {
  const now = Date.now();
  const startedAt = input.startedAt ?? now;
  const endedAt = input.endedAt ?? null;
  const durationMs =
    input.durationMs ??
    (endedAt != null ? Math.max(0, endedAt - startedAt) : null);
  const event: TraceEvent = {
    id: input.id ?? crypto.randomUUID(),
    task_id: input.taskId,
    session_id: input.sessionId ?? null,
    message_id: input.messageId ?? null,
    parent_event_id: input.parentEventId ?? null,
    kind: input.kind,
    agent: input.agent ?? null,
    provider: input.provider ?? input.agent ?? null,
    model: input.model ?? null,
    profile: input.profile ?? null,
    tool: input.tool ?? null,
    status: input.status ?? 'ok',
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: durationMs,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    cache_read: input.cacheRead ?? null,
    cache_creation: input.cacheCreation ?? null,
    cost_usd: input.costUsd ?? null,
    attrs_json: stringifyRedacted(input.attrs),
    error_json: stringifyRedacted(input.error),
    created_at: new Date().toISOString(),
  };

  try {
    getInsertStmt().run(
      event.id,
      event.task_id,
      event.session_id,
      event.message_id,
      event.parent_event_id,
      event.kind,
      event.agent,
      event.provider,
      event.model,
      event.profile,
      event.tool,
      event.status,
      event.started_at,
      event.ended_at,
      event.duration_ms,
      event.input_tokens,
      event.output_tokens,
      event.cache_read,
      event.cache_creation,
      event.cost_usd,
      event.attrs_json,
      event.error_json,
    );
    taskEventBus.publish(`trace:${event.task_id}`, {
      type: 'trace.event',
      event,
    });
    dispatchTraceEvent(event);
  } catch (err) {
    logger.warn('Failed to record trace event', {
      taskId: input.taskId,
      kind: input.kind,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return event;
}

export function listTraceEvents(
  taskId: string,
  options: { sinceEventId?: string; limit?: number } = {},
): TraceEvent[] {
  const db = getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 2_000);
  if (!options.sinceEventId) {
    return db
      .prepare(
        `SELECT * FROM trace_events
         WHERE task_id = ?
         ORDER BY started_at ASC, created_at ASC, id ASC
         LIMIT ?`,
      )
      .all(taskId, limit) as TraceEvent[];
  }

  const since = db
    .prepare(
      'SELECT started_at, created_at, id FROM trace_events WHERE id = ? AND task_id = ?',
    )
    .get(options.sinceEventId, taskId) as
    | { started_at: number; created_at: string; id: string }
    | undefined;
  if (!since) return [];

  return db
    .prepare(
      `SELECT * FROM trace_events
       WHERE task_id = ?
         AND (
           started_at > ?
           OR (started_at = ? AND created_at > ?)
           OR (started_at = ? AND created_at = ? AND id > ?)
         )
       ORDER BY started_at ASC, created_at ASC, id ASC
       LIMIT ?`,
    )
    .all(
      taskId,
      since.started_at,
      since.started_at,
      since.created_at,
      since.started_at,
      since.created_at,
      since.id,
      limit,
    ) as TraceEvent[];
}

/** Run-scoped trace read. The session id is the durable agent run id. */
export function listTraceEventsForRun(
  ownerKey: string,
  runId: string,
): TraceEvent[] {
  return getDatabase()
    .prepare(
      `SELECT * FROM trace_events
       WHERE task_id = ? AND session_id = ?
       ORDER BY started_at ASC, created_at ASC, id ASC
       LIMIT 2000`,
    )
    .all(ownerKey, runId) as TraceEvent[];
}

function rangeToMs(range: string | null): number {
  switch (range) {
    case '90d':
      return 90 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
    case '7d':
    default:
      return 7 * 24 * 60 * 60 * 1000;
  }
}

export type CostGroupBy = 'provider' | 'model' | 'agent' | 'profile' | 'day';

export function getCostRollup(
  range: string | null,
  groupBy: CostGroupBy,
): {
  range: string;
  groupBy: CostGroupBy;
  since: number;
  summary: {
    costUsd: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    p95LatencyMs: number | null;
  };
  groups: Array<{
    key: string;
    provider?: string | null;
    model?: string | null;
    costUsd: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    meanLatencyMs: number | null;
    p95LatencyMs: number | null;
  }>;
  source: 'trace_events+messages_backfill';
} {
  const db = getDatabase();
  const effectiveRange = range === '30d' || range === '90d' ? range : '7d';
  const since = Date.now() - rangeToMs(effectiveRange);

  const summary = db
    .prepare(
      `WITH model_events AS (
         SELECT cost_usd, input_tokens, output_tokens, duration_ms
         FROM trace_events
         WHERE kind = 'model_call' AND started_at >= ?
         UNION ALL
         SELECT cost AS cost_usd, usage_input AS input_tokens,
                usage_output AS output_tokens, NULL AS duration_ms
         FROM messages
         WHERE type IN ('text', 'result')
           AND (cost IS NOT NULL OR usage_input IS NOT NULL OR usage_output IS NOT NULL)
           AND CAST(strftime('%s', created_at) AS INTEGER) * 1000 >= ?
           AND NOT EXISTS (
             SELECT 1 FROM trace_events te
             WHERE te.task_id = messages.task_id
               AND te.kind = 'model_call'
               AND te.started_at >= ?
           )
       )
       SELECT COALESCE(SUM(cost_usd), 0) AS costUsd,
              COUNT(*) AS calls,
              COALESCE(SUM(input_tokens), 0) AS inputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens
       FROM model_events`,
    )
    .get(since, since, since) as {
    costUsd: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
  };

  const p95 = db
    .prepare(
      `SELECT duration_ms AS p95LatencyMs
       FROM trace_events
       WHERE kind = 'model_call' AND started_at >= ? AND duration_ms IS NOT NULL
       ORDER BY duration_ms
       LIMIT 1 OFFSET (
         SELECT MAX(CAST(COUNT(*) * 0.95 AS INTEGER) - 1, 0)
         FROM trace_events
         WHERE kind = 'model_call' AND started_at >= ? AND duration_ms IS NOT NULL
       )`,
    )
    .get(since, since) as { p95LatencyMs: number } | undefined;

  const expr =
    groupBy === 'day'
      ? "date(started_at / 1000, 'unixepoch')"
      : groupBy === 'model'
        ? "COALESCE(model, 'unknown')"
        : groupBy === 'agent'
          ? "COALESCE(agent, 'unknown')"
          : groupBy === 'profile'
            ? "COALESCE(profile, 'unknown')"
            : "COALESCE(provider, 'unknown')";

  const groups = db
    .prepare(
      `WITH grouped AS (
         SELECT ${expr} AS key,
                provider,
                model,
                COALESCE(cost_usd, 0) AS cost_usd,
                COALESCE(input_tokens, 0) AS input_tokens,
                COALESCE(output_tokens, 0) AS output_tokens,
                duration_ms
         FROM trace_events
         WHERE kind = 'model_call' AND started_at >= ?
       ),
       agg AS (
         SELECT key,
                MIN(provider) AS provider,
                MIN(model) AS model,
                SUM(cost_usd) AS costUsd,
                COUNT(*) AS calls,
                SUM(input_tokens) AS inputTokens,
                SUM(output_tokens) AS outputTokens,
                AVG(duration_ms) AS meanLatencyMs
         FROM grouped
         GROUP BY key
       )
       SELECT * FROM agg ORDER BY costUsd DESC LIMIT 50`,
    )
    .all(since) as Array<{
    key: string;
    provider: string | null;
    model: string | null;
    costUsd: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    meanLatencyMs: number | null;
  }>;

  return {
    range: effectiveRange,
    groupBy,
    since,
    summary: {
      ...summary,
      p95LatencyMs: p95?.p95LatencyMs ?? null,
    },
    groups: groups.map((row) => ({ ...row, p95LatencyMs: null })),
    source: 'trace_events+messages_backfill',
  };
}
