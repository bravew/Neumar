import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiAdapter } from '@/shared/services/media-generation/adapters/gemini';
import {
  createAdapterForProvider,
  isImageModel,
  resolveAdapterName,
} from '@/shared/services/media-generation/registry';

vi.mock('@/shared/services/usage-logger', () => ({
  logUsage: vi.fn(),
}));

const config = {
  id: 'gemini',
  name: 'Google Gemini',
  baseUrl: 'https://openrouter.ai/api',
  apiKey: 'gemini-test-key',
  models: ['nano-banana'],
};

describe('Nano Banana media feature gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not expose Nano Banana models while the feature flag is off', () => {
    vi.stubEnv('NEUMA_PROVIDER_NANO_BANANA', '');

    expect(isImageModel('nano-banana')).toBe(false);
    expect(resolveAdapterName('use nano banana')).toBeNull();
    expect(createAdapterForProvider(config)).toBeNull();
  });

  it('routes Nano Banana models through Gemini when the feature flag is on', () => {
    vi.stubEnv('NEUMA_PROVIDER_NANO_BANANA', '1');

    expect(isImageModel('nano-banana')).toBe(true);
    expect(resolveAdapterName('use nano banana')).toBe('Google Gemini');
    expect(createAdapterForProvider(config)?.name).toBe('Google Gemini');
  });
});

describe('GeminiAdapter Nano Banana image generation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('NEUMA_PROVIDER_NANO_BANANA', '1');
    fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  images: [
                    {
                      image_url: {
                        url: 'data:image/png;base64,AAAA',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('keeps the configured Nano Banana model instead of falling back to Imagen', async () => {
    const adapter = new GeminiAdapter(config);

    const result = await adapter.generateImage({
      prompt: 'a product photo on white',
      aspectRatio: '1:1',
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('Google Gemini');
    expect(result.model).toBe('nano-banana');
    expect(result.images[0]?.url).toBe('data:image/png;base64,AAAA');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse((init as RequestInit).body as string) as {
      model?: string;
      image_config?: Record<string, string>;
    };
    expect(body.model).toBe('nano-banana');
    expect(body.image_config).toEqual({ aspect_ratio: '1:1' });
  });
});
