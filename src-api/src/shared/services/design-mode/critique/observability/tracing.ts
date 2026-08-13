import { createLogger } from '@/shared/utils/logger';

export interface CritiqueSpanHandle {
  setAttribute(name: string, value: string | number | boolean): void;
  end(): void;
}

interface OtelSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

interface OtelTracer {
  startSpan(
    name: string,
    options: { attributes: Record<string, string | number | boolean> },
  ): OtelSpan;
}

interface OtelApiModule {
  trace: { getTracer(name: string): OtelTracer };
}

const logger = createLogger('CritiqueTheater');

export function isCritiqueTracingEnabled() {
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
}

export async function startCritiqueRunSpan(
  runId: string,
): Promise<CritiqueSpanHandle> {
  if (!isCritiqueTracingEnabled()) return noopSpan;
  try {
    const api = (await dynamicImport('@opentelemetry/api')) as OtelApiModule;
    const tracer = api.trace.getTracer('neuma.design-mode.critique');
    const span = tracer.startSpan('critique.run', {
      attributes: { 'neuma.critique.run_id': runId },
    });
    return {
      setAttribute(name, value) {
        span.setAttribute(name, value);
      },
      end() {
        span.end();
      },
    };
  } catch (error) {
    logger.warn('critique.tracing.unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return noopSpan;
  }
}

const noopSpan: CritiqueSpanHandle = {
  setAttribute() {},
  end() {},
};

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;
