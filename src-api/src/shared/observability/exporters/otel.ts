/**
 * OTLP-style trace exporter adapter.
 *
 * This is intentionally a thin POST adapter. The OpenTelemetry GenAI
 * semantic conventions are still in development, so we publish neuma's
 * native event shape (with redacted attrs) and rely on the receiving
 * collector to map fields. The default install never instantiates this
 * exporter — it is created only when explicit endpoint configuration is
 * provided.
 */
import { createLogger } from '@/shared/utils/logger';

import type { TraceEvent } from '../trace';
import type { TraceExporter } from './types';

const logger = createLogger('OtelTraceExporter');

export interface OtelExporterOptions {
  endpoint: string;
  headers?: Record<string, string>;
  /** Per-request timeout. Defaults to 5_000 ms. */
  timeoutMs?: number;
  /** Override fetch (test injection). */
  fetchImpl?: typeof fetch;
}

export function createOtelExporter(opts: OtelExporterOptions): TraceExporter {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  return {
    name: 'otel',
    async export(event: TraceEvent) {
      const body = JSON.stringify(toOtelLike(event));
      const res = await fetchImpl(opts.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...opts.headers },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        logger.warn('OTEL export rejected', { status: res.status });
        throw new Error(`OTEL export failed: ${res.status}`);
      }
    },
  };
}

function toOtelLike(event: TraceEvent): Record<string, unknown> {
  return {
    resource: { 'service.name': 'neuma' },
    span: {
      span_id: event.id,
      parent_span_id: event.parent_event_id,
      name: event.tool ?? event.model ?? event.kind,
      start_time_unix_nano: event.started_at * 1_000_000,
      end_time_unix_nano: event.ended_at ? event.ended_at * 1_000_000 : null,
      status: event.status,
      attributes: {
        'neuma.task_id': event.task_id,
        'neuma.kind': event.kind,
        'gen_ai.system': event.provider ?? undefined,
        'gen_ai.request.model': event.model ?? undefined,
        'gen_ai.usage.input_tokens': event.input_tokens ?? undefined,
        'gen_ai.usage.output_tokens': event.output_tokens ?? undefined,
        'gen_ai.usage.cost_usd': event.cost_usd ?? undefined,
      },
    },
  };
}
