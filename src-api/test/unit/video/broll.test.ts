import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSetting } from '@/shared/db/operations';
import { NetworkPolicyDenied } from '@/shared/network-policy/fetch';
import {
  downloadBrollHit,
  searchBroll,
  type BrollHit,
} from '@/shared/video/broll';
import { createProject, getProject } from '@/shared/video/store';

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  NetworkPolicyDenied: class NetworkPolicyDenied extends Error {
    readonly reason: string;
    readonly url: string;

    constructor(url: string, reason: string) {
      super(`Network policy denied ${url}: ${reason}`);
      this.name = 'NetworkPolicyDenied';
      this.url = url;
      this.reason = reason;
    }
  },
}));

vi.mock('@/shared/network-policy/fetch', () => ({
  safeFetch: mocks.safeFetch,
  NetworkPolicyDenied: mocks.NetworkPolicyDenied,
}));

describe('video b-roll providers', () => {
  let workDir: string;

  beforeEach(async () => {
    mocks.safeFetch.mockReset();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-broll-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    vi.stubEnv('PEXELS_API_KEY', '');
    vi.stubEnv('PIXABAY_API_KEY', '');
    vi.stubEnv('STORYBLOCKS_PUBLIC_KEY', '');
    vi.stubEnv('STORYBLOCKS_PRIVATE_KEY', '');
    setSetting('workDir', workDir);
    setSetting('providers', '[]');
    setSetting('video.plugins', 'true');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('returns no hits when provider credentials are absent', async () => {
    await expect(
      searchBroll({ query: 'team working', provider: 'pexels' }),
    ).resolves.toEqual([]);
    expect(mocks.safeFetch).not.toHaveBeenCalled();
  });

  it('maps Pexels video search results with source and attribution metadata', async () => {
    vi.stubEnv('PEXELS_API_KEY', 'pexels-test-key');
    mocks.safeFetch.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        JSON.stringify({
          videos: [
            {
              id: 1448735,
              width: 4096,
              height: 2160,
              url: 'https://www.pexels.com/video/video-of-forest-1448735/',
              image: 'https://images.pexels.com/videos/1448735/poster.jpg',
              duration: 32,
              user: {
                name: 'Ruvim Miksanskiy',
                url: 'https://www.pexels.com/@digitech',
              },
              video_files: [
                {
                  id: 58649,
                  quality: 'sd',
                  file_type: 'video/mp4',
                  width: 640,
                  height: 338,
                  link: 'https://player.vimeo.com/external/291648067.sd.mp4',
                },
                {
                  id: 58650,
                  quality: 'hd',
                  file_type: 'video/mp4',
                  width: 2048,
                  height: 1080,
                  link: 'https://player.vimeo.com/external/291648067.hd.mp4',
                },
              ],
            },
          ],
        }),
      ),
      finalUrl: 'https://api.pexels.com/v1/videos/search?query=forest',
      redirectChain: [],
    });

    const hits = await searchBroll({
      query: 'forest',
      provider: 'pexels',
      orientation: 'landscape',
      limit: 1,
    });

    expect(mocks.safeFetch).toHaveBeenCalledTimes(1);
    const [url, policy, init] = mocks.safeFetch.mock.calls[0]!;
    expect(String(url)).toContain('/v1/videos/search');
    expect(init.headers.Authorization).toBe('pexels-test-key');
    expect(policy).toMatchObject({ default: 'deny' });
    expect(hits[0]).toMatchObject({
      provider: 'pexels',
      downloadUrl: 'https://player.vimeo.com/external/291648067.hd.mp4',
      width: 2048,
      height: 1080,
      license: 'Pexels License',
      attribution: 'Video by Ruvim Miksanskiy on Pexels',
      attributionRequired: false,
      sourceUrl: 'https://www.pexels.com/video/video-of-forest-1448735/',
      providerLinkLabel: 'Videos provided by Pexels',
    });
  });

  it('caches Pixabay search responses for repeated identical requests', async () => {
    vi.stubEnv('PIXABAY_API_KEY', 'pixabay-test-key');
    mocks.safeFetch.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        JSON.stringify({
          hits: [
            {
              id: 125,
              pageURL: 'https://pixabay.com/videos/id-125/',
              tags: 'flowers, yellow',
              duration: 12,
              user_id: 1281706,
              user: 'Coverr-Free-Footage',
              videos: {
                medium: {
                  url: 'https://cdn.pixabay.com/video/125_medium.mp4',
                  width: 1280,
                  height: 720,
                  size: 100,
                  thumbnail: 'https://cdn.pixabay.com/video/125_medium.jpg',
                },
              },
            },
          ],
        }),
      ),
      finalUrl: 'https://pixabay.com/api/videos/?q=flowers',
      redirectChain: [],
    });

    const first = await searchBroll({
      query: 'flowers',
      provider: 'pixabay',
      limit: 1,
    });
    const second = await searchBroll({
      query: 'flowers',
      provider: 'pixabay',
      limit: 1,
    });

    expect(mocks.safeFetch).toHaveBeenCalledTimes(1);
    expect(first[0]).toMatchObject({
      provider: 'pixabay',
      downloadUrl: 'https://cdn.pixabay.com/video/125_medium.mp4',
      license: 'Pixabay Content License',
      attributionRequired: false,
      sourceUrl: 'https://pixabay.com/videos/id-125/',
    });
    expect(second).toEqual(first);
  });

  it('downloads a hit under project assets and writes provenance', async () => {
    const project = await createProject({
      name: 'B-roll download',
      template: 'slideshow',
    });
    const hit = pexelsHit();
    mocks.safeFetch.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      body: Buffer.from('mp4 bytes'),
      finalUrl: hit.downloadUrl,
      redirectChain: [hit.downloadUrl],
    });

    const result = await downloadBrollHit(project.id, hit);

    expect(mocks.safeFetch).toHaveBeenCalledWith(
      hit.downloadUrl,
      expect.objectContaining({ default: 'deny' }),
      expect.objectContaining({
        maxBytes: 500 * 1024 * 1024,
        maxRedirects: 2,
      }),
    );
    expect(result.asset).toMatchObject({
      kind: 'video',
      source: 'broll',
      provenance: {
        provider: 'pexels',
        hitId: hit.id,
        sourceUrl: hit.sourceUrl,
        attribution: hit.attribution,
        commercialUse: true,
      },
    });
    await expect(
      fs.readFile(path.join(workDir, result.asset.path), 'utf8'),
    ).resolves.toBe('mp4 bytes');
    await expect(getProject(project.id)).resolves.toMatchObject({
      assets: [expect.objectContaining({ id: result.asset.id })],
    });
  });

  it('rejects policy-denied downloads without registering an asset', async () => {
    const project = await createProject({
      name: 'Denied b-roll',
      template: 'slideshow',
    });
    mocks.safeFetch.mockRejectedValueOnce(
      new NetworkPolicyDenied('https://127.0.0.1/leak.mp4', 'private IP'),
    );

    await expect(
      downloadBrollHit(project.id, pexelsHit()),
    ).rejects.toBeInstanceOf(NetworkPolicyDenied);
    await expect(getProject(project.id)).resolves.toMatchObject({ assets: [] });
  });

  it('rejects oversized and non-video downloads', async () => {
    const project = await createProject({
      name: 'Rejected b-roll',
      template: 'slideshow',
    });
    mocks.safeFetch.mockRejectedValueOnce(
      new Error('Response exceeded 524288000 bytes'),
    );

    await expect(downloadBrollHit(project.id, pexelsHit())).rejects.toThrow(
      'Response exceeded',
    );

    mocks.safeFetch.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      body: Buffer.from('jpeg'),
      finalUrl: pexelsHit().downloadUrl,
      redirectChain: [],
    });
    await expect(downloadBrollHit(project.id, pexelsHit())).rejects.toThrow(
      'unsupported content-type',
    );
  });
});

function pexelsHit(): BrollHit {
  return {
    id: '1448735',
    provider: 'pexels',
    previewUrl: 'https://images.pexels.com/videos/1448735/poster.jpg',
    thumbnailUrl: 'https://images.pexels.com/videos/1448735/poster.jpg',
    downloadUrl: 'https://player.vimeo.com/external/291648067.hd.mp4',
    widths: [2048],
    width: 2048,
    height: 1080,
    durationSec: 32,
    license: 'Pexels License',
    attribution: 'Video by Ruvim Miksanskiy on Pexels',
    attributionRequired: true,
    commercialUse: true,
    sourceUrl: 'https://www.pexels.com/video/video-of-forest-1448735/',
    sourceDisplayName: 'Video by Ruvim Miksanskiy on Pexels',
    query: 'forest',
  };
}
