import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LocalSpeechAdapter,
  decodeWavToFloat32,
} from '@/shared/services/speech/adapters/local';
import { pcmToWav } from '@/shared/services/speech/audio-utils';
import {
  wordsFromTdtResult,
  ownedTextFromTdtResult,
  transcribeTimedLocal,
  getTimedSTTModelStatus,
} from '@/shared/services/speech/timed-local';

const adapter = new LocalSpeechAdapter({
  id: 'local',
  name: 'Local',
  baseUrl: 'local',
  apiKey: '',
  models: [],
});
const raw = {
  text: 'Hello world!',
  tokens: ['▁Hel', 'lo', '▁world', '!'],
  timestamps: [0.12, 0.3, 1.8, 2.1],
  durations: [0.18, 0.2, 0.3, 0],
};

let appDir: string;
beforeEach(async () => {
  appDir = await mkdtemp(join(tmpdir(), 'speech-timing-test-'));
  vi.stubEnv('NEUMAR_APP_DATA_DIR', appDir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(appDir, { recursive: true, force: true });
});

describe('native TDT word timing', () => {
  it('groups subwords and punctuation with actual durations and preserves pauses', () => {
    expect(wordsFromTdtResult(raw, 3, 30)).toEqual([
      { word: 'Hello', startMs: 30120, endMs: 30500 },
      { word: 'world!', startMs: 31800, endMs: 32100 },
    ]);
  });
  it('handles sherpa-rendered leading spaces and zero duration subwords within a positive interval', () => {
    expect(
      wordsFromTdtResult(
        {
          text: 'The tribal',
          tokens: ['The', ' tri', 'bal'],
          timestamps: [0.1, 1, 1.2],
          durations: [0.3, 0.2, 0],
        },
        2,
      ),
    ).toEqual([
      { word: 'The', startMs: 100, endMs: 400 },
      { word: 'tribal', startMs: 1000, endMs: 1200 },
    ]);
  });
  it('accepts engine-confirmed no speech without manufacturing words', () => {
    expect(
      wordsFromTdtResult(
        { text: '', tokens: [], timestamps: [], durations: [] },
        3,
      ),
    ).toEqual([]);
  });
  it.each([
    { ...raw, durations: [] },
    { ...raw, durations: [0.18, NaN, 0.3, 0] },
    { ...raw, timestamps: [0.12, 0.3, 0.2, 2.1] },
    { ...raw, durations: [0.18, 2, 0.3, 0] },
    { ...raw, text: 'Different text' },
    {
      text: 'Two words',
      tokens: ['Two words'],
      timestamps: [0.3],
      durations: [0.4],
    },
  ])('rejects missing, invalid, or overlapping timing %#', (value) => {
    expect(() => wordsFromTdtResult(value, 3)).toThrow();
  });
  it('drops a word the engine could not measure instead of inventing an end', () => {
    expect(
      wordsFromTdtResult(
        {
          text: 'Hi there',
          tokens: ['Hi', '▁there'],
          timestamps: [0.1, 0.5],
          durations: [0.2, 0],
        },
        1,
      ),
    ).toEqual([{ word: 'Hi', startMs: 100, endMs: 300 }]);
  });
  it('drops a window-edge token whose native duration runs past the decode window', () => {
    expect(
      wordsFromTdtResult(
        {
          text: 'Hello world',
          tokens: ['▁Hel', 'lo', '▁world'],
          timestamps: [0.12, 0.3, 2.8],
          durations: [0.18, 0.2, 0.4],
        },
        3,
      ),
    ).toEqual([{ word: 'Hello', startMs: 120, endMs: 500 }]);
  });
  it('limits the owned text to the owned region, dropping decode-context speech', () => {
    // A decode window at 28–36 s (4 s of context around the owned 30–36 s):
    // the context word "before" must not leak into the owned text.
    const window = {
      text: 'before owned words',
      tokens: ['▁before', '▁owned', '▁words'],
      timestamps: [1.2, 3.1, 4.0],
      durations: [0.5, 0.4, 0.4],
    };
    expect(ownedTextFromTdtResult(window, 8, 28, 30_000, 36_000)).toBe(
      'owned words',
    );
  });
  it('keeps an untimeable group in the owned text', () => {
    // The zero-duration group cannot be timed but still owns its place in the text.
    const window = {
      text: 'so well',
      tokens: ['▁so', '▁well'],
      timestamps: [1.0, 3.5],
      durations: [0.4, 0],
    };
    expect(ownedTextFromTdtResult(window, 8, 28, 30_000, 36_000)).toBe('well');
  });
  it('does not download an absent model during a timed request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    expect(getTimedSTTModelStatus()).toMatchObject({
      state: 'not_downloaded',
      timing: 'word',
    });
    await expect(
      transcribeTimedLocal(new Float32Array(16000), 16000, 'en'),
    ).rejects.toMatchObject({ code: 'local-model-not-ready' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects unsupported language before any download or decode', async () => {
    await expect(
      transcribeTimedLocal(new Float32Array(16000), 16000, 'zh-CN'),
    ).rejects.toMatchObject({ code: 'unsupported-language' });
  });
  it('honors cancellation before loading a model', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      transcribeTimedLocal(
        new Float32Array(16000),
        16000,
        'en',
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('local audio input', () => {
  it('decodes WAV without treating the header as PCM samples', () => {
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(-32768, 0);
    pcm.writeInt16LE(16384, 2);
    const decoded = decodeWavToFloat32(pcmToWav(pcm, 16000));
    expect(decoded.sampleRate).toBe(16000);
    expect([...decoded.samples]).toEqual([-1, 0.5]);
  });
  it('rejects compressed input instead of decoding bytes as speech', async () => {
    const result = await adapter.transcribe({
      audioData: Buffer.from('compressed'),
      mimeType: 'audio/mp3',
      timestamps: true,
    });
    expect(result).toMatchObject({
      success: false,
      model: 'parakeet-tdt-v3',
      timingQuality: 'missing',
      dataEgress: 'local',
    });
    expect(result.error).toContain('Convert compressed audio');
  });
  it('returns actionable timed setup failure with no implicit download', async () => {
    const result = await adapter.transcribe({
      audioData: pcmToWav(Buffer.alloc(32000), 16000),
      mimeType: 'audio/wav',
      timestamps: true,
    });
    expect(result).toMatchObject({
      success: false,
      errorCode: 'local-model-not-ready',
      timingQuality: 'missing',
    });
    expect(result.error).toContain('487 MB');
  });
  it('rejects malformed sample frames and truncated chunks', () => {
    expect(() => decodeWavToFloat32(pcmToWav(Buffer.alloc(3), 16000))).toThrow(
      'Incomplete WAV sample frame',
    );
    expect(() =>
      decodeWavToFloat32(pcmToWav(Buffer.alloc(4), 16000).subarray(0, 46)),
    ).toThrow('Truncated WAV chunk');
  });
});
