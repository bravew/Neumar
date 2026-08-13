import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ElevenLabsSfxAdapter } from '@/shared/services/speech/adapters/elevenlabs-sfx';

const config = {
  id: 'elevenlabs',
  name: 'ElevenLabs',
  baseUrl: 'https://api.elevenlabs.io',
  apiKey: 'eleven-test-key',
  models: ['elevenlabs-sfx'],
};

describe('ElevenLabsSfxAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () => new Response(Buffer.from('mp3'), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects prompts over the provider budget before the wire call', async () => {
    const adapter = new ElevenLabsSfxAdapter(config);
    const result = await adapter.synthesizeSfx({
      text: 'x'.repeat(501),
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('budget');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves duration_seconds and returns mp3 data', async () => {
    const adapter = new ElevenLabsSfxAdapter(config);
    const result = await adapter.synthesizeSfx({
      text: 'soft UI notification chime',
      targetDuration: 4,
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('ElevenLabs SFX');
    expect(result.format).toBe('mp3');
    expect(result.audioData?.toString()).toBe('mp3');
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.duration_seconds).toBe(4);
  });

  it('redacts the prompt from provider errors', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('bad prompt: secret sound', { status: 400 }),
    );
    const result = await new ElevenLabsSfxAdapter(config).synthesizeSfx({
      text: 'secret sound',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('[redacted prompt]');
    expect(result.error).not.toContain('secret sound');
  });
});
