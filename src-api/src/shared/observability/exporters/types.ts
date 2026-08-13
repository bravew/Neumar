import type { TraceEvent } from '@/shared/observability/trace';

/**
 * Adapter contract for exporting persisted trace events to an external
 * observability backend (Langfuse, Helicone, OTLP, ...).
 *
 * Exporters must:
 *   - never throw synchronously into `export()` callers
 *   - export only redacted fields supplied by the caller (no raw prompts)
 *   - be safe to call concurrently
 */
export interface TraceExporter {
  name: string;
  export(event: TraceEvent): Promise<void>;
  flush?(): Promise<void>;
}
