import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BytePlusAdapter } from '@/shared/services/media-generation/adapters/byteplus';

vi.mock('@/shared/services/usage-logger', () => ({
  logUsage: vi.fn(),
}));

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('BytePlus media adapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse({ id: 'task-1', seed: 777 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends Seedance 2.0 first and last frame references with seed', async () => {
    const adapter = new BytePlusAdapter({
      id: 'byteplus',
      name: 'BytePlus',
      apiKey: 'test-key',
      baseUrl: 'https://ark.byteplusapi.com/api/v3',
      models: ['seedance-2-0-fast'],
    });

    const result = await adapter.createVideoTask({
      prompt: 'smooth reveal',
      referenceImageUrl: 'data:image/png;base64,first',
      referenceImageTailUrl: 'data:image/png;base64,last',
      duration: 3,
      resolution: '1080p',
      seed: 1234,
    });

    expect(result.success).toBe(true);
    expect(result.seed).toBe(777);
    const [_url, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as {
      content: Array<{
        type: string;
        role?: string;
        image_url?: { url: string };
      }>;
      duration: number;
      resolution: string;
      seed: number;
    };

    expect(body.duration).toBe(4);
    expect(body.resolution).toBe('720p');
    expect(body.seed).toBe(1234);
    expect(body.content[1]).toMatchObject({
      type: 'image_url',
      role: 'first_frame',
      image_url: { url: 'data:image/png;base64,first' },
    });
    expect(body.content[2]).toMatchObject({
      type: 'image_url',
      role: 'last_frame',
      image_url: { url: 'data:image/png;base64,last' },
    });
  });

  it('creates OmniHuman lipsync tasks when an OmniHuman model is configured', async () => {
    const adapter = new BytePlusAdapter({
      id: 'omnihuman',
      name: 'BytePlus OmniHuman',
      apiKey: 'test-key',
      baseUrl: 'https://ark.byteplusapi.com/api/v3',
      models: ['omnihuman-v1-5'],
    });

    const result = await adapter.createLipsyncTask({
      imageUrl: 'data:image/png;base64,face',
      audio: { base64: 'audio' },
      text: 'read this line',
      aspectRatio: '9:16',
      motionScale: 0.7,
    });

    expect(result.success).toBe(true);
    const [_url, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as {
      model: string;
      ratio: string;
      motion_scale: number;
      content: Array<Record<string, unknown>>;
    };

    expect(body.model).toBe('omnihuman-v1-5');
    expect(body.ratio).toBe('9:16');
    expect(body.motion_scale).toBe(0.7);
    expect(body.content[1]).toMatchObject({
      type: 'image_url',
      role: 'reference_image',
      image_url: { url: 'data:image/png;base64,face' },
    });
    expect(body.content[2]).toMatchObject({
      type: 'input_audio',
      role: 'voice_track',
      input_audio: { data: 'audio', format: 'wav' },
    });
  });
});
