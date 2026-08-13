import type { TraceEntry, TraceSummary } from '@/shared/hooks/useTraceStream';
import type {
  PersistedTraceEvent,
  TraceEventKind,
} from '@/shared/types/observability';

const KIND_TO_TYPE: Record<TraceEventKind, TraceEntry['type']> = {
  prompt_build: 'thinking',
  agent_run: 'llm',
  model_call: 'llm',
  tool_call: 'tool',
  artifact_write: 'tool',
  preview_verify: 'tool',
  approval: 'tool',
  hook: 'tool',
  error: 'error',
  budget: 'thinking',
  stream_start: 'thinking',
  stream_end: 'thinking',
  finalize: 'thinking',
};

function safeParse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const MANIFEST_KEYS = [
  'attachment_manifest',
  'artifact_manifest',
  'input_text_snapshot_manifest',
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function summarizeManifest(
  key: (typeof MANIFEST_KEYS)[number],
  manifest: unknown,
): string | null {
  if (!manifest || typeof manifest !== 'object') return null;
  const record = manifest as Record<string, unknown>;
  const entries = Array.isArray(record.entries) ? record.entries : [];
  const totalEntries =
    typeof record.totalEntries === 'number'
      ? record.totalEntries
      : entries.length;
  const totalByteSize =
    typeof record.totalByteSize === 'number'
      ? formatBytes(record.totalByteSize)
      : 'metadata only';
  const statuses = entries.reduce<Record<string, number>>((acc, entry) => {
    if (!entry || typeof entry !== 'object') return acc;
    const status = String(
      (entry as Record<string, unknown>).status ?? 'unknown',
    );
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  const statusText = Object.entries(statuses)
    .map(([status, count]) => `${status}:${count}`)
    .join(', ');
  const label = key.replace(/_/g, ' ');
  return `${label}: ${totalEntries} item${totalEntries === 1 ? '' : 's'}, ${totalByteSize}${
    statusText ? `, ${statusText}` : ''
  }`;
}

function describeManifestAttrs(
  attrs: Record<string, unknown> | null,
): string | null {
  if (!attrs) return null;
  const summaries = MANIFEST_KEYS.map((key) =>
    summarizeManifest(key, attrs[key]),
  ).filter((summary): summary is string => Boolean(summary));
  return summaries.length > 0 ? summaries.join('\n') : null;
}

function describeError(json: string | null): string | undefined {
  const parsed = safeParse(json);
  if (!parsed) return undefined;
  const message = parsed.message ?? parsed.error ?? parsed.msg;
  return typeof message === 'string'
    ? message
    : JSON.stringify(parsed).slice(0, 500);
}

function computeEventName(event: PersistedTraceEvent): string {
  if (event.tool) return event.tool;
  if (event.kind === 'model_call' && event.model) return event.model;
  if (event.kind === 'agent_run') return event.agent ?? 'agent';
  return event.kind;
}

export function adaptPersistedEvent(event: PersistedTraceEvent): TraceEntry {
  const type = KIND_TO_TYPE[event.kind] ?? 'llm';
  const attrs = safeParse(event.attrs_json);
  const manifestText = describeManifestAttrs(attrs);
  const errorText = describeError(event.error_json);
  const status: TraceEntry['status'] =
    event.status === 'running'
      ? 'running'
      : event.status === 'ok'
        ? 'completed'
        : 'error';

  const name = computeEventName(event);

  return {
    id: event.id,
    type,
    name,
    startedAt: event.started_at,
    duration: event.duration_ms ?? undefined,
    tokens:
      event.input_tokens != null || event.output_tokens != null
        ? {
            input: event.input_tokens ?? 0,
            output: event.output_tokens ?? 0,
            cacheRead: event.cache_read ?? undefined,
            cacheCreation: event.cache_creation ?? undefined,
          }
        : undefined,
    cost: event.cost_usd ?? undefined,
    model: event.model ?? undefined,
    status,
    parentId: event.parent_event_id ?? undefined,
    content:
      errorText ??
      manifestText ??
      (attrs ? JSON.stringify(attrs).slice(0, 800) : undefined),
  };
}

export function adaptPersistedEvents(events: PersistedTraceEvent[]): {
  entries: TraceEntry[];
  summary: TraceSummary;
} {
  const entries = events.map(adaptPersistedEvent);
  const summary: TraceSummary = {
    totalDuration: 0,
    totalTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    totalCost: 0,
    operationCount: entries.length,
    byType: {},
  };

  for (const entry of entries) {
    if (entry.duration) summary.totalDuration += entry.duration;
    if (entry.tokens) {
      summary.totalTokens.input += entry.tokens.input;
      summary.totalTokens.output += entry.tokens.output;
      summary.totalTokens.cacheRead += entry.tokens.cacheRead ?? 0;
      summary.totalTokens.cacheCreation += entry.tokens.cacheCreation ?? 0;
    }
    if (entry.cost) summary.totalCost += entry.cost;
    summary.byType[entry.type] = (summary.byType[entry.type] ?? 0) + 1;
  }

  return { entries, summary };
}
