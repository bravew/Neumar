import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HedraAdapter } from '@/shared/services/media-generation/adapters/hedra';

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Hedra media adapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'image-asset' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'audio-asset' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'generation-1' }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates image and audio assets before starting a lipsync generation', async () => {
    const signal = new AbortController().signal;
    const adapter = new HedraAdapter({
      id: 'hedra',
      name: 'Hedra',
      apiKey: 'test-key',
      baseUrl: 'https://api.hedra.com/web-app/public',
      models: ['hedra:character-3'],
    });

    const result = await adapter.createLipsyncTask(
      {
        imageUrl: 'data:image/png;base64,face',
        audio: { base64: 'audio' },
        text: 'hello world',
        aspectRatio: '16:9',
        motionScale: 0.4,
      },
      signal,
    );

    expect(result.success).toBe(true);
    expect(result.taskId).toBe('generation-1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit | undefined)?.signal).toBeInstanceOf(
        AbortSignal,
      );
    }
    const generationCall = fetchMock.mock.calls[2]!;
    expect(generationCall[0]).toBe(
      'https://api.hedra.com/web-app/public/generations',
    );
    const body = JSON.parse((generationCall[1] as RequestInit).body as string);
    expect(body).toMatchObject({
      ai_model_id: 'hedra:character-3',
      start_keyframe_id: 'image-asset',
      audio_id: 'audio-asset',
      text_prompt: 'hello world',
      aspect_ratio: '16:9',
      motion_scale: 0.4,
    });
  });

  it('polls generation status and resolves the generated asset url', async () => {
    const signal = new AbortController().signal;
    fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ status: 'complete', asset_id: 'video-asset' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          assets: [{ id: 'video-asset', url: 'https://cdn.example/v.mp4' }],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new HedraAdapter({
      id: 'hedra',
      name: 'Hedra',
      apiKey: 'test-key',
      baseUrl: 'https://api.hedra.com/web-app/public',
      models: ['hedra:character-3'],
    });

    const status = await adapter.getVideoTaskStatus('generation-1', signal);

    expect(status.status).toBe('succeeded');
    expect(status.videoUrl).toBe('https://cdn.example/v.mp4');
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit | undefined)?.signal).toBeInstanceOf(
        AbortSignal,
      );
    }
  });
});
