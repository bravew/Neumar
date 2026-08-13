import { createLogger } from '@/shared/utils/logger';

import type { TraceEvent } from '../trace';
import type { TraceExporter } from './types';

const logger = createLogger('TraceExporters');

const exporters = new Map<string, TraceExporter>();

export function registerTraceExporter(exporter: TraceExporter): () => void {
  exporters.set(exporter.name, exporter);
  return () => {
    exporters.delete(exporter.name);
  };
}

export function listTraceExporters(): TraceExporter[] {
  return Array.from(exporters.values());
}

/**
 * Fan an event out to every registered exporter without blocking the
 * caller. Failures are logged and swallowed — observability must never
 * break task execution.
 */
export function dispatchTraceEvent(event: TraceEvent): void {
  if (exporters.size === 0) return;
  for (const exporter of exporters.values()) {
    queueMicrotask(() => {
      exporter.export(event).catch((err) => {
        logger.warn('Trace exporter failed', {
          exporter: exporter.name,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }
}

export async function flushAllExporters(): Promise<void> {
  await Promise.allSettled(
    Array.from(exporters.values()).map((exporter) =>
      exporter.flush ? exporter.flush() : Promise.resolve(),
    ),
  );
}

/** Test-only: clear registered exporters. */
export function _resetTraceExporters(): void {
  exporters.clear();
}
