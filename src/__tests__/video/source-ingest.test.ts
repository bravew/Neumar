import { afterEach, describe, expect, it, vi } from 'vitest';

import { ingestSource } from '@/shared/video/source-ingest';

// Phase 4 M2 — client for POST /video/source/fetch. Mocks global fetch.

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ingestSource', () => {
  it('returns the source on a 200', async () => {
    const source = {
      url: 'https://example.com',
      title: 'T',
      markdown: 'm',
      kind: 'article' as const,
      truncated: false,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ source })));

    const result = await ingestSource('https://example.com');
    expect(result).toEqual({ ok: true, source });
  });

  it('maps a known error code from the error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: 'oversized-body' }, false, 413),
        ),
    );

    const result = await ingestSource('https://example.com');
    expect(result).toEqual({ ok: false, code: 'oversized-body' });
  });

  it('falls back to "unknown" for an unrecognized error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'weird' }, false, 500)),
    );

    const result = await ingestSource('https://example.com');
    expect(result).toEqual({ ok: false, code: 'unknown' });
  });

  it('returns fetch-failed when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

    const result = await ingestSource('https://example.com');
    expect(result).toEqual({ ok: false, code: 'fetch-failed' });
  });
});
