import { API_BASE_URL } from '@/config';

// Phase 4 M2 — client for the composer URL-ingestion endpoint
// (`POST /video/source/fetch`). Mirrors the backend `SourceIngestError` codes
// so the caller can map a failure to a localized message.

export interface IngestedSource {
  url: string;
  title: string;
  markdown: string;
  kind: 'article' | 'repo';
  truncated: boolean;
}

export type SourceIngestErrorCode =
  | 'ssrf-denied'
  | 'fetch-failed'
  | 'unsupported-content-type'
  | 'oversized-body'
  | 'extraction-empty'
  // Returned when the `video.sourceIngestion` flag is off — the caller treats
  // this as a silent no-op rather than a user-facing error.
  | 'source-ingestion-disabled'
  | 'unknown';

export type IngestResult =
  | { ok: true; source: IngestedSource }
  | { ok: false; code: SourceIngestErrorCode };

const KNOWN_CODES: ReadonlySet<string> = new Set<SourceIngestErrorCode>([
  'ssrf-denied',
  'fetch-failed',
  'unsupported-content-type',
  'oversized-body',
  'extraction-empty',
  'source-ingestion-disabled',
]);

function normalizeCode(raw: string | undefined): SourceIngestErrorCode {
  return raw && KNOWN_CODES.has(raw)
    ? (raw as SourceIngestErrorCode)
    : 'unknown';
}

/** Fetch + extract readable text for a single URL via the server. */
export async function ingestSource(
  url: string,
  signal?: AbortSignal,
): Promise<IngestResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/video/source/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal,
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      return { ok: false, code: normalizeCode(payload.error) };
    }
    const json = (await res.json()) as { source: IngestedSource };
    return { ok: true, source: json.source };
  } catch {
    return { ok: false, code: 'fetch-failed' };
  }
}
