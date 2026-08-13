import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FalMediaAdapter } from '@/shared/services/media-generation/adapters/fal';
import {
  createAdapterForProvider,
  isImageModel,
  isVideoModel,
} from '@/shared/services/media-generation/registry';

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
}));

vi.mock('@/shared/network-policy/fetch', () => ({
  safeFetch: mocks.safeFetch,
}));

vi.mock('@/shared/network-policy/schema', () => ({
  externalApiPolicy: vi.fn(() => ({ id: 'external-api' })),
}));

function jsonResponse(value: unknown, status = 200) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(value)),
    finalUrl: 'https://queue.fal.run/fal-ai/flux/dev',
    redirectChain: [],
  };
}

describe('fal.ai media adapter', () => {
  beforeEach(() => {
    mocks.safeFetch.mockReset();
  });

  it('queues and polls image generation through fal queue endpoints', async () => {
    mocks.safeFetch
      .mockResolvedValueOnce(jsonResponse({ request_id: 'req_1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        jsonResponse({
          images: [{ url: 'https://cdn.fal.ai/image.png' }],
          metrics: { total_cost_usd: 0.02 },
        }),
      );

    const adapter = new FalMediaAdapter(providerConfig);
    const result = await adapter.generateImage({
      prompt: 'studio headphones',
      model: 'fal:fal-ai/flux/dev',
      count: 2,
      size: '1024x1024',
    });

    expect(result.success).toBe(true);
    expect(result.providerId).toBe('fal');
    expect(result.model).toBe('fal-ai/flux/dev');
    expect(result.images[0]?.url).toBe('https://cdn.fal.ai/image.png');
    expect(result.usage?.total_cost_usd).toBe(0.02);

    const [url, policy, init] = mocks.safeFetch.mock.calls[0]!;
    expect(url).toBe('https://queue.fal.run/fal-ai/flux/dev');
    expect(policy).toEqual({ id: 'external-api' });
    expect(init.headers.authorization).toBe('Key fal-key');
    expect(JSON.parse(init.body)).toMatchObject({
      input: {
        prompt: 'studio headphones',
        num_images: 2,
        image_size: '1024x1024',
      },
    });
  });

  it('passes abort signals through image queue and polling requests', async () => {
    mocks.safeFetch
      .mockResolvedValueOnce(jsonResponse({ request_id: 'req_signal' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        jsonResponse({ images: [{ url: 'https://cdn.fal.ai/image.png' }] }),
      );
    const controller = new AbortController();

    const adapter = new FalMediaAdapter(providerConfig);
    const result = await adapter.generateImage({
      prompt: 'studio lamp',
      signal: controller.signal,
    });

    expect(result.success).toBe(true);
    expect(mocks.safeFetch).toHaveBeenCalledTimes(3);
    expect(mocks.safeFetch.mock.calls[0]![2].signal).toBe(controller.signal);
    expect(mocks.safeFetch.mock.calls[1]![2].signal).toBe(controller.signal);
    expect(mocks.safeFetch.mock.calls[2]![2].signal).toBe(controller.signal);
  });

  it('does not queue image work when the caller already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const adapter = new FalMediaAdapter(providerConfig);
    const result = await adapter.generateImage({
      prompt: 'cancelled image',
      signal: controller.signal,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/aborted/);
    expect(mocks.safeFetch).not.toHaveBeenCalled();
  });

  it('encodes the fal endpoint into video task ids for polling', async () => {
    mocks.safeFetch
      .mockResolvedValueOnce(jsonResponse({ request_id: 'video_req_1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        jsonResponse({ video: { url: 'https://cdn.fal.ai/video.mp4' } }),
      );

    const adapter = new FalMediaAdapter(providerConfig);
    const created = await adapter.createVideoTask({
      prompt: 'slow product spin',
      aspectRatio: '16:9',
      duration: 5,
    });
    const status = await adapter.getVideoTaskStatus(created.taskId);

    expect(created.success).toBe(true);
    expect(created.taskId).toMatch(/^fal:/);
    expect(status.status).toBe('succeeded');
    expect(status.videoUrl).toBe('https://cdn.fal.ai/video.mp4');
    expect(mocks.safeFetch.mock.calls[1]![0]).toBe(
      'https://queue.fal.run/fal-ai/veo3/fast/requests/video_req_1/status',
    );
  });

  it('is discoverable through the media registry', () => {
    const adapter = createAdapterForProvider(providerConfig);

    expect(adapter).toBeInstanceOf(FalMediaAdapter);
    expect(isImageModel('fal:fal-ai/flux/dev')).toBe(true);
    expect(isVideoModel('fal:fal-ai/veo3/fast')).toBe(true);
  });

  it('rejects local fal base URLs before issuing requests', () => {
    expect(
      () =>
        new FalMediaAdapter({
          ...providerConfig,
          baseUrl: 'http://localhost:5126',
        }),
    ).toThrow(/HTTPS/);
    expect(
      () =>
        new FalMediaAdapter({
          ...providerConfig,
          baseUrl: 'https://localhost:5126',
        }),
    ).toThrow(/localhost or private/);
  });
});

const providerConfig = {
  id: 'fal',
  name: 'fal.ai',
  apiKey: 'fal-key',
  baseUrl: 'https://queue.fal.run',
  models: ['fal:fal-ai/flux/dev', 'fal:fal-ai/veo3/fast'],
};
