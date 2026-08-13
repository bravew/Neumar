/**
 * OpenAI Speech Adapter
 *
 * Implements TTS and STT using the OpenAI Audio APIs:
 *   - TTS (batch):     POST /v1/audio/speech
 *   - TTS (stream):    POST /v1/audio/speech  (streaming PCM chunks)
 *   - STT:             POST /v1/audio/transcriptions  (Whisper)
 *
 * API Reference:
 *   TTS  — https://platform.openai.com/docs/api-reference/audio/createSpeech
 *   STT  — https://platform.openai.com/docs/api-reference/audio/createTranscription
 *
 * @module speech/adapters/openai
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { nanoid } from 'nanoid';
import OpenAI from 'openai';

import { logUsage } from '@/shared/services/usage-logger';
import { createLogger } from '@/shared/utils/logger';

import type {
  SpeechAdapter,
  SpeechProviderConfig,
  STTParams,
  STTResult,
  TranscriptSegment,
  TTSParams,
  TTSResult,
  VoiceInfo,
} from '../types';

const logger = createLogger('OpenAISpeech');

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_STT_MODEL = 'whisper-1';
const DEFAULT_VOICE = 'alloy';
const DEFAULT_FORMAT = 'mp3';
const DEFAULT_SPEED = 1.0;

/** Raw PCM sample rate emitted by the OpenAI streaming TTS endpoint */
const STREAMING_SAMPLE_RATE_HZ = 24_000;

/** OpenAI Whisper maximum upload file size (25 MB) */
const MAX_WHISPER_FILE_SIZE = 25 * 1024 * 1024;

/** MIME type → file extension map for STT file uploads */
const MIME_TO_EXT: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp3': 'mp3',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Derive a file extension from a MIME type.
 * Falls back to 'wav' when the MIME type is unknown.
 */
function extFromMime(mimeType?: string): string {
  if (!mimeType) return 'wav';
  const lower = (mimeType.toLowerCase().split(';')[0] ?? '').trim();
  return MIME_TO_EXT[lower] ?? 'wav';
}

// ============================================================================
// Adapter
// ============================================================================

export class OpenAISpeechAdapter implements SpeechAdapter {
  readonly name = 'OpenAI';
  readonly dataEgress = 'cloud';
  readonly supportsTTS = true;
  readonly supportsSTT = true;
  readonly supportsStreamingSTT = false;
  readonly supportsStreamingTTS = true;

  private readonly client: OpenAI;

  constructor(private readonly config: SpeechProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
    });
  }

  // ---------- TTS — Batch ----------

  async synthesize(params: TTSParams): Promise<TTSResult> {
    const model = params.model ?? DEFAULT_TTS_MODEL;
    const voice = (params.voice ??
      DEFAULT_VOICE) as OpenAI.Audio.Speech.SpeechCreateParams['voice'];
    const format = (params.format ??
      DEFAULT_FORMAT) as OpenAI.Audio.Speech.SpeechCreateParams['response_format'];
    const speed = params.speed ?? DEFAULT_SPEED;

    logger.info(
      `Synthesizing speech model=${model} voice=${voice} format=${format}`,
    );

    try {
      const ttsStart = Date.now();
      const request: OpenAI.Audio.Speech.SpeechCreateParams = {
        model,
        voice,
        input: params.text,
        response_format: format,
        speed,
      };
      if (params.instructions && !/^tts-1(?:-|$)/i.test(model)) {
        request.instructions = params.instructions;
      }

      const response = await this.client.audio.speech.create(request, {
        signal: params.signal,
      });

      const arrayBuffer = await response.arrayBuffer();
      const audioData = Buffer.from(arrayBuffer);

      let localPath: string | undefined;

      if (params.workDir) {
        await mkdir(params.workDir, { recursive: true });
        const filename = `speech_${nanoid()}.${format}`;
        localPath = join(params.workDir, filename);
        await writeFile(localPath, audioData);
        logger.debug(`Saved TTS audio to ${localPath}`);
      }

      logUsage({
        callType: 'speech',
        provider: 'openai',
        model,
        unitType: 'character',
        unitCount: params.text.length,
        latencyMs: Date.now() - ttsStart,
        metadata: { direction: 'tts' },
      });

      return {
        success: true,
        provider: this.name,
        model,
        audioData,
        localPath,
        format,
      };
    } catch (error) {
      logger.error('TTS synthesis failed:', error);
      return {
        success: false,
        provider: this.name,
        model,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------- TTS — Streaming ----------

  async *synthesizeStream(params: TTSParams): AsyncGenerator<Buffer> {
    const model = params.model ?? DEFAULT_TTS_MODEL;
    const voice = (params.voice ??
      DEFAULT_VOICE) as OpenAI.Audio.Speech.SpeechCreateParams['voice'];
    const speed = params.speed ?? DEFAULT_SPEED;

    logger.info(
      `Streaming TTS model=${model} voice=${voice} sampleRate=${STREAMING_SAMPLE_RATE_HZ}Hz`,
    );

    const request: OpenAI.Audio.Speech.SpeechCreateParams = {
      model,
      voice,
      input: params.text,
      response_format: 'pcm',
      speed,
    };
    if (params.instructions && !/^tts-1(?:-|$)/i.test(model)) {
      request.instructions = params.instructions;
    }

    const response = await this.client.audio.speech.create(request, {
      signal: params.signal,
    });

    const stream = response.body;

    if (!stream) {
      throw new Error('OpenAI TTS streaming response has no body');
    }

    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          yield Buffer.from(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ---------- STT ----------

  async transcribe(params: STTParams): Promise<STTResult> {
    const model = params.model ?? DEFAULT_STT_MODEL;

    logger.info(
      `Transcribing audio model=${model} language=${params.language ?? 'auto'} timestamps=${params.timestamps ?? false}`,
    );

    try {
      const sttStart = Date.now();
      if (params.audioData.byteLength > MAX_WHISPER_FILE_SIZE) {
        return {
          success: false,
          provider: this.name,
          model,
          error: `Audio file exceeds Whisper's 25 MB limit (${Math.round(params.audioData.byteLength / 1024 / 1024)} MB)`,
        };
      }

      const ext = extFromMime(params.mimeType);
      const filename = `audio.${ext}`;
      const file = new File([new Uint8Array(params.audioData)], filename, {
        type: params.mimeType ?? 'audio/wav',
      });

      let text: string | undefined;
      let segments: TranscriptSegment[] | undefined;
      let detectedLanguage: string | undefined;
      let duration: number | undefined;

      if (params.timestamps) {
        const result = await this.client.audio.transcriptions.create({
          file,
          model,
          language: params.language || undefined,
          prompt: params.prompt || undefined,
          timestamp_granularities: ['word'],
          response_format: 'verbose_json',
        });

        text = result.text;
        detectedLanguage = result.language;
        duration = result.duration;

        if (result.words && result.words.length > 0) {
          segments = result.words.map((w) => ({
            text: w.word,
            startMs: Math.round(w.start * 1_000),
            endMs: Math.round(w.end * 1_000),
          }));
        }
      } else {
        const result = await this.client.audio.transcriptions.create({
          file,
          model,
          language: params.language || undefined,
          prompt: params.prompt || undefined,
          response_format: 'json',
        });

        text = result.text;
      }

      logUsage({
        callType: 'speech',
        provider: 'openai',
        model,
        unitType: 'audio_second',
        unitCount: duration ? Math.ceil(duration) : 0,
        latencyMs: Date.now() - sttStart,
        metadata: { direction: 'stt' },
      });

      return {
        success: true,
        provider: this.name,
        model,
        text,
        segments,
        detectedLanguage,
        duration,
      };
    } catch (error) {
      logger.error('STT transcription failed:', error);
      return {
        success: false,
        provider: this.name,
        model,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------- Voices ----------

  async listVoices(): Promise<VoiceInfo[]> {
    return [
      {
        id: 'alloy',
        name: 'Alloy',
        language: 'multi',
        gender: 'neutral',
        description: 'Warm & engaging',
        provider: 'OpenAI',
      },
      {
        id: 'ash',
        name: 'Ash',
        language: 'multi',
        gender: 'male',
        description: 'Conversational & clear',
        provider: 'OpenAI',
      },
      {
        id: 'ballad',
        name: 'Ballad',
        language: 'multi',
        gender: 'male',
        description: 'Warm & authoritative',
        provider: 'OpenAI',
      },
      {
        id: 'cedar',
        name: 'Cedar',
        language: 'multi',
        gender: 'male',
        description: 'Friendly & natural',
        provider: 'OpenAI',
      },
      {
        id: 'coral',
        name: 'Coral',
        language: 'multi',
        gender: 'female',
        description: 'Clear & direct',
        provider: 'OpenAI',
      },
      {
        id: 'echo',
        name: 'Echo',
        language: 'multi',
        gender: 'male',
        description: 'Smooth & balanced',
        provider: 'OpenAI',
      },
      {
        id: 'fable',
        name: 'Fable',
        language: 'multi',
        gender: 'male',
        description: 'Expressive & lively',
        provider: 'OpenAI',
      },
      {
        id: 'marin',
        name: 'Marin',
        language: 'multi',
        gender: 'female',
        description: 'Poised & confident',
        provider: 'OpenAI',
      },
      {
        id: 'nova',
        name: 'Nova',
        language: 'multi',
        gender: 'female',
        description: 'Bright & upbeat',
        provider: 'OpenAI',
      },
      {
        id: 'onyx',
        name: 'Onyx',
        language: 'multi',
        gender: 'male',
        description: 'Deep & resonant',
        provider: 'OpenAI',
      },
      {
        id: 'sage',
        name: 'Sage',
        language: 'multi',
        gender: 'neutral',
        description: 'Calm & composed',
        provider: 'OpenAI',
      },
      {
        id: 'shimmer',
        name: 'Shimmer',
        language: 'multi',
        gender: 'female',
        description: 'Soft & pleasant',
        provider: 'OpenAI',
      },
      {
        id: 'verse',
        name: 'Verse',
        language: 'multi',
        gender: 'male',
        description: 'Rich & dynamic',
        provider: 'OpenAI',
      },
    ];
  }
}
