import { describe, expect, it } from 'vitest';

import {
  SourceIngestError,
  extractUrls,
  fetchSource,
} from '@/shared/video/source/ingest';

describe('extractUrls', () => {
  it('returns an empty list for empty input', () => {
    expect(extractUrls('')).toEqual([]);
  });

  it('extracts in order, dedupes, and respects the max cap', () => {
    const text = `
      first https://example.com/a
      again https://example.com/a (skip)
      second http://example.com/b.
      third  https://foo.test/c?x=1
      fourth https://bar.test/d
    `;
    expect(extractUrls(text, 3)).toEqual([
      'https://example.com/a',
      'http://example.com/b',
      'https://foo.test/c?x=1',
    ]);
  });

  it('trims trailing punctuation that is not part of the URL', () => {
    expect(extractUrls('see https://example.com/page!')).toEqual([
      'https://example.com/page',
    ]);
  });
});

describe('fetchSource pre-flight', () => {
  it('rejects http:// URLs with a fetch-failed error, not a misleading ssrf-denied', async () => {
    await expect(fetchSource('http://example.com/page')).rejects.toMatchObject({
      name: 'SourceIngestError',
      code: 'fetch-failed',
    });
  });

  it('exposes SourceIngestError as a discriminated error class', () => {
    const err = new SourceIngestError('extraction-empty', 'nope');
    expect(err.code).toBe('extraction-empty');
  });
});
