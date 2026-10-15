import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateImage } from '@/extensions/agent/openai-compat/media';

/**
 * Boundary test for the provider-returned image download in `generateImage`.
 *
 * The URL comes back from the image provider, so it is untrusted. The download
 * must go through `safeFetch` with a policy that resolves and classifies the
 * destination address, plus an explicit timeout and byte cap, instead of a
 * plain `fetch()` with neither.
 */

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  imagesGenerate: vi.fn(),
}));

vi.mock('@/shared/network-policy/fetch', () => ({
  NetworkPolicyDenied: class NetworkPolicyDenied extends Error {
    readonly reason: string;
    readonly url: string;
    constructor(url: string, reason: string) {
      super(`Network policy denied ${url}: ${reason}`);
      this.name = 'NetworkPolicyDenied';
      this.reason = reason;
      this.url = url;
    }
  },
  safeFetch: mocks.safeFetch,
}));

vi.mock('@/shared/network-policy/schema', () => ({
  externalApiPolicy: vi.fn(() => ({ id: 'external-api' })),
}));

vi.mock('openai', () => ({
  default: class OpenAI {
    images = { generate: mocks.imagesGenerate };
  },
}));

describe('generateImage provider asset download', () => {
  beforeEach(() => {
    mocks.safeFetch.mockReset();
    mocks.imagesGenerate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads the provider image through the network policy', async () => {
    mocks.imagesGenerate.mockResolvedValue({
      data: [{ url: 'https://cdn.example/generated.png' }],
    });
    mocks.safeFetch.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('image-bytes'),
      finalUrl: 'https://cdn.example/generated.png',
      redirectChain: ['https://cdn.example/generated.png'],
    });

    const result = await generateImage(
      'a lighthouse at dusk',
      '/tmp/neuma-media-download-test',
      'api-key',
      'https://ark.example/api/v3',
    );

    expect(result.isError).toBe(false);
    expect(mocks.safeFetch).toHaveBeenCalledTimes(1);
    const [url, policy, options] = mocks.safeFetch.mock.calls[0]!;
    expect(url).toBe('https://cdn.example/generated.png');
    expect(policy).toEqual({ id: 'external-api' });
    expect(options).toMatchObject({
      timeoutMs: expect.any(Number),
      maxBytes: expect.any(Number),
    });
  });

  it('reports a policy-denied image URL instead of writing a file', async () => {
    mocks.imagesGenerate.mockResolvedValue({
      data: [{ url: 'http://169.254.169.254/latest/meta-data/' }],
    });
    const { NetworkPolicyDenied } =
      await import('@/shared/network-policy/fetch');
    mocks.safeFetch.mockRejectedValue(
      new NetworkPolicyDenied(
        'http://169.254.169.254/latest/meta-data/',
        'DNS answer 169.254.169.254 is metadata',
      ),
    );

    const result = await generateImage(
      'a lighthouse at dusk',
      '/tmp/neuma-media-download-test',
      'api-key',
      'https://ark.example/api/v3',
    );

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/network policy/i);
    expect(result.output).toMatch(/metadata/);
  });
});
