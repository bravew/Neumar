import { z } from 'zod';

import type { AgentRunEventRow, AgentRunRow } from '@/shared/db/operations';
import { getAgentRun, getAgentRunEventsAfter } from '@/shared/db/operations';

import {
  listTraceEventsForRun,
  type TraceEvent,
  type TraceEventKind,
} from './trace';

export const TIMING_PHASES = [
  'prompt_build',
  'agent_run',
  'model_call',
  'tool_call',
  'artifact_write',
  'preview_verify',
  'stream_start_to_end',
  'finalize',
] as const;
export type TimingPhase = (typeof TIMING_PHASES)[number];

export const ANOMALY_KINDS = ['approval', 'hook', 'error', 'budget'] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];

const diagnosticSourceSchema = z.enum([
  'neuma',
  'agent-runtime',
  'model-provider',
]);
const diagnosticEvidenceSchema = z.enum(['measured', 'computed', 'indirect']);
const missingStateSchema = z.enum([
  'not_collected',
  'unsupported',
  'upstream_unavailable',
]);

export const DiagnosticValueSchema = <T extends z.ZodTypeAny>(value: T) =>
  z.discriminatedUnion('state', [
    z
      .object({
        state: z.literal('available'),
        value,
        evidence: diagnosticEvidenceSchema,
        source: diagnosticSourceSchema,
        complete: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        state: missingStateSchema,
        source: diagnosticSourceSchema,
        missingReason: z.string().min(1),
      })
      .strict(),
  ]);

export type DiagnosticValue<T> =
  | {
      state: 'available';
      value: T;
      evidence: 'measured' | 'computed' | 'indirect';
      source: 'neuma' | 'agent-runtime' | 'model-provider';
      complete?: boolean;
    }
  | {
      state: 'not_collected' | 'unsupported' | 'upstream_unavailable';
      source: 'neuma' | 'agent-runtime' | 'model-provider';
      missingReason: string;
    };

const numberValueSchema = DiagnosticValueSchema(
  z.number().finite().nonnegative(),
);
const stringValueSchema = DiagnosticValueSchema(z.string().min(1));

export const ExecutionDiagnosticsV1Schema = z
  .object({
    schema: z.literal('neuma.execution-diagnostics.v1'),
    runId: z.string().min(1),
    mode: z.enum(['task', 'design', 'video']),
    ownerKey: z.string().min(1),
    collectedAt: z.string().datetime(),
    eventStreamCompleteness: z.enum(['complete', 'partial']),
    timing: z.record(z.enum(TIMING_PHASES), numberValueSchema),
    tools: z
      .object({
        total: numberValueSchema,
        succeeded: numberValueSchema,
        failed: numberValueSchema,
        byName: DiagnosticValueSchema(
          z.record(z.string(), z.number().int().nonnegative()),
        ),
      })
      .strict(),
    anomalies: z.record(z.enum(ANOMALY_KINDS), numberValueSchema),
    usage: z
      .object({
        inputTokens: numberValueSchema,
        outputTokens: numberValueSchema,
        cacheReadTokens: numberValueSchema,
        cacheCreationTokens: numberValueSchema,
        costUsd: numberValueSchema,
      })
      .strict(),
    environment: z
      .object({
        runtimeId: stringValueSchema,
        runtimeVersion: stringValueSchema,
        requestedModel: stringValueSchema,
        resolvedModel: stringValueSchema,
        attempt: numberValueSchema,
        continuationAttempts: numberValueSchema,
      })
      .strict(),
    artifactDelivery: z
      .object({
        producedFileCount: numberValueSchema,
        verdict: stringValueSchema,
      })
      .strict(),
  })
  .strict();

export type ExecutionDiagnosticsV1 = z.infer<
  typeof ExecutionDiagnosticsV1Schema
>;

const TIMING_TRACE_KIND = {
  prompt_build: 'prompt_build',
  agent_run: 'agent_run',
  model_call: 'model_call',
  tool_call: 'tool_call',
  artifact_write: 'artifact_write',
  preview_verify: 'preview_verify',
  stream_start_to_end: 'stream_start',
  finalize: 'finalize',
} as const satisfies Record<TimingPhase, TraceEventKind>;

const ANOMALY_TRACE_KIND = {
  approval: 'approval',
  hook: 'hook',
  error: 'error',
  budget: 'budget',
} as const satisfies Record<AnomalyKind, TraceEventKind>;

function available<T>(
  value: T,
  evidence: 'measured' | 'computed' | 'indirect' = 'measured',
  source: 'neuma' | 'agent-runtime' | 'model-provider' = 'neuma',
  complete?: boolean,
): DiagnosticValue<T> {
  return {
    state: 'available',
    value,
    evidence,
    source,
    ...(complete === undefined ? {} : { complete }),
  };
}

function missing<T>(
  missingReason: string,
  source: 'neuma' | 'agent-runtime' | 'model-provider' = 'neuma',
  state:
    | 'not_collected'
    | 'unsupported'
    | 'upstream_unavailable' = 'not_collected',
): DiagnosticValue<T> {
  return { state, source, missingReason };
}

function isTerminalEvent(eventType: string): boolean {
  return eventType === 'RUN_FINISHED' || eventType === 'RUN_ERROR';
}

function journalIsComplete(
  run: AgentRunRow,
  events: readonly AgentRunEventRow[],
): boolean {
  if (events.length === 0 || events[0]?.seq !== 0) return false;
  if (events.some((event, index) => event.seq !== index)) return false;
  if (run.status === 'running') return false;
  return events.some((event) => isTerminalEvent(event.event_type));
}

function timingValue(
  phase: TimingPhase,
  traces: readonly TraceEvent[],
): DiagnosticValue<number> {
  if (phase === 'stream_start_to_end') {
    const starts = traces.filter((event) => event.kind === 'stream_start');
    const ends = traces.filter((event) => event.kind === 'stream_end');
    if (starts.length === 0 || ends.length === 0) {
      return missing('Stream boundary timing was not collected');
    }
    const start = Math.min(...starts.map((event) => event.started_at));
    const end = Math.max(
      ...ends.map((event) => event.ended_at ?? event.started_at),
    );
    return available(Math.max(0, end - start), 'computed');
  }
  const matching = traces.filter(
    (event) => event.kind === TIMING_TRACE_KIND[phase],
  );
  const measured = matching.filter(
    (event): event is TraceEvent & { duration_ms: number } =>
      event.duration_ms !== null,
  );
  if (measured.length === 0) {
    return missing(`${phase.replaceAll('_', ' ')} timing was not collected`);
  }
  return available(
    measured.reduce((sum, event) => sum + event.duration_ms, 0),
    'measured',
    'neuma',
    measured.length === matching.length,
  );
}

function traceMetric(
  traces: readonly TraceEvent[],
  field:
    | 'input_tokens'
    | 'output_tokens'
    | 'cache_read'
    | 'cache_creation'
    | 'cost_usd',
  fallback: number,
): DiagnosticValue<number> {
  const values = traces
    .filter((trace) => trace.kind === 'model_call')
    .map((trace) => trace[field])
    .filter((value): value is number => value !== null);
  if (values.length > 0) {
    return available(
      values.reduce((sum, value) => sum + value, 0),
      'measured',
      'model-provider',
    );
  }
  if (fallback > 0) return available(fallback, 'indirect', 'neuma');
  return missing(
    'The model provider did not report this metric',
    'model-provider',
    'upstream_unavailable',
  );
}

function parseEvent(row: AgentRunEventRow): Record<string, unknown> | null {
  try {
    const value = JSON.parse(row.event_json) as unknown;
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toolDiagnostics(
  events: readonly AgentRunEventRow[],
  complete: boolean,
): ExecutionDiagnosticsV1['tools'] {
  const starts = new Map<string, string>();
  const results = new Map<string, boolean>();
  for (const row of events) {
    const event = parseEvent(row);
    if (!event) continue;
    if (row.event_type === 'TOOL_CALL_START') {
      const id = typeof event.toolCallId === 'string' ? event.toolCallId : '';
      const name =
        typeof event.toolCallName === 'string' ? event.toolCallName : 'unknown';
      if (id) starts.set(id, name);
    } else if (row.event_type === 'TOOL_CALL_RESULT') {
      const id = typeof event.toolCallId === 'string' ? event.toolCallId : '';
      if (id) results.set(id, event.isError === true);
    }
  }
  const byName: Record<string, number> = {};
  for (const name of starts.values()) byName[name] = (byName[name] ?? 0) + 1;
  let succeeded = 0;
  let failed = 0;
  let unmatchedResults = 0;
  for (const [id, isError] of results) {
    if (!starts.has(id)) {
      unmatchedResults += 1;
      continue;
    }
    if (isError) failed += 1;
    else succeeded += 1;
  }
  const countsComplete =
    complete && unmatchedResults === 0 && succeeded + failed === starts.size;
  return {
    total: available(starts.size, 'measured', 'neuma', countsComplete),
    succeeded: available(succeeded, 'measured', 'neuma', countsComplete),
    failed: available(failed, 'measured', 'neuma', countsComplete),
    byName: available(byName, 'measured', 'neuma', countsComplete),
  };
}

function continuationCount(traces: readonly TraceEvent[]): number {
  let count = 0;
  for (const trace of traces) {
    if (trace.kind !== 'model_call' || !trace.attrs_json) continue;
    try {
      const attrs = JSON.parse(trace.attrs_json) as Record<string, unknown>;
      if (typeof attrs.continuationAttempt === 'number') count += 1;
    } catch {
      // A malformed private trace attribute is simply not diagnostic evidence.
    }
  }
  return count;
}

function producedArtifactCount(traces: readonly TraceEvent[]): number {
  const ids = new Set<string>();
  for (const trace of traces) {
    if (trace.kind !== 'artifact_write' || trace.status !== 'ok') continue;
    let foundManifestEntry = false;
    if (trace.attrs_json) {
      try {
        const attrs = JSON.parse(trace.attrs_json) as {
          artifact_manifest?: { entries?: Array<{ id?: unknown }> };
        };
        for (const entry of attrs.artifact_manifest?.entries ?? []) {
          if (typeof entry.id !== 'string') continue;
          ids.add(entry.id);
          foundManifestEntry = true;
        }
      } catch {
        // Fall back to the trace id below.
      }
    }
    if (!foundManifestEntry) ids.add(`trace:${trace.id}`);
  }
  return ids.size;
}

export function buildExecutionDiagnostics(
  run: AgentRunRow,
  events: readonly AgentRunEventRow[],
  traces: readonly TraceEvent[],
  collectedAt = new Date().toISOString(),
): ExecutionDiagnosticsV1 {
  const complete = journalIsComplete(run, events);
  const timing = Object.fromEntries(
    TIMING_PHASES.map((phase) => [phase, timingValue(phase, traces)]),
  ) as ExecutionDiagnosticsV1['timing'];
  if (timing.agent_run.state !== 'available') {
    const startedAt = Date.parse(run.started_at);
    const finishedAt = run.finished_at ? Date.parse(run.finished_at) : NaN;
    if (Number.isFinite(startedAt) && Number.isFinite(finishedAt)) {
      timing.agent_run = available(
        Math.max(0, finishedAt - startedAt),
        'computed',
      );
    }
  }
  const anomalies = Object.fromEntries(
    ANOMALY_KINDS.map((kind) => [
      kind,
      available(
        traces.filter((trace) => trace.kind === ANOMALY_TRACE_KIND[kind])
          .length,
      ),
    ]),
  ) as ExecutionDiagnosticsV1['anomalies'];
  const artifactCount = producedArtifactCount(traces);
  const producedFileCount =
    artifactCount > 0
      ? available(artifactCount)
      : run.delivery === 'not_expected'
        ? available(0, 'indirect')
        : missing<number>('Artifact production counts were not collected');
  let resolvedModel: string | null = null;
  for (const trace of traces) {
    if (trace.kind === 'model_call' && trace.model) resolvedModel = trace.model;
  }
  const diagnostics: ExecutionDiagnosticsV1 = {
    schema: 'neuma.execution-diagnostics.v1',
    runId: run.id,
    mode: run.mode,
    ownerKey: run.owner_key,
    collectedAt,
    eventStreamCompleteness: complete ? 'complete' : 'partial',
    timing,
    tools: toolDiagnostics(events, complete),
    anomalies,
    usage: {
      inputTokens: traceMetric(traces, 'input_tokens', run.tokens_in),
      outputTokens: traceMetric(traces, 'output_tokens', run.tokens_out),
      cacheReadTokens: traceMetric(traces, 'cache_read', 0),
      cacheCreationTokens: traceMetric(traces, 'cache_creation', 0),
      costUsd: traceMetric(traces, 'cost_usd', run.cost_usd),
    },
    environment: {
      runtimeId: available(run.provider, 'indirect'),
      runtimeVersion: run.runtime_version
        ? available(run.runtime_version, 'indirect', 'agent-runtime')
        : missing('The runtime did not report its version', 'agent-runtime'),
      requestedModel: run.model
        ? available(run.model, 'indirect')
        : missing('No model was recorded for this run'),
      resolvedModel: resolvedModel
        ? available(resolvedModel, 'measured', 'agent-runtime')
        : missing(
            'The runtime did not report the resolved model',
            'agent-runtime',
          ),
      attempt: available(run.attempt),
      continuationAttempts: available(continuationCount(traces)),
    },
    artifactDelivery: {
      producedFileCount,
      verdict: available(run.delivery, 'indirect'),
    },
  };
  return ExecutionDiagnosticsV1Schema.parse(diagnostics);
}

export function getExecutionDiagnostics(
  runId: string,
): ExecutionDiagnosticsV1 | null {
  const run = getAgentRun(runId);
  if (!run) return null;
  return buildExecutionDiagnostics(
    run,
    getAgentRunEventsAfter(runId, -1),
    listTraceEventsForRun(run.owner_key, runId),
  );
}
