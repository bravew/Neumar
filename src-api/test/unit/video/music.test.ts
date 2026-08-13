import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSetting } from '@/shared/db/operations';
import { generateBackgroundMusic } from '@/shared/video/music';
import { createProject } from '@/shared/video/store';

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
}));

vi.mock('@/shared/network-policy/fetch', () => ({
  safeFetch: mocks.safeFetch,
}));

describe('video music providers', () => {
  let workDir: string;

  beforeEach(async () => {
    mocks.safeFetch.mockReset();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-music-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    vi.stubEnv('STABILITY_API_KEY', '');
    vi.stubEnv('STABILITY_AI_API_KEY', '');
    vi.stubEnv('STABLE_AUDIO_API_KEY', '');
    setSetting('workDir', workDir);
    setSetting('providers', '[]');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('falls back to a local silent placeholder when credentials are missing', async () => {
    const project = await createProject({
      name: 'Music fallback',
      template: 'slideshow',
    });

    const result = await generateBackgroundMusic(project.id, {
      prompt: 'quiet ambient bed',
      durationMs: 2000,
      provider: 'elevenlabs-music',
    });

    expect(mocks.safeFetch).not.toHaveBeenCalled();
    expect(result.costCents).toBe(0);
    expect(result.asset.path.endsWith('.wav')).toBe(true);
    expect(result.asset.provenance).toMatchObject({
      provider: 'elevenlabs-music',
      model: 'silent-placeholder',
      fallbackReason: 'missing-credentials',
    });
    await expect(
      fs.stat(path.join(workDir, result.asset.path)),
    ).resolves.toMatchObject({ size: expect.any(Number) });
  });

  it('writes ElevenLabs music responses as generated audio assets', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-elevenlabs-key');
    mocks.safeFetch.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
      body: Buffer.from('mp3 bytes'),
      finalUrl: 'https://api.elevenlabs.io/v1/music',
      redirectChain: ['https://api.elevenlabs.io/v1/music'],
    });
    const project = await createProject({
      name: 'Music provider',
      template: 'slideshow',
    });

    const result = await generateBackgroundMusic(project.id, {
      prompt: 'warm product tour bed',
      durationMs: 3000,
      tempoBpm: 100,
      mood: 'warm',
      provider: 'elevenlabs-music',
      seed: 42,
    });

    expect(mocks.safeFetch).toHaveBeenCalledTimes(1);
    const [url, policy, init] = mocks.safeFetch.mock.calls[0]!;
    expect(String(url)).toContain('/v1/music');
    expect(String(url)).toContain('output_format=mp3_44100_128');
    expect(policy).toMatchObject({
      default: 'deny',
      allow_localhost: false,
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model_id: 'music_v1',
      music_length_ms: 3000,
      seed: 42,
    });
    expect(init.maxRedirects).toBe(0);
    expect(result.costCents).toBe(3);
    expect(result.asset.path.endsWith('.mp3')).toBe(true);
    expect(result.asset.provenance).toMatchObject({
      provider: 'elevenlabs-music',
      model: 'music_v1',
      seed: 42,
      fallbackReason: undefined,
    });
    await expect(
      fs.readFile(path.join(workDir, result.asset.path), 'utf8'),
    ).resolves.toBe('mp3 bytes');
  });

  it('auto-selects Stable Audio when only Stability credentials are configured', async () => {
    vi.stubEnv('STABILITY_API_KEY', 'test-stability-key');
    mocks.safeFetch.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
      body: Buffer.from('stable audio bytes'),
      finalUrl:
        'https://api.stability.ai/v2beta/audio/stable-audio-3/text-to-audio',
      redirectChain: [
        'https://api.stability.ai/v2beta/audio/stable-audio-3/text-to-audio',
      ],
    });
    const project = await createProject({
      name: 'Stable music provider',
      template: 'slideshow',
    });

    const result = await generateBackgroundMusic(project.id, {
      prompt: 'punchy social beat',
      durationMs: 3000,
    });

    expect(mocks.safeFetch).toHaveBeenCalledTimes(1);
    const [url, policy, init] = mocks.safeFetch.mock.calls[0]!;
    expect(String(url)).toContain('/v2beta/audio/stable-audio-3/text-to-audio');
    expect(policy).toMatchObject({
      default: 'deny',
      allow_localhost: false,
    });
    expect(init.headers['content-type']).toContain('multipart/form-data');
    expect(init.body.toString('utf8')).toContain('name="prompt"');
    expect(init.body.toString('utf8')).toContain('punchy social beat');
    expect(result.costCents).toBe(2);
    expect(result.asset.provenance).toMatchObject({
      provider: 'stable-audio',
      model: 'stable-audio-3',
      requestedProvider: 'stable-audio',
    });
  });

  it('downloads Stable Audio JSON result URLs through the external policy', async () => {
    vi.stubEnv('STABILITY_API_KEY', 'test-stability-key');
    mocks.safeFetch
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(
          JSON.stringify({ url: 'https://cdn.stability.ai/audio/test.mp3' }),
        ),
        finalUrl:
          'https://api.stability.ai/v2beta/audio/stable-audio-3/text-to-audio',
        redirectChain: [
          'https://api.stability.ai/v2beta/audio/stable-audio-3/text-to-audio',
        ],
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
        body: Buffer.from('downloaded stable audio'),
        finalUrl: 'https://cdn.stability.ai/audio/test.mp3',
        redirectChain: ['https://cdn.stability.ai/audio/test.mp3'],
      });
    const project = await createProject({
      name: 'Stable music JSON result',
      template: 'slideshow',
    });

    const result = await generateBackgroundMusic(project.id, {
      prompt: 'bright intro loop',
      durationMs: 3000,
      provider: 'stable-audio',
    });

    expect(mocks.safeFetch).toHaveBeenCalledTimes(2);
    expect(mocks.safeFetch.mock.calls[1]?.[0]).toBe(
      'https://cdn.stability.ai/audio/test.mp3',
    );
    expect(mocks.safeFetch.mock.calls[1]?.[1]).toMatchObject({
      default: 'deny',
      allow_localhost: false,
    });
    expect(result.asset.path.endsWith('.mp3')).toBe(true);
    await expect(
      fs.readFile(path.join(workDir, result.asset.path), 'utf8'),
    ).resolves.toBe('downloaded stable audio');
  });
});
