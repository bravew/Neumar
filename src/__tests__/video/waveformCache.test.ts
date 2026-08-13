import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearWaveformPeakCache,
  fallbackWaveformPeaks,
  getCachedWaveformPeaks,
} from '@/components/video/timeline/waveformCache';

describe('waveform peak cache', () => {
  const originalAudioContext = window.AudioContext;

  beforeEach(() => {
    clearWaveformPeakCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: originalAudioContext,
    });
    clearWaveformPeakCache();
  });

  it('decodes and reuses cached peaks for the same audio source', async () => {
    const decodeAudioData = vi.fn(async () => audioBufferFixture());
    class MockAudioContext {
      decodeAudioData = decodeAudioData;
      close = vi.fn(async () => {});
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext as unknown as typeof AudioContext,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      getCachedWaveformPeaks('/audio.wav', 4),
      getCachedWaveformPeaks('/audio.wav', 4),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(first).toEqual([0, 0.5, 1, 0.25]);
    expect(second).toBe(first);
  });

  it('generates deterministic fallback peaks when decoding is unavailable', () => {
    expect(fallbackWaveformPeaks('clip-1', 4)).toEqual(
      fallbackWaveformPeaks('clip-1', 4),
    );
    expect(fallbackWaveformPeaks('clip-1', 4)).not.toEqual(
      fallbackWaveformPeaks('clip-2', 4),
    );
  });
});

function audioBufferFixture(): AudioBuffer {
  const channel = new Float32Array([0, 0.5, 1, 0.25]);
  return {
    length: channel.length,
    numberOfChannels: 1,
    getChannelData: () => channel,
  } as unknown as AudioBuffer;
}
