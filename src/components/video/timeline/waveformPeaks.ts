export function waveformPeaksFromAudioBuffer(
  audioBuffer: AudioBuffer,
  bucketCount: number,
  sourceRange?: WaveformSourceRange,
): number[] {
  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, index) => audioBuffer.getChannelData(index),
  );
  const range = normalizeAudioBufferRange(audioBuffer, sourceRange);
  const peaks = waveformPeaksFromChannels(
    channels,
    range.sampleCount,
    bucketCount,
    range.sampleStart,
  );
  return sourceRange?.reverse ? [...peaks].reverse() : peaks;
}

export function waveformPeaksFromChannels(
  channels: Float32Array[],
  sampleCount: number,
  bucketCount: number,
  sampleOffset = 0,
): number[] {
  if (channels.length === 0 || sampleCount === 0) return [];

  const peaks = Array.from({ length: bucketCount }, (_, index) => {
    const start =
      sampleOffset + Math.floor((index / bucketCount) * sampleCount);
    const end = Math.max(
      start + 1,
      sampleOffset + Math.floor(((index + 1) / bucketCount) * sampleCount),
    );
    const step = Math.max(1, Math.floor((end - start) / 800));
    let sum = 0;
    let count = 0;
    for (let sample = start; sample < end; sample += step) {
      for (const channel of channels) {
        const value = channel[sample] ?? 0;
        sum += value * value;
        count += 1;
      }
    }
    return count > 0 ? Math.sqrt(sum / count) : 0;
  });
  const maxPeak = Math.max(...peaks);
  if (maxPeak <= 0) return peaks;
  return peaks.map((peak) => peak / maxPeak);
}

export interface WaveformSourceRange {
  startMs: number;
  durationMs: number;
  reverse?: boolean;
}

function normalizeAudioBufferRange(
  audioBuffer: AudioBuffer,
  sourceRange: WaveformSourceRange | undefined,
): { sampleStart: number; sampleCount: number } {
  if (!sourceRange) {
    return { sampleStart: 0, sampleCount: audioBuffer.length };
  }
  const sampleStart = Math.max(
    0,
    Math.min(
      audioBuffer.length - 1,
      Math.floor((sourceRange.startMs / 1000) * audioBuffer.sampleRate),
    ),
  );
  const requestedSampleCount = Math.max(
    1,
    Math.floor((sourceRange.durationMs / 1000) * audioBuffer.sampleRate),
  );
  return {
    sampleStart,
    sampleCount: Math.max(
      1,
      Math.min(requestedSampleCount, audioBuffer.length - sampleStart),
    ),
  };
}
