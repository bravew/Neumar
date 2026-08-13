import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockNetworkPolicyDenied extends Error {
    readonly reason: string;
    readonly url: string;

    constructor(url: string, reason: string) {
      super(reason);
      this.reason = reason;
      this.url = url;
    }
  }

  return {
    safeFetch: vi.fn(),
    NetworkPolicyDenied: MockNetworkPolicyDenied,
  };
});

vi.mock('@/shared/utils/url-validator', () => ({
  safeFetch: mocks.safeFetch,
  NetworkPolicyDenied: mocks.NetworkPolicyDenied,
}));

import {
  extractVimeoVideoRef,
  extractYouTubeVideoId,
  getLinkPreview,
  parseHtmlPreview,
} from '@/shared/link-preview';

function response(body: string, contentType = 'application/json') {
  return {
    status: 200,
    headers: { 'content-type': contentType },
    body: Buffer.from(body),
    finalUrl: 'https://example.com/final',
    redirectChain: [],
  };
}

beforeEach(() => {
  mocks.safeFetch.mockReset();
});

describe('link preview service', () => {
  it('parses YouTube Shorts and builds a privacy-enhanced embed', async () => {
    mocks.safeFetch.mockResolvedValue(
      response(
        JSON.stringify({
          title: 'Match highlights',
          author_name: 'Titans',
          thumbnail_url: 'https://i.ytimg.com/vi/abc12345678/hqdefault.jpg',
          width: 480,
          height: 270,
        }),
      ),
    );

    const preview = await getLinkPreview(
      'https://www.youtube.com/shorts/abc12345678',
    );

    expect(preview).toMatchObject({
      kind: 'video',
      provider: 'youtube',
      title: 'Match highlights',
      embedUrl: 'https://www.youtube-nocookie.com/embed/abc12345678',
    });
    expect(mocks.safeFetch).toHaveBeenCalledOnce();
  });

  it('parses Vimeo unlisted hashes for player embeds', () => {
    const ref = extractVimeoVideoRef(
      new URL('https://vimeo.com/123456789/a1b2c3d4'),
    );

    expect(ref).toEqual({ id: '123456789', hash: 'a1b2c3d4' });
  });

  it('returns direct image previews without fetching the image body', async () => {
    const preview = await getLinkPreview('https://cdn.example.com/photo.webp');

    expect(preview).toMatchObject({
      kind: 'image',
      imageUrl: 'https://cdn.example.com/photo.webp',
    });
    expect(mocks.safeFetch).not.toHaveBeenCalled();
  });

  it('extracts Open Graph metadata and relative image URLs', () => {
    const preview = parseHtmlPreview(
      `
        <html>
          <head>
            <title>Fallback</title>
            <meta property="og:title" content="Game recap">
            <meta property="og:description" content="Full match recap">
            <meta property="og:image" content="/thumb.jpg">
          </head>
        </html>
      `,
      'https://news.example.com/story',
    );

    expect(preview).toMatchObject({
      kind: 'web',
      title: 'Game recap',
      description: 'Full match recap',
      imageUrl: 'https://news.example.com/thumb.jpg',
    });
  });

  it('recognizes common YouTube URL shapes', () => {
    expect(extractYouTubeVideoId(new URL('https://youtu.be/abc12345678'))).toBe(
      'abc12345678',
    );
    expect(
      extractYouTubeVideoId(
        new URL('https://www.youtube.com/watch?v=def12345678'),
      ),
    ).toBe('def12345678');
    expect(
      extractYouTubeVideoId(
        new URL('https://www.youtube.com/embed/ghi12345678'),
      ),
    ).toBe('ghi12345678');
  });
});
