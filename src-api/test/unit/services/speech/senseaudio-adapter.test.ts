import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SenseAudioSpeechAdapter } from '@/shared/services/speech/adapters/senseaudio';
import {
  createAdapterForProvider,
  isTTSModel,
} from '@/shared/services/speech/registry';

const config = {
  id: 'senseaudio',
  name: 'SenseAudio',
  baseUrl: 'https://api.senseaudio.cn',
  apiKey: 'senseaudio-test-key',
  models: ['senseaudio-tts-1.5-260319'],
};

describe('SenseAudioSpeechAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'senseaudio-speech-'));
    fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: { audio: Buffer.from('ok').toString('hex') },
            base_resp: { status_code: 0, status_msg: 'success' },
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

  it('sends default voice settings and writes hex audio to disk', async () => {
    const adapter = new SenseAudioSpeechAdapter(config);

    const result = await adapter.synthesize({
      text: 'Hello',
      workDir: tempDir,
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('SenseAudio');
    expect(result.format).toBe('mp3');
    expect(result.localPath).toMatch(/senseaudio_tts_.*\.mp3$/);
    await expect(readFile(result.localPath!)).resolves.toEqual(
      Buffer.from('ok'),
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.senseaudio.cn/v1/t2a_v2');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer senseaudio-test-key',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      model: 'senseaudio-tts-1.5-260319',
      stream: false,
      voice_setting: { voice_id: 'female_0033_b', speed: 1, vol: 1, pitch: 0 },
      audio_setting: {
        format: 'mp3',
        sample_rate: 32_000,
        bitrate: 128_000,
        channel: 'stereo',
      },
    });
  });

  it('surfaces provider-level base_resp failures', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          base_resp: { status_code: 1008, status_msg: 'invalid voice' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await new SenseAudioSpeechAdapter(config).synthesize({
      text: 'Hello',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid voice');
  });
});

describe('SenseAudio speech registry', () => {
  it('detects SenseAudio TTS models and providers', () => {
    expect(isTTSModel('senseaudio-tts-1.5-260319')).toBe(true);
    expect(createAdapterForProvider(config)?.name).toBe('SenseAudio');
  });
});
