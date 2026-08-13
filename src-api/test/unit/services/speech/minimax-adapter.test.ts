import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MiniMaxSpeechAdapter } from '@/shared/services/speech/adapters/minimax';
import {
  createAdapterForProvider,
  isSpeechModel,
  isTTSModel,
} from '@/shared/services/speech/registry';

vi.mock('@/shared/services/usage-logger', () => ({
  logUsage: vi.fn(),
}));

const config = {
  id: 'minimax',
  name: 'MiniMax',
  baseUrl: 'https://api.minimax.io/v1',
  apiKey: 'minimax-test-key',
  models: ['speech-2.8-turbo'],
};

describe('MiniMaxSpeechAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'minimax-speech-'));
    fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              audio: Buffer.from('ok').toString('hex'),
              status: 2,
            },
            extra_info: {
              audio_format: 'wav',
              audio_length: 1234,
              usage_characters: 5,
            },
            base_resp: {
              status_code: 0,
              status_msg: 'success',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('sends language_boost and writes MiniMax hex audio to disk', async () => {
    const adapter = new MiniMaxSpeechAdapter(config);

    const result = await adapter.synthesize({
      text: 'Hello',
      format: 'wav',
      language: 'es',
      languageBoost: 'English',
      workDir: tempDir,
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('MiniMax');
    expect(result.model).toBe('speech-2.8-turbo');
    expect(result.format).toBe('wav');
    expect(result.duration).toBeCloseTo(1.234);
    expect(result.audioData?.toString()).toBe('ok');
    expect(result.localPath).toMatch(/minimax_tts_.*\.wav$/);
    await expect(readFile(result.localPath!)).resolves.toEqual(
      Buffer.from('ok'),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.minimax.io/v1/t2a_v2');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer minimax-test-key',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.language_boost).toBe('English');
    expect(body.output_format).toBe('hex');
    expect(body.voice_setting).toMatchObject({
      voice_id: 'English_expressive_narrator',
      speed: 1,
    });
    expect(body.audio_setting).toMatchObject({
      format: 'wav',
      sample_rate: 32_000,
      bitrate: 128_000,
      channel: 1,
    });
  });

  it('derives language_boost from a BCP-47 language when omitted', async () => {
    const adapter = new MiniMaxSpeechAdapter(config);

    const result = await adapter.synthesize({
      text: 'Hola',
      language: 'es',
    });

    expect(result.success).toBe(true);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.language_boost).toBe('Spanish');
  });

  it('surfaces MiniMax API errors', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          base_resp: {
            status_code: 1008,
            status_msg: 'invalid voice',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = new MiniMaxSpeechAdapter(config);

    const result = await adapter.synthesize({ text: 'Hello' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid voice');
  });
});

describe('MiniMax speech registry', () => {
  it('detects MiniMax speech models and providers', () => {
    expect(isTTSModel('speech-2.8-turbo')).toBe(true);
    expect(isSpeechModel('speech-2.6-hd')).toBe(true);

    const adapter = createAdapterForProvider({
      id: 'minimax-custom',
      name: 'custom',
      baseUrl: 'https://api.minimax.io/v1',
      apiKey: 'minimax-test-key',
      models: ['speech-2.8-turbo'],
    });

    expect(adapter?.name).toBe('MiniMax');
  });
});
