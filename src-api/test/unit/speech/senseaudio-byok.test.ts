import { afterEach, describe, expect, it, vi } from 'vitest';

import { SenseAudioSpeechAdapter } from '@/shared/services/speech/adapters/senseaudio';

const baseConfig = {
  id: 'senseaudio',
  name: 'SenseAudio',
  baseUrl: 'https://api.senseaudio.cn',
  apiKey: 'senseaudio-test-key',
  models: ['senseaudio-tts-1.5-260319'],
};

function okAudioResponse(): Response {
  return new Response(
    JSON.stringify({
      data: { audio: Buffer.from('ok').toString('hex') },
      base_resp: { status_code: 0, status_msg: 'success' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('SenseAudio BYOK TTS hardening', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not double-append /v1 when the configured base URL is versioned', async () => {
    const fetchMock = vi.fn(async () => okAudioResponse());
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new SenseAudioSpeechAdapter({
      ...baseConfig,
      baseUrl: 'https://api.senseaudio.cn/v1/',
    });

    const result = await adapter.synthesize({ text: 'Hello' });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.senseaudio.cn/v1/t2a_v2',
    );
  });

  it('preserves structured failure kind for BYOK TTS failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('rate limited', {
            status: 429,
          }),
      ),
    );

    const result = await new SenseAudioSpeechAdapter(baseConfig).synthesize({
      text: 'Hello',
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('rate_limited');
    expect(result.error).toContain('429');
  });
});
