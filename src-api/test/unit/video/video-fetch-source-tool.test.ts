import { afterEach, describe, expect, it, vi } from 'vitest';

import { createVideoEditTools } from '@/shared/mcp/video-edit-server';
import * as ingest from '@/shared/video/source/ingest';
import { SourceIngestError } from '@/shared/video/source/ingest';

// Phase 4 M2 — `video_fetch_source` MCP read tool. Mocks `fetchSource` so the
// test never touches the network; the SSRF-safe fetch itself is covered by the
// source-ingest unit tests.

vi.mock('@/shared/video/source/ingest', async (orig) => {
  const actual = await orig<typeof import('@/shared/video/source/ingest')>();
  return { ...actual, fetchSource: vi.fn() };
});

const fetchSource = vi.mocked(ingest.fetchSource);

function tool() {
  const found = createVideoEditTools().find(
    (t) => t.name === 'video_fetch_source',
  );
  if (!found) throw new Error('video_fetch_source not registered');
  return found;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('video_fetch_source MCP tool', () => {
  it('is registered as a tool', () => {
    expect(tool().name).toBe('video_fetch_source');
  });

  it('returns the extracted source plus a provenance partial', async () => {
    fetchSource.mockResolvedValue({
      url: 'https://example.com/post',
      title: 'A Post',
      markdown: '# A Post\n\nBody text.',
      kind: 'article',
      truncated: false,
    });

    const result = await tool().handler(
      { url: 'https://example.com/post' },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload.source).toMatchObject({
      url: 'https://example.com/post',
      title: 'A Post',
      kind: 'article',
    });
    expect(payload.provenance).toMatchObject({
      provider: 'video-source-ingest',
      sourceUrl: 'https://example.com/post',
      sourceDisplayName: 'A Post',
    });
    expect(typeof payload.provenance.sourceFetchedAt).toBe('string');
    expect(result.isError).toBeUndefined();
  });

  it('surfaces a typed SourceIngestError code back to the agent', async () => {
    fetchSource.mockRejectedValue(
      new SourceIngestError('ssrf-denied', 'blocked private address'),
    );

    const result = await tool().handler(
      { url: 'https://169.254.169.254/' },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('ssrf-denied');
  });
});
