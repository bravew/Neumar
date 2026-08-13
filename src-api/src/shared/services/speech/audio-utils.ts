/**
 * Shared audio helpers used across speech adapters and the router.
 */

/**
 * Wrap raw S16LE mono PCM in a RIFF/WAVE header. Required when handing PCM
 * to STT providers that sniff the file header (ElevenLabs Scribe, OpenAI
 * Whisper) — they reject headerless bytes labelled `audio.wav`.
 */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Detect a near-silent S16LE recording via RMS. Threshold of 50 on a
 * 32k-range signal corresponds to ~-56 dBFS — anything quieter is almost
 * certainly a microphone-permission failure rather than soft speech.
 */
export function isSilentPcm(pcm: Buffer, threshold = 50): boolean {
  if (pcm.length < 2) return true;
  const samples = new Int16Array(
    pcm.buffer,
    pcm.byteOffset,
    Math.floor(pcm.length / 2),
  );
  let sumSq = 0;
  for (const s of samples) sumSq += s * s;
  const rms = Math.sqrt(sumSq / samples.length);
  return rms < threshold;
}
