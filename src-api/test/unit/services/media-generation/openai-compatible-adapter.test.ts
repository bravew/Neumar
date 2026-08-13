import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CustomOpenAIImageAdapter,
  ImageRouterAdapter,
} from '@/shared/services/media-generation/adapters/openai-compatible';

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
}));

vi.mock('@/shared/network-policy/fetch', () => ({
  safeFetch: mocks.safeFetch,
}));

vi.mock('@/shared/network-policy/schema', () => ({
  trustedLocalPolicy: vi.fn(() => ({ id: 'trusted-local' })),
}));

function jsonResponse(value: unknown, status = 200) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(value)),
    finalUrl: 'https://media.example/v1/images/generations',
    redirectChain: [],
  };
}

describe('OpenAI-compatible media adapters', () => {
  beforeEach(() => {
    mocks.safeFetch.mockReset();
  });

  it('composes OpenAI-shaped image generation bodies for custom-image', async () => {
    mocks.safeFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [{ b64_json: 'AAAA', revised_prompt: 'better prompt' }],
        usage: { total_tokens: 12 },
      }),
    );

    const adapter = new CustomOpenAIImageAdapter({
      id: 'custom-image',
      name: 'Self-hosted SDXL',
      apiKey: 'test-key',
      baseUrl: 'https://media.example',
      models: ['custom-image:sdxl'],
    });
    const result = await adapter.generateImage({
      prompt: 'studio headphones',
      model: 'custom-image:sdxl',
      size: '1024x1024',
      count: 2,
    });

    expect(result.success).toBe(true);
    expect(result.providerId).toBe('custom-image');
    expect(result.model).toBe('sdxl');
    expect(result.images[0]?.url).toBe('data:image/png;base64,AAAA');

    const [url, _policy, init] = mocks.safeFetch.mock.calls[0]!;
    expect(url).toBe('https://media.example/v1/images/generations');
    expect(init.headers.authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'sdxl',
      prompt: 'studio headphones',
      n: 2,
      response_format: 'b64_json',
      size: '1024x1024',
    });
  });

  it('routes custom-image edits through the compatible JSON edits endpoint', async () => {
    mocks.safeFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [{ b64_json: 'BBBB' }],
      }),
    );

    const adapter = new CustomOpenAIImageAdapter({
      id: 'custom-image',
      name: 'Self-hosted SDXL',
      apiKey: 'test-key',
      baseUrl: 'https://media.example',
      models: ['custom-image:sdxl'],
    });
    const result = await adapter.generateImage({
      prompt: 'make the headphones red',
      model: 'custom-image:sdxl',
      referenceImageUrl: 'https://assets.example/headphones.png',
    });

    expect(result.success).toBe(true);
    expect(adapter.supportsImageEdit).toBe(true);

    const [url, _policy, init] = mocks.safeFetch.mock.calls[0]!;
    expect(url).toBe('https://media.example/v1/images/edits');
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'sdxl',
      prompt: 'make the headphones red',
      response_format: 'b64_json',
      images: [{ image_url: 'https://assets.example/headphones.png' }],
    });
  });

  it('supports ImageRouter async video create and status polling', async () => {
    mocks.safeFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'task_1' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'succeeded',
          video_url: 'https://cdn.example/video.mp4',
        }),
      );

    const adapter = new ImageRouterAdapter({
      id: 'imagerouter',
      name: 'ImageRouter',
      apiKey: 'router-key',
      baseUrl: 'https://api.imagerouter.io/v1/openai',
      models: ['imagerouter:video'],
    });

    const created = await adapter.createVideoTask({
      prompt: 'slow product spin',
      model: 'imagerouter:video',
      aspectRatio: '16:9',
    });
    const status = await adapter.getVideoTaskStatus(created.taskId);

    expect(created.success).toBe(true);
    expect(created.providerId).toBe('imagerouter');
    expect(created.taskId).toBe('task_1');
    expect(status.status).toBe('succeeded');
    expect(status.videoUrl).toBe('https://cdn.example/video.mp4');
    expect(mocks.safeFetch.mock.calls[0]![0]).toBe(
      'https://api.imagerouter.io/v1/openai/videos/generations',
    );
    expect(mocks.safeFetch.mock.calls[1]![0]).toBe(
      'https://api.imagerouter.io/v1/openai/videos/generations/task_1',
    );
  });

  it('normalizes upstream HTTP errors', async () => {
    mocks.safeFetch.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'quota exceeded' } }, 429),
    );

    const adapter = new CustomOpenAIImageAdapter({
      id: 'custom-image',
      name: 'Self-hosted SDXL',
      apiKey: 'test-key',
      baseUrl: 'https://media.example',
      models: ['custom-image:sdxl'],
    });
    const result = await adapter.generateImage({
      prompt: 'studio headphones',
      model: 'custom-image:sdxl',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('quota_exceeded');
  });
});
