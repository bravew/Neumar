import { afterEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import * as flags from '@/shared/video/flags';
import * as ingest from '@/shared/video/source/ingest';
import { SourceIngestError } from '@/shared/video/source/ingest';

// Phase 4 M2/M3 — POST /video/source/fetch (composer URL ingestion). Both the
// feature flag and the network fetch are mocked so the test is deterministic
// and offline; the SSRF-safe fetch itself is covered elsewhere.

vi.mock('@/shared/video/flags', async (orig) => {
  const actual = await orig<typeof import('@/shared/video/flags')>();
  return { ...actual, getVideoFeatureFlag: vi.fn() };
});
vi.mock('@/shared/video/source/ingest', async (orig) => {
  const actual = await orig<typeof import('@/shared/video/source/ingest')>();
  return { ...actual, fetchSource: vi.fn() };
});

const getFlag = vi.mocked(flags.getVideoFeatureFlag);
const fetchSource = vi.mocked(ingest.fetchSource);

function post(body: unknown) {
  return videoRoutes.request('/source/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /video/source/fetch', () => {
  it('returns 403 when the sourceIngestion flag is off', async () => {
    getFlag.mockReturnValue(false);
    const res = await post({ url: 'https://example.com' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: 'source-ingestion-disabled',
    });
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid URL (zValidator)', async () => {
    getFlag.mockReturnValue(true);
    const res = await post({ url: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('returns the source plus provenance on success', async () => {
    getFlag.mockReturnValue(true);
    fetchSource.mockResolvedValue({
      url: 'https://example.com/post',
      title: 'A Post',
      markdown: 'body',
      kind: 'article',
      truncated: false,
    });

    const res = await post({ url: 'https://example.com/post' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      source: { title: string };
      provenance: { provider: string; sourceUrl: string };
    };
    expect(json.source.title).toBe('A Post');
    expect(json.provenance).toMatchObject({
      provider: 'video-source-ingest',
      sourceUrl: 'https://example.com/post',
    });
  });

  it('maps each SourceIngestError code to the right status', async () => {
    getFlag.mockReturnValue(true);
    const cases: Array<[SourceIngestError['code'], number]> = [
      ['ssrf-denied', 403],
      ['unsupported-content-type', 415],
      ['oversized-body', 413],
      ['extraction-empty', 422],
      ['fetch-failed', 502],
    ];
    for (const [code, status] of cases) {
      fetchSource.mockRejectedValueOnce(new SourceIngestError(code, code));
      const res = await post({ url: 'https://example.com' });
      expect(res.status, `code ${code}`).toBe(status);
      expect(await res.json()).toMatchObject({ error: code });
    }
  });
});
