import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSetting } from '@/shared/db/operations';
import { generateMusicWithProvider } from '@/shared/video/music-providers';

// Phase 5 H2 — MiniMax Music 2.6 provider. The network boundary is mocked; we
// assert the request shape, hex→mp3 decode, and base_resp error classification
// (1004 auth / 1008 balance) falling back to silence.

const mocks = vi.hoisted(() => ({ safeFetch: vi.fn() }));
vi.mock('@/shared/network-policy/fetch', () => ({
  safeFetch: mocks.safeFetch,
}));

function okResponse(audioHex: string) {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(
      JSON.stringify({
        data: { audio: audioHex, status: 2 },
        extra_info: { music_duration: 3000 },
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
    ),
    finalUrl: 'https://api.minimax.io/v1/music_generation',
    redirectChain: [],
  };
}

function errResponse(statusCode: number, msg: string) {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(
      JSON.stringify({
        base_resp: { status_code: statusCode, status_msg: msg },
      }),
    ),
    finalUrl: 'https://api.minimax.io/v1/music_generation',
    redirectChain: [],
  };
}

describe('MiniMax music provider', () => {
  let outputDir: string;

  beforeEach(async () => {
    mocks.safeFetch.mockReset();
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minimax-music-'));
    setSetting('providers', '[]');
    vi.stubEnv('MINIMAX_API_KEY', 'mm-test-key');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('sends a music-2.6 request and decodes the hex audio to an mp3', async () => {
    const audioHex = Buffer.from('mp3-bytes').toString('hex');
    mocks.safeFetch.mockResolvedValueOnce(okResponse(audioHex));

    const result = await generateMusicWithProvider({
      prompt: 'warm ambient bed',
      durationMs: 3000,
      provider: 'minimax-music',
      outputDir,
    });

    expect(mocks.safeFetch).toHaveBeenCalledTimes(1);
    const [url, , init] = mocks.safeFetch.mock.calls[0]!;
    expect(String(url)).toBe('https://api.minimax.io/v1/music_generation');
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({
      model: 'music-2.6',
      stream: false,
      output_format: 'hex',
      audio_setting: { format: 'mp3' },
    });
    expect(sent.prompt).toContain('warm ambient bed');

    expect(result.provider).toBe('minimax-music');
    expect(result.model).toBe('music-2.6');
    expect(result.format).toBe('mp3');
    expect(result.fallbackReason).toBeUndefined();
    await expect(fs.readFile(result.filePath, 'utf8')).resolves.toBe(
      'mp3-bytes',
    );
  });

  it('falls back to silence and surfaces the 1004 auth code', async () => {
    mocks.safeFetch.mockResolvedValueOnce(errResponse(1004, 'invalid api key'));

    const result = await generateMusicWithProvider({
      prompt: 'bed',
      durationMs: 2000,
      provider: 'minimax-music',
      outputDir,
    });

    expect(result.model).toBe('silent-placeholder');
    expect(result.fallbackReason).toContain('1004');
    expect(result.costCents).toBe(0);
  });

  it('falls back when the response carries no audio', async () => {
    mocks.safeFetch.mockResolvedValueOnce(
      okResponse('') /* empty hex → treated as missing */,
    );

    const result = await generateMusicWithProvider({
      prompt: 'bed',
      durationMs: 2000,
      provider: 'minimax-music',
      outputDir,
    });

    expect(result.model).toBe('silent-placeholder');
    expect(result.fallbackReason).toContain('did not include audio');
  });

  it('auto-detects a stored music-2.6 provider as MiniMax, not ElevenLabs', async () => {
    // Regression: the ElevenLabs guard used to match any model containing
    // "music" (including "music-2.6"), so auto-detect picked elevenlabs-music
    // and POSTed to the wrong endpoint with the wrong auth header.
    vi.stubEnv('MINIMAX_API_KEY', '');
    setSetting(
      'providers',
      JSON.stringify([
        {
          id: 'byok-1',
          name: 'My BYOK',
          apiKey: 'mm-stored-key',
          baseUrl: 'https://api.minimax.io',
          models: ['music-2.6'],
        },
      ]),
    );
    const audioHex = Buffer.from('mp3-bytes').toString('hex');
    mocks.safeFetch.mockResolvedValueOnce(okResponse(audioHex));

    // No explicit `provider` → exercises chooseMusicProvider auto-detect.
    const result = await generateMusicWithProvider({
      prompt: 'warm ambient bed',
      durationMs: 3000,
      outputDir,
    });

    const [url] = mocks.safeFetch.mock.calls[0]!;
    expect(String(url)).toBe('https://api.minimax.io/v1/music_generation');
    expect(result.provider).toBe('minimax-music');
  });
});
