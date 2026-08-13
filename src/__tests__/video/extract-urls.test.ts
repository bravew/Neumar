import { describe, expect, it } from 'vitest';

import { extractUrls } from '@/shared/video/extract-urls';

describe('extractUrls (client)', () => {
  it('returns an empty array for blank input', () => {
    expect(extractUrls('')).toEqual([]);
    expect(extractUrls('no links here')).toEqual([]);
  });

  it('extracts https URLs in order and ignores http (server rejects it)', () => {
    expect(
      extractUrls('see https://a.com and http://b.org/x and https://c.io'),
    ).toEqual(['https://a.com', 'https://c.io']);
  });

  it('strips trailing sentence punctuation', () => {
    expect(extractUrls('read https://example.com/post.')).toEqual([
      'https://example.com/post',
    ]);
  });

  it('deduplicates and respects the max', () => {
    const text = 'https://a.com https://a.com https://b.com https://c.com';
    expect(extractUrls(text, 2)).toEqual(['https://a.com', 'https://b.com']);
  });
});
