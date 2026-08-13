import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LeonardoImageAdapter } from '@/shared/services/media-generation/adapters/leonardo';

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
}));

vi.mock('@/shared/network-policy/fetch', () => ({
  safeFetch: mocks.safeFetch,
}));

vi.mock('@/shared/network-policy/schema', () => ({
  trustedLocalPolicy: vi.fn(() => ({ id: 'trusted-local' })),
}));

const config = {
  id: 'leonardo',
  name: 'Leonardo.ai',
  apiKey: 'leo-test',
  baseUrl: 'https://cloud.leonardo.ai/api/rest/v1',
  models: ['leonardo-phoenix'],
};

function jsonResponse(value: unknown, status = 200) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(value)),
    finalUrl: 'https://cloud.leonardo.ai/api/rest/v1/generations',
    redirectChain: [],
  };
}

describe('LeonardoImageAdapter', () => {
  beforeEach(() => {
    mocks.safeFetch.mockReset();
  });

  it('starts a bearer-authenticated generation and polls for the image URL', async () => {
    mocks.safeFetch
      .mockResolvedValueOnce(
        jsonResponse({ sdGenerationJob: { generationId: 'gen_123' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          generations_by_pk: {
            status: 'COMPLETE',
            generated_images: [{ url: 'https://cdn.example/image.png' }],
          },
        }),
      );

    const adapter = new LeonardoImageAdapter(config);
    const result = await adapter.generateImage({
      prompt: 'a polished product render',
      model: 'leonardo-phoenix',
      aspectRatio: '16:9',
    });

    expect(result.success).toBe(true);
    expect(result.providerId).toBe('leonardo');
    expect(result.images[0]?.url).toBe('https://cdn.example/image.png');

    const [url, _policy, init] = mocks.safeFetch.mock.calls[0]!;
    expect(url).toBe('https://cloud.leonardo.ai/api/rest/v1/generations');
    expect(init.headers.authorization).toBe('Bearer leo-test');
    expect(JSON.parse(init.body).width).toBe(1280);
    expect(JSON.parse(init.body).height).toBe(720);
  });

  it('rejects unsupported aspect ratios before calling Leonardo', async () => {
    const adapter = new LeonardoImageAdapter(config);
    const result = await adapter.generateImage({
      prompt: 'cinematic city',
      model: 'leonardo-phoenix',
      aspectRatio: '21:9',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not support aspect ratio/i);
    expect(mocks.safeFetch).not.toHaveBeenCalled();
  });

  it('maps auth failures to Leonardo-specific error codes', async () => {
    mocks.safeFetch.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'bad key' } }, 401),
    );

    const adapter = new LeonardoImageAdapter(config);
    const result = await adapter.generateImage({
      prompt: 'a poster',
      model: 'leonardo-phoenix',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('LEONARDO_AUTH_FAILED');
  });
});
