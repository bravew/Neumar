/**
 * Local Speech Adapter
 *
 * Offline TTS + STT via sherpa-onnx-node.
 * Model downloads are handled lazily — the actual sherpa-onnx functions are
 * imported at call time so startup cost is zero when this adapter is never used.
 *
 * Supports three TTS engines:
 *   - Kokoro: high-quality multi-language TTS
 *   - Pocket-TTS: 100M param flow-matching with voice cloning
 *   - Kitten TTS: 15M param ultra-lightweight
 *
 * @module speech/adapters/local
 */

import { randomUUID } from 'node:crypto';
import * as path from 'node:path';

import { createLogger } from '@/shared/utils/logger';

import type { TtsModelId } from '../local-models';
import type {
  SpeechAdapter,
  SpeechProviderConfig,
  STTParams,
  STTResult,
  TTSParams,
  TTSResult,
  VoiceInfo,
} from '../types';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SAMPLE_RATE = 16_000; // Hz — sherpa-onnx STT models expect 16 kHz
const WAV_HEADER_BYTES = 44; // Standard PCM WAV header size
const INT16_MAX = 32_767; // Maximum value for signed 16-bit integer
const INT16_MIN = -32_768; // Minimum value for signed 16-bit integer
const BYTES_PER_INT16_SAMPLE = 2;
const PCM_FORMAT_TYPE = 1; // Linear PCM format tag
const MONO_CHANNEL_COUNT = 1;
const BITS_PER_SAMPLE_16 = 16;
const DEFAULT_TTS_SPEED = 1.0;
const RIFF_CHUNK_DESCRIPTOR = 'RIFF';
const WAVE_FORMAT_MARKER = 'WAVE';
const FMT_SUBCHUNK_ID = 'fmt ';
const DATA_SUBCHUNK_ID = 'data';
const FMT_SUBCHUNK_SIZE = 16; // PCM format subchunk size in bytes

const STT_MODEL_LABEL = 'sensevoice';

// ============================================================================
// Voice Registry — Kokoro
// ============================================================================

/**
 * Maps Kokoro voice IDs to their speaker index in the kokoro-multi-lang-v1_0
 * model's `voices.bin` file. Speaker indices are defined by the
 * `add_meta_data.py` script in the sherpa-onnx repository.
 *
 * Naming convention:
 *   prefix[0] = language group: a=American, b=British, f=French, z=Chinese
 *   prefix[1] = gender:         f=female, m=male
 *   suffix    = voice name
 */
interface VoiceEntry {
  /** Numeric speaker index (sid) for sherpa-onnx */
  sid: number;
  /** Human-readable display name */
  name: string;
  /** BCP-47 language tag */
  language: string;
  /** Voice gender */
  gender: 'female' | 'male';
}

const KOKORO_VOICES: Record<string, VoiceEntry> = {
  // --- English (US) — Female ---
  af_alloy: { sid: 0, name: 'Alloy', language: 'en-US', gender: 'female' },
  af_bella: { sid: 1, name: 'Bella', language: 'en-US', gender: 'female' },
  af_nicole: { sid: 2, name: 'Nicole', language: 'en-US', gender: 'female' },
  af_sarah: { sid: 3, name: 'Sarah', language: 'en-US', gender: 'female' },
  af_sky: { sid: 4, name: 'Sky', language: 'en-US', gender: 'female' },
  // --- English (US) — Male ---
  am_adam: { sid: 5, name: 'Adam', language: 'en-US', gender: 'male' },
  am_michael: { sid: 6, name: 'Michael', language: 'en-US', gender: 'male' },
  // --- English (GB) — Female ---
  bf_emma: { sid: 7, name: 'Emma', language: 'en-GB', gender: 'female' },
  bf_isabella: {
    sid: 8,
    name: 'Isabella',
    language: 'en-GB',
    gender: 'female',
  },
  // --- English (GB) — Male ---
  bm_george: { sid: 9, name: 'George', language: 'en-GB', gender: 'male' },
  bm_lewis: { sid: 10, name: 'Lewis', language: 'en-GB', gender: 'male' },
  // --- French (FR) — Female ---
  ff_siwis: { sid: 11, name: 'Siwis', language: 'fr-FR', gender: 'female' },
  // --- French (FR) — Male ---
  fm_gilles: { sid: 12, name: 'Gilles', language: 'fr-FR', gender: 'male' },
  // --- Spanish (ES) — Female ---
  ef_dora: { sid: 13, name: 'Dora', language: 'es-ES', gender: 'female' },
  // --- Spanish (ES) — Male ---
  em_alex: { sid: 14, name: 'Alex', language: 'es-ES', gender: 'male' },
  em_santa: { sid: 15, name: 'Santa', language: 'es-ES', gender: 'male' },
  // --- Chinese Mandarin (cmn) — Female ---
  zf_xiaoni: { sid: 16, name: 'Xiaoni', language: 'cmn', gender: 'female' },
  zf_xiaoxiao: { sid: 17, name: 'Xiaoxiao', language: 'cmn', gender: 'female' },
  zf_xiaobei: { sid: 18, name: 'Xiaobei', language: 'cmn', gender: 'female' },
  zf_xiaoyi: { sid: 20, name: 'Xiaoyi', language: 'cmn', gender: 'female' },
  // --- Chinese Mandarin (cmn) — Male ---
  zm_yunxi: { sid: 19, name: 'Yunxi', language: 'cmn', gender: 'male' },
  zm_yunjian: { sid: 21, name: 'Yunjian', language: 'cmn', gender: 'male' },
  zm_yunxia: { sid: 22, name: 'Yunxia', language: 'cmn', gender: 'male' },
  zm_yunyang: { sid: 23, name: 'Yunyang', language: 'cmn', gender: 'male' },
};

// ============================================================================
// Voice Registry — Pocket-TTS
// ============================================================================

/**
 * Pocket-TTS predefined voices with reference WAV files.
 * The voice ID prefix is `pocket_`.
 */
// Pocket-TTS bundles reference WAVs in test_wavs/. Only these three voices are
// available — the model is voice-cloning only and has no built-in speaker bank.
const POCKET_VOICES: Record<string, VoiceEntry & { wavFile: string }> = {
  pocket_bria: {
    sid: 0,
    name: 'Bria',
    language: 'en-US',
    gender: 'female',
    wavFile: 'bria.wav',
  },
  pocket_loona: {
    sid: 1,
    name: 'Loona',
    language: 'en-US',
    gender: 'female',
    wavFile: 'loona.wav',
  },
  pocket_hibiki: {
    sid: 2,
    name: 'Hibiki',
    language: 'fr-FR',
    gender: 'female',
    wavFile: 'sample_fr_hibiki_crepes.wav',
  },
};

// ============================================================================
// Voice Registry — Kitten TTS
// ============================================================================

/**
 * Kitten TTS predefined voices with numeric speaker IDs 0-7.
 * The voice ID prefix is `kitten_`.
 */
const KITTEN_VOICES: Record<string, VoiceEntry> = {
  kitten_bella: { sid: 0, name: 'Bella', language: 'en-US', gender: 'female' },
  kitten_jasper: { sid: 1, name: 'Jasper', language: 'en-US', gender: 'male' },
  kitten_luna: { sid: 2, name: 'Luna', language: 'en-US', gender: 'female' },
  kitten_bruno: { sid: 3, name: 'Bruno', language: 'en-US', gender: 'male' },
  kitten_rosie: { sid: 4, name: 'Rosie', language: 'en-GB', gender: 'female' },
  kitten_hugo: { sid: 5, name: 'Hugo', language: 'fr-FR', gender: 'male' },
  kitten_kiki: { sid: 6, name: 'Kiki', language: 'fr-FR', gender: 'female' },
  kitten_leo: { sid: 7, name: 'Leo', language: 'cmn', gender: 'male' },
};

const DEFAULT_SPEAKER_ID = 0; // af_alloy

// ============================================================================
// Voice Resolution
// ============================================================================

interface ResolvedVoice {
  modelId: TtsModelId;
  speakerId: number;
  isClone: boolean;
  cloneName?: string;
}

/**
 * Resolve a voice string to its model, speaker ID, and clone status
 * by checking prefixes:
 *   - `pocket_clone_{name}` → Pocket-TTS voice clone
 *   - `pocket_{name}` → Pocket-TTS predefined voice
 *   - `kitten_{name}` → Kitten TTS voice
 *   - otherwise → Kokoro voice
 */
function resolveVoice(voice: string | undefined): ResolvedVoice {
  if (!voice) {
    return { modelId: 'kokoro', speakerId: DEFAULT_SPEAKER_ID, isClone: false };
  }

  // Clone voices: pocket_clone_{name}
  if (voice.startsWith('pocket_clone_')) {
    const cloneName = voice.replace('pocket_clone_', '');
    return { modelId: 'pocket', speakerId: 0, isClone: true, cloneName };
  }

  // Pocket-TTS predefined voices
  if (voice.startsWith('pocket_')) {
    const entry = POCKET_VOICES[voice];
    if (entry) {
      return { modelId: 'pocket', speakerId: entry.sid, isClone: false };
    }
    // Unknown pocket voice — default to sid 0
    return { modelId: 'pocket', speakerId: 0, isClone: false };
  }

  // Kitten TTS voices
  if (voice.startsWith('kitten_')) {
    const entry = KITTEN_VOICES[voice];
    if (entry) {
      return { modelId: 'kitten', speakerId: entry.sid, isClone: false };
    }
    return { modelId: 'kitten', speakerId: 0, isClone: false };
  }

  // Kokoro voice
  const kokoroEntry = KOKORO_VOICES[voice];
  if (kokoroEntry) {
    return { modelId: 'kokoro', speakerId: kokoroEntry.sid, isClone: false };
  }

  // Raw numeric speaker index → Kokoro
  const num = parseInt(voice, 10);
  if (!isNaN(num) && num >= 0) {
    return { modelId: 'kokoro', speakerId: num, isClone: false };
  }

  return { modelId: 'kokoro', speakerId: DEFAULT_SPEAKER_ID, isClone: false };
}

/**
 * Get the model label string for a resolved model.
 */
function getModelLabel(modelId: TtsModelId): string {
  switch (modelId) {
    case 'kokoro':
      return 'kokoro-v1.0';
    case 'pocket':
      return 'pocket-tts';
    case 'kitten':
      return 'kitten-nano';
  }
}

// ============================================================================
// WAV Encoding / Decoding Helpers
// ============================================================================

/**
 * Convert a Float32Array of audio samples to a PCM WAV Buffer.
 *
 * The function writes a standard 44-byte RIFF/WAVE header followed by the
 * raw 16-bit little-endian PCM sample data.
 *
 * @param samples    - Normalised float samples in the range [-1.0, 1.0]
 * @param sampleRate - Audio sample rate in Hz (e.g. 22050, 44100)
 * @returns          A Node.js Buffer containing a valid WAV file
 */
function pcmToWav(samples: Float32Array, sampleRate: number): Buffer {
  const numSamples = samples.length;
  const pcmDataBytes = numSamples * BYTES_PER_INT16_SAMPLE;
  const totalFileBytes = WAV_HEADER_BYTES + pcmDataBytes;

  const buffer = Buffer.alloc(totalFileBytes);
  let offset = 0;

  // ----- RIFF chunk descriptor -----
  buffer.write(RIFF_CHUNK_DESCRIPTOR, offset, 'ascii');
  offset += 4;
  buffer.writeUInt32LE(totalFileBytes - 8, offset); // File size minus 8-byte descriptor
  offset += 4;
  buffer.write(WAVE_FORMAT_MARKER, offset, 'ascii');
  offset += 4;

  // ----- fmt subchunk -----
  buffer.write(FMT_SUBCHUNK_ID, offset, 'ascii');
  offset += 4;
  buffer.writeUInt32LE(FMT_SUBCHUNK_SIZE, offset); // Subchunk size: 16 for PCM
  offset += 4;
  buffer.writeUInt16LE(PCM_FORMAT_TYPE, offset); // AudioFormat: 1 = PCM
  offset += 2;
  buffer.writeUInt16LE(MONO_CHANNEL_COUNT, offset); // NumChannels: 1 (mono)
  offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); // SampleRate
  offset += 4;
  const byteRate = sampleRate * MONO_CHANNEL_COUNT * BYTES_PER_INT16_SAMPLE;
  buffer.writeUInt32LE(byteRate, offset); // ByteRate
  offset += 4;
  const blockAlign = MONO_CHANNEL_COUNT * BYTES_PER_INT16_SAMPLE;
  buffer.writeUInt16LE(blockAlign, offset); // BlockAlign
  offset += 2;
  buffer.writeUInt16LE(BITS_PER_SAMPLE_16, offset); // BitsPerSample
  offset += 2;

  // ----- data subchunk -----
  buffer.write(DATA_SUBCHUNK_ID, offset, 'ascii');
  offset += 4;
  buffer.writeUInt32LE(pcmDataBytes, offset); // Subchunk size
  offset += 4;

  // Convert Float32 → Int16 PCM (little-endian)
  for (let i = 0; i < numSamples; i++) {
    // Clamp to [-1, 1] before scaling to avoid wrap-around artifacts
    const sample = samples[i] ?? 0;
    const clamped = Math.max(-1.0, Math.min(1.0, sample));
    const int16 = Math.round(
      clamped < 0 ? clamped * -INT16_MIN : clamped * INT16_MAX,
    );
    buffer.writeInt16LE(int16, offset);
    offset += BYTES_PER_INT16_SAMPLE;
  }

  return buffer;
}

/**
 * Decode a WAV buffer into Float32Array samples.
 * Inverse of pcmToWav — reads 16-bit PCM WAV and returns normalized floats.
 */
export function decodeWavToFloat32(wavBuffer: Buffer): {
  samples: Float32Array;
  sampleRate: number;
} {
  // Parse WAV header
  const riff = wavBuffer.toString('ascii', 0, 4);
  if (riff !== 'RIFF') {
    throw new Error('Invalid WAV file: missing RIFF header');
  }

  const wave = wavBuffer.toString('ascii', 8, 12);
  if (wave !== 'WAVE') {
    throw new Error('Invalid WAV file: missing WAVE marker');
  }

  // Find fmt and data chunks
  let pos = 12;
  let sampleRate = DEFAULT_SAMPLE_RATE;
  let bitsPerSample = BITS_PER_SAMPLE_16;
  let dataStart = 0;
  let dataSize = 0;

  while (pos < wavBuffer.length) {
    const chunkId = wavBuffer.toString('ascii', pos, pos + 4);
    const chunkSize = wavBuffer.readUInt32LE(pos + 4);

    if (chunkId === 'fmt ') {
      sampleRate = wavBuffer.readUInt32LE(pos + 12);
      bitsPerSample = wavBuffer.readUInt16LE(pos + 22);
    } else if (chunkId === 'data') {
      dataStart = pos + 8;
      dataSize = chunkSize;
      break;
    }

    pos += 8 + chunkSize;
  }

  if (dataStart === 0 || dataSize === 0) {
    throw new Error('Invalid WAV file: no data chunk found');
  }

  const bytesPerSample = bitsPerSample / 8;
  const numSamples = dataSize / bytesPerSample;
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const byteOffset = dataStart + i * bytesPerSample;
    if (bitsPerSample === 16) {
      const val = wavBuffer.readInt16LE(byteOffset);
      samples[i] = val < 0 ? val / -INT16_MIN : val / INT16_MAX;
    } else if (bitsPerSample === 32) {
      // 32-bit float
      samples[i] = wavBuffer.readFloatLE(byteOffset);
    } else {
      // 8-bit unsigned
      samples[i] = ((wavBuffer[byteOffset] ?? 128) - 128) / 128;
    }
  }

  return { samples, sampleRate };
}

// ============================================================================
// Adapter Implementation
// ============================================================================

/**
 * LocalSpeechAdapter — fully offline TTS and STT powered by sherpa-onnx-node.
 *
 * Streaming is not supported because sherpa-onnx operates in batch mode.
 * Set `supportsStreamingTTS` / `supportsStreamingSTT` to false so the router
 * can fall back to a streaming-capable provider when live output is required.
 */
export class LocalSpeechAdapter implements SpeechAdapter {
  readonly name = 'Local';
  readonly dataEgress = 'local';
  readonly supportsTTS = true;
  readonly supportsSTT = true;
  readonly supportsStreamingSTT = false;
  readonly supportsStreamingTTS = false;

  private readonly logger = createLogger('LocalSpeech');

  // config is accepted for interface compatibility; local adapter does not
  // need API keys or base URLs, so most fields are intentionally unused.
  constructor(_config: SpeechProviderConfig) {
    this.logger.debug(
      'LocalSpeechAdapter initialised (no remote config needed)',
    );
  }

  // --------------------------------------------------------------------------
  // TTS
  // --------------------------------------------------------------------------

  /**
   * Synthesize text to speech using a locally-stored model.
   *
   * The `synthesizeLocal` function is imported lazily so that the native
   * sherpa-onnx binding is only loaded when TTS is actually requested.
   */
  async synthesize(params: TTSParams): Promise<TTSResult> {
    this.logger.debug('synthesize() called', {
      textLength: params.text.length,
      voice: params.voice,
      speed: params.speed,
      format: params.format,
      workDir: params.workDir,
    });

    try {
      // Lazy import to avoid paying the native-module startup cost at server boot
      const localModels = await import('../local-models');

      const speed = params.speed ?? DEFAULT_TTS_SPEED;
      const resolved = resolveVoice(params.voice);
      const modelLabel = getModelLabel(resolved.modelId);

      this.logger.debug('Resolved voice', {
        requestedVoice: params.voice,
        resolvedModelId: resolved.modelId,
        resolvedSid: resolved.speakerId,
        isClone: resolved.isClone,
      });

      // Build generation config for voice cloning
      let generationConfig:
        | {
            referenceAudio?: Float32Array;
            referenceSampleRate?: number;
            numSteps?: number;
          }
        | undefined;

      if (resolved.modelId === 'pocket') {
        if (resolved.isClone && resolved.cloneName) {
          // Load cloned voice reference audio
          const cloned = localModels.loadClonedVoice(resolved.cloneName);
          if (cloned) {
            generationConfig = {
              referenceAudio: cloned.samples,
              referenceSampleRate: cloned.sampleRate,
            };
          } else {
            this.logger.error(
              `Cloned voice "${resolved.cloneName}" not found on disk`,
            );
          }
        }
        // For predefined Pocket voices, synthesizeLocal auto-loads the
        // bundled reference WAV from test_wavs/ when no generationConfig is supplied.
      }

      const samples: Float32Array = await localModels.synthesizeLocal(
        params.text,
        resolved.speakerId,
        speed,
        resolved.modelId,
        generationConfig,
      );

      this.logger.debug('synthesizeLocal() returned samples', {
        sampleCount: samples.length,
        modelId: resolved.modelId,
      });

      const sampleRate: number =
        typeof localModels.getTTSSampleRate === 'function'
          ? localModels.getTTSSampleRate()
          : DEFAULT_SAMPLE_RATE;

      const wavBuffer = pcmToWav(samples, sampleRate);
      const durationSeconds = samples.length / sampleRate;

      let localPath: string | undefined;

      if (params.workDir) {
        const fs = await import('fs/promises');
        await fs.mkdir(params.workDir, { recursive: true });
        // Unique filename — multiple TTS calls per turn would otherwise overwrite.
        const filename = `tts_${randomUUID()}.wav`;
        localPath = path.join(params.workDir, filename);
        await fs.writeFile(localPath, wavBuffer);
        this.logger.debug('TTS audio saved to disk', { localPath });
      }

      return {
        success: true,
        provider: this.name,
        model: modelLabel,
        audioData: wavBuffer,
        localPath,
        duration: durationSeconds,
        format: 'wav',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('synthesize() failed', { error: message });

      return {
        success: false,
        provider: this.name,
        model: 'local',
        error: message,
      };
    }
  }

  // --------------------------------------------------------------------------
  // STT
  // --------------------------------------------------------------------------

  /**
   * Transcribe audio using a locally-stored SenseVoice/sherpa-onnx model.
   *
   * The `transcribeLocal` function is imported lazily for the same reason as
   * `synthesizeLocal` above.
   *
   * The adapter currently assumes the incoming audio is 16 kHz mono PCM because
   * that is what sherpa-onnx STT models expect.  A future enhancement could
   * auto-detect or resample the input.
   */
  async transcribe(params: STTParams): Promise<STTResult> {
    this.logger.debug('transcribe() called', {
      audioBytes: params.audioData.byteLength,
      mimeType: params.mimeType,
      language: params.language,
    });

    try {
      // Lazy import — only load the native binding when STT is actually needed
      const { transcribeLocal } = await import('../local-models');

      // Copy to an aligned buffer — Node.js Buffer.from() may have odd byte offsets
      // which would cause Int16Array construction to throw a RangeError.
      const aligned = Buffer.from(params.audioData);
      const int16Array = new Int16Array(
        aligned.buffer,
        aligned.byteOffset,
        aligned.byteLength / BYTES_PER_INT16_SAMPLE,
      );
      const float32Samples = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        const val = int16Array[i] ?? 0;
        float32Samples[i] = val < 0 ? val / -INT16_MIN : val / INT16_MAX;
      }

      // Assume 16 kHz — sherpa-onnx models are trained on this rate
      const sampleRate = DEFAULT_SAMPLE_RATE;

      this.logger.debug('Calling transcribeLocal()', {
        sampleCount: float32Samples.length,
        sampleRate,
        language: params.language,
      });

      const result = await transcribeLocal(
        float32Samples,
        sampleRate,
        params.language,
      );

      this.logger.debug('transcribeLocal() returned', {
        text: result.text,
        emotion: result.emotion,
        audioEvents: result.audioEvents,
      });

      return {
        success: true,
        provider: this.name,
        model: STT_MODEL_LABEL,
        text: result.text,
        emotion: result.emotion,
        audioEvents: result.audioEvents,
        duration: float32Samples.length / sampleRate,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('transcribe() failed', { error: message });

      return {
        success: false,
        provider: this.name,
        model: STT_MODEL_LABEL,
        error: message,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Voice Listing
  // --------------------------------------------------------------------------

  /**
   * Return all voices available from local models, grouped by model tag.
   */
  async listVoices(): Promise<VoiceInfo[]> {
    this.logger.debug('listVoices() called');

    const voices: VoiceInfo[] = [];

    // Kokoro voices
    for (const [id, entry] of Object.entries(KOKORO_VOICES)) {
      voices.push({
        id,
        name: `[Kokoro] ${entry.name} (${entry.language})`,
        language: entry.language,
        gender: entry.gender,
        provider: this.name,
      });
    }

    // Pocket-TTS voices
    for (const [id, entry] of Object.entries(POCKET_VOICES)) {
      voices.push({
        id,
        name: `[Pocket-TTS] ${entry.name} (${entry.language})`,
        language: entry.language,
        gender: entry.gender,
        provider: this.name,
      });
    }

    // Kitten TTS voices
    for (const [id, entry] of Object.entries(KITTEN_VOICES)) {
      voices.push({
        id,
        name: `[Kitten] ${entry.name} (${entry.language})`,
        language: entry.language,
        gender: entry.gender,
        provider: this.name,
      });
    }

    // Cloned voices
    try {
      const { listClonedVoices } = await import('../local-models');
      const clonedVoices = listClonedVoices();
      for (const cv of clonedVoices) {
        voices.push({
          id: cv.voiceId,
          name: `[Pocket-TTS Clone] ${cv.name}`,
          language: 'en-US',
          provider: this.name,
        });
      }
    } catch {
      // Cloned voices directory might not exist yet
    }

    return voices;
  }
}
