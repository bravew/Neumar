/**
 * ElevenLabs Speech Adapter
 *
 * Implements TTS via ElevenLabs Text-to-Speech API and STT via Scribe.
 * Supports both batch and streaming TTS. STT is batch-only (no streaming).
 *
 * Auth: `xi-api-key` header (not Bearer token).
 *
 * @module speech/adapters/elevenlabs
 */

import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import WebSocket from 'ws';

import { createLogger } from '@/shared/utils/logger';

import { pcmToWav as pcmToWavShared } from '../audio-utils';
import type {
  SpeechAdapter,
  SpeechProviderConfig,
  StreamingSTTConfig,
  StreamingSTTSession,
  STTParams,
  STTResult,
  TTSParams,
  TTSResult,
  VoiceInfo,
} from '../types';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';
const DEFAULT_STT_MODEL = 'scribe_v2';

const REALTIME_STT_WS_BASE =
  'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const REALTIME_STT_MODEL = 'scribe_v2_realtime';
const REALTIME_AUDIO_FORMAT = 'pcm_16000';
const REALTIME_SAMPLE_RATE = 16_000;
const REALTIME_VAD_SILENCE_SECS = 1.2;
/** Time given to the server to deliver a final transcript after we send a
 *  manual `commit:true` flush during close(). Without this wait, partials
 *  in flight are dropped and the user's last sentence vanishes from the UI. */
const REALTIME_CLOSE_DRAIN_MS = 1500;

// Well-known default voice (Rachel)
const FALLBACK_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

/** Curated multilingual default voices — shown when API is unreachable. */
const DEFAULT_VOICES: VoiceInfo[] = [
  {
    id: '21m00Tcm4TlvDq8ikWAM',
    name: '[ElevenLabs] Rachel',
    gender: 'female',
    language: 'multi',
    description: 'Calm & gentle',
    provider: 'ElevenLabs',
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    name: '[ElevenLabs] Bella',
    gender: 'female',
    language: 'multi',
    description: 'Soft & warm',
    provider: 'ElevenLabs',
  },
  {
    id: 'ErXwobaYiN019PkySvjV',
    name: '[ElevenLabs] Antoni',
    gender: 'male',
    language: 'multi',
    description: 'Clear & crisp',
    provider: 'ElevenLabs',
  },
  {
    id: 'TxGEqnHWrfWFTfGW9XjX',
    name: '[ElevenLabs] Josh',
    gender: 'male',
    language: 'multi',
    description: 'Deep & engaging',
    provider: 'ElevenLabs',
  },
  {
    id: 'pNInz6obpgDQGcFmaJgB',
    name: '[ElevenLabs] Adam',
    gender: 'male',
    language: 'multi',
    description: 'Deep & authoritative',
    provider: 'ElevenLabs',
  },
];

/** ElevenLabs voice IDs are 20-char alphanumeric strings. */
const ELEVENLABS_VOICE_ID_RE = /^[a-zA-Z0-9]{15,30}$/;

/** Languages we fetch shared voices for (parallel queries) */
const SUPPORTED_LANGUAGES = ['en', 'zh', 'fr', 'es'] as const;

/** Max shared voices to fetch per language */
const SHARED_VOICES_PER_LANG = 8;

/**
 * PCM sample rate used when ElevenLabs returns raw PCM.
 * 24 kHz matches the rest of the speech pipeline (OpenAI, Kokoro, and
 * `TTS_PCM_SAMPLE_RATE` on the web client). Using 16 kHz here caused the
 * client to play the buffer at 24 kHz, producing a 1.5× chipmunk pitch.
 * `pcm_44100` is gated to Pro tier and avoided as a default.
 */
const PCM_SAMPLE_RATE = 24_000;

/**
 * Map requested audio format to ElevenLabs output_format parameter.
 * ElevenLabs supports: mp3_*, pcm_16000, pcm_22050, pcm_24000, pcm_44100, etc.
 *
 * Note: ElevenLabs has no native WAV output — for `wav` requests we fetch raw
 * PCM and the caller wraps it in a RIFF header before returning.
 */
function resolveOutputFormat(requested?: string): {
  outputFormat: string;
  resultFormat: string;
} {
  switch (requested) {
    case 'pcm':
      return { outputFormat: 'pcm_24000', resultFormat: 'pcm' };
    case 'opus':
      return { outputFormat: 'mp3_44100_128', resultFormat: 'mp3' }; // ElevenLabs has no opus
    case 'wav':
      return { outputFormat: 'pcm_24000', resultFormat: 'wav' };
    default:
      return { outputFormat: 'mp3_44100_128', resultFormat: 'mp3' };
  }
}

/** Wrap raw PCM (S16LE, mono, 16kHz from ElevenLabs) in a RIFF/WAVE header. */
function pcmToWav(pcm: Buffer, sampleRate = PCM_SAMPLE_RATE): Buffer {
  return pcmToWavShared(pcm, sampleRate);
}

/**
 * Normalise language values from ElevenLabs API to consistent ISO 639-1 codes.
 * The user voices API returns full names ("English", "Chinese") while the
 * shared voices API returns short codes ("en", "zh").
 */
const LANG_NORMALIZE: Record<string, string> = {
  english: 'en',
  chinese: 'zh',
  mandarin: 'zh',
  french: 'fr',
  spanish: 'es',
  // Already-correct short codes pass through as-is
};

function normalizeLang(raw?: string): string | undefined {
  if (!raw) return undefined;
  return LANG_NORMALIZE[raw.toLowerCase()] ?? raw;
}

const STT_MIME_EXT: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp3': 'mp3',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'mp4',
  'audio/flac': 'flac',
};

/**
 * Clean up raw ElevenLabs description/descriptive text for display.
 * Truncates long descriptions and title-cases snake_case values.
 */
function humanizeDescription(raw?: string): string | undefined {
  if (!raw) return undefined;
  // Title-case snake_case API values like "social_media" → "Social media"
  const cleaned = raw.replace(/_/g, ' ').trim();
  if (!cleaned) return undefined;
  // Truncate long descriptions to keep dropdown labels short
  if (cleaned.length > 40) return cleaned.slice(0, 37) + '...';
  return cleaned;
}

/**
 * Filter out voices with ugly/technical names (e.g. "PVC_23-28-feb25_es-419_H_D_17").
 * Keeps voices whose name starts with a letter and has no sequences of 3+ digits.
 */
function isCleanVoiceName(name: string): boolean {
  // Strip the [ElevenLabs] prefix for checking
  const bare = name.replace(/^\[[^\]]+\]\s*/, '');
  // Reject names with long digit sequences (auto-generated IDs)
  if (/\d{3,}/.test(bare)) return false;
  // Reject names with multiple underscores (technical identifiers)
  if ((bare.match(/_/g) ?? []).length >= 2) return false;
  return true;
}

function classifyElevenLabsStatus(
  status: number,
  body: string,
): TTSResult['errorCode'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) {
    return /quota|credit|limit/i.test(body) ? 'quota' : 'rate_limited';
  }
  return 'provider';
}

/**
 * Build the request body shared by batch + streaming TTS. Mirrors the
 * official ElevenLabs JS SDK's BodyTextToSpeechFull shape:
 * https://github.com/elevenlabs/elevenlabs-js → reference.md
 *
 * - `voice_settings.speed` is preferred over a query-string speed (per-request
 *   override, no need to call `voices.settings.update`).
 * - `language_code` is forwarded as ISO 639-1; the server errors if the model
 *   doesn't support the supplied language, so we only send when provided.
 * - Streaming latency optimisations are tier-3 ("strong") by default — gives
 *   ~75 % of the achievable latency improvement without disabling text
 *   normalisation (tier 4 would mispronounce numbers/dates).
 */
function buildTtsBody(
  params: TTSParams,
  model: string,
  options: { optimizeStreamingLatency?: number } = {},
): Record<string, unknown> {
  const voiceSettings: Record<string, unknown> = {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0,
    use_speaker_boost: true,
  };
  // ElevenLabs voice_settings.speed is constrained to [0.7, 1.2] server-side
  // (returns 400 invalid_voice_settings outside this range). Our generic
  // TTSParams.speed range is [0.5, 2.0], so clamp here rather than rejecting.
  if (typeof params.speed === 'number') {
    voiceSettings.speed = Math.max(0.7, Math.min(1.2, params.speed));
  }

  const body: Record<string, unknown> = {
    text: params.text,
    model_id: model,
    voice_settings: voiceSettings,
  };
  if (params.language) body.language_code = params.language;
  if (options.optimizeStreamingLatency !== undefined) {
    body.optimize_streaming_latency = options.optimizeStreamingLatency;
  }
  return body;
}

function sanitizeElevenLabsError(raw: string, prompt: string): string {
  const compact = raw.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!compact) return 'provider rejected the request';
  return compact.replaceAll(prompt, '[redacted prompt]');
}

// ============================================================================
// ElevenLabs Response Shapes
// ============================================================================

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string; // premade | cloned | generated | professional
  labels?: Record<string, string>;
  preview_url?: string;
}

interface ElevenLabsVoicesResponse {
  voices: ElevenLabsVoice[];
}

interface ElevenLabsSTTResponse {
  text?: string;
  language_code?: string;
}

/** Shape returned by GET /v1/shared-voices */
interface SharedVoice {
  voice_id: string;
  name: string;
  language?: string;
  gender?: string;
  age?: string;
  descriptive?: string;
  description?: string;
  category?: string;
  preview_url?: string;
  use_case?: string;
}

interface SharedVoicesResponse {
  voices: SharedVoice[];
  has_more?: boolean;
}

// ============================================================================
// Adapter Implementation
// ============================================================================

const logger = createLogger('ElevenLabsSpeech');

export class ElevenLabsSpeechAdapter implements SpeechAdapter {
  readonly name = 'ElevenLabs';
  readonly dataEgress = 'cloud';
  readonly supportsTTS = true;
  readonly supportsSTT = true;
  readonly supportsStreamingTTS = true;
  readonly supportsStreamingSTT = true;

  private readonly config: SpeechProviderConfig;
  private readonly baseUrl: string;

  constructor(config: SpeechProviderConfig) {
    this.config = config;
    // Normalise base URL — strip trailing slash
    this.baseUrl = (config.baseUrl || 'https://api.elevenlabs.io').replace(
      /\/$/,
      '',
    );
  }

  // --------------------------------------------------------------------------
  // STT — Batch (Scribe)
  // --------------------------------------------------------------------------

  async transcribe(params: STTParams): Promise<STTResult> {
    const model = params.model ?? DEFAULT_STT_MODEL;
    const url = `${this.baseUrl}/v1/speech-to-text`;

    logger.debug('transcribe: sending audio to ElevenLabs Scribe', {
      model,
      mimeType: params.mimeType,
      language: params.language,
      bytes: params.audioData.byteLength,
    });

    const mimeType = params.mimeType ?? 'audio/wav';
    const ext = STT_MIME_EXT[mimeType] ?? 'wav';

    // Build multipart form data
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(params.audioData)], {
      type: mimeType,
    });
    formData.append('file', blob, `audio.${ext}`);
    formData.append('model_id', model);
    if (params.language) {
      formData.append('language_code', params.language);
    }
    // If raw PCM (no MIME or generic), tell ElevenLabs the encoding
    if (!params.mimeType || mimeType === 'audio/pcm') {
      formData.append('file_format', 'pcm_s16le_16');
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': this.config.apiKey },
        body: formData,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('transcribe: network error', { message });
      return { success: false, provider: this.name, model, error: message };
    }

    if (!response.ok) {
      const body = await response.text().catch((err: unknown) => {
        logger.warn('Failed to read error response body', {
          error: err instanceof Error ? err.message : String(err),
        });
        return '';
      });
      logger.error('transcribe: ElevenLabs API error', {
        status: response.status,
        body,
      });
      return {
        success: false,
        provider: this.name,
        model,
        error: `ElevenLabs API error ${response.status}: ${body}`,
      };
    }

    let data: ElevenLabsSTTResponse;
    try {
      data = (await response.json()) as ElevenLabsSTTResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('transcribe: failed to parse response JSON', { message });
      return {
        success: false,
        provider: this.name,
        model,
        error: `Failed to parse ElevenLabs response: ${message}`,
      };
    }

    const transcript = data.text ?? '';
    const detectedLanguage = data.language_code;

    logger.debug('transcribe: success', {
      chars: transcript.length,
      detectedLanguage,
    });

    return {
      success: true,
      provider: this.name,
      model,
      text: transcript,
      detectedLanguage,
    };
  }

  /**
   * ElevenLabs Scribe v2 Realtime STT over WebSocket. Audio is sent as
   * base64 inside JSON `input_audio_chunk` messages — not binary frames.
   * Server VAD (`commit_strategy=vad`) auto-commits a turn after
   * `vad_silence_threshold_secs` of silence. The xi-api-key header keeps
   * the credential on the backend; browser-direct flows would use a
   * single-use token query param instead.
   */
  transcribeStream(config: StreamingSTTConfig): StreamingSTTSession {
    const url = new URL(REALTIME_STT_WS_BASE);
    url.searchParams.set('model_id', config.model ?? REALTIME_STT_MODEL);
    url.searchParams.set('audio_format', REALTIME_AUDIO_FORMAT);
    url.searchParams.set('commit_strategy', 'vad');
    url.searchParams.set(
      'vad_silence_threshold_secs',
      String(REALTIME_VAD_SILENCE_SECS),
    );
    if (config.language) {
      url.searchParams.set('language_code', config.language);
    }

    logger.debug('transcribeStream: opening WebSocket', {
      model: config.model ?? REALTIME_STT_MODEL,
      language: config.language,
    });

    const ws = new WebSocket(url.toString(), {
      headers: { 'xi-api-key': this.config.apiKey },
    });

    let partialCb: ((text: string) => void) | null = null;
    let finalCb: ((text: string) => void) | null = null;
    let endOfTurnCb: (() => void) | null = null;
    let vadStartCb: (() => void) | null = null;
    let vadEndCb: (() => void) | null = null;
    let errorCb: ((error: Error) => void) | null = null;

    const pendingAudio: Buffer[] = [];
    let isOpen = false;
    let isClosed = false;

    const sendJson = (msg: Record<string, unknown>): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify(msg));
      } catch (err) {
        logger.debug('transcribeStream: send failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const sendChunk = (chunk: Buffer, commit = false): void => {
      sendJson({
        message_type: 'input_audio_chunk',
        audio_base_64: chunk.toString('base64'),
        commit,
        sample_rate: REALTIME_SAMPLE_RATE,
      });
    };

    ws.on('open', () => {
      logger.debug('transcribeStream: WebSocket open', {
        buffered: pendingAudio.length,
      });
      isOpen = true;
      for (const chunk of pendingAudio) sendChunk(chunk);
      pendingAudio.length = 0;
    });

    ws.on('message', (data: WebSocket.RawData) => {
      const raw = data.toString();
      let msg: {
        message_type?: string;
        text?: string;
        error?: string;
        message?: string;
      };
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      const text = msg.text ?? '';

      switch (msg.message_type) {
        case 'session_started':
          return;

        case 'speech_started':
          vadStartCb?.();
          return;

        case 'speech_ended':
          vadEndCb?.();
          return;

        case 'partial_transcript':
          if (text) partialCb?.(text);
          return;

        case 'committed_transcript':
        case 'committed_transcript_with_timestamps':
          if (text) finalCb?.(text);
          // VAD commits per utterance, so each commit is an end-of-turn.
          endOfTurnCb?.();
          return;

        case 'input_error':
        case 'error':
        case 'auth_error':
        case 'quota_exceeded':
        case 'rate_limited':
        case 'resource_exhausted': {
          const errMsg =
            msg.error ??
            msg.message ??
            text ??
            `ElevenLabs Realtime STT error: ${msg.message_type}`;
          logger.error('transcribeStream: server error', {
            type: msg.message_type,
            error: errMsg,
          });
          errorCb?.(new Error(errMsg));
          return;
        }

        default:
          logger.warn('transcribeStream: unhandled event', {
            type: msg.message_type,
            preview: raw.slice(0, 200),
          });
      }
    });

    ws.on('error', (err: Error) => {
      logger.error('transcribeStream: WebSocket error', {
        message: err.message,
      });
      errorCb?.(err);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason.toString().slice(0, 200);
      const isAbnormal = code !== 1000 && code !== 1005;
      if (isAbnormal && !isClosed) {
        logger.warn('transcribeStream: WebSocket closed abnormally', {
          code,
          reason: reasonStr,
        });
        errorCb?.(
          new Error(
            `ElevenLabs Realtime STT closed (${code}): ${reasonStr || 'no reason'}`,
          ),
        );
      }
      isOpen = false;
      isClosed = true;
    });

    return {
      sendAudio(chunk: Buffer): void {
        if (isClosed) return;
        if (isOpen) sendChunk(chunk);
        else pendingAudio.push(chunk);
      },
      onPartial(cb) {
        partialCb = cb;
      },
      onFinal(cb) {
        finalCb = cb;
      },
      onEndOfTurn(cb) {
        endOfTurnCb = cb;
      },
      onVADStart(cb) {
        vadStartCb = cb;
      },
      onVADEnd(cb) {
        vadEndCb = cb;
      },
      onError(cb) {
        errorCb = cb;
      },
      close(): void {
        if (isClosed) return;
        isClosed = true;
        // Force-commit any in-flight utterance: sending an empty chunk with
        // commit:true triggers `committed_transcript` for whatever the server
        // has buffered. Without this, partials that haven't reached the VAD
        // silence threshold are dropped and the user's last sentence vanishes
        // when they click the mic to stop.
        sendChunk(Buffer.alloc(0), true);
        setTimeout(() => {
          try {
            ws.close();
          } catch {
            // best effort
          }
        }, REALTIME_CLOSE_DRAIN_MS);
      },
    };
  }

  // --------------------------------------------------------------------------
  // TTS — Batch
  // --------------------------------------------------------------------------

  async synthesize(params: TTSParams): Promise<TTSResult> {
    const model =
      params.model && params.model !== 'elevenlabs-speech'
        ? params.model
        : DEFAULT_TTS_MODEL;
    // Use fallback voice if the provided voice isn't an ElevenLabs voice ID
    const voiceId =
      params.voice && ELEVENLABS_VOICE_ID_RE.test(params.voice)
        ? params.voice
        : FALLBACK_VOICE_ID;
    const { outputFormat, resultFormat } = resolveOutputFormat(params.format);
    // output_format is a QUERY parameter, not a body parameter
    const url = `${this.baseUrl}/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`;

    logger.debug('synthesize: sending TTS request to ElevenLabs', {
      model,
      voiceId,
      outputFormat,
      textLength: params.text.length,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/*',
        },
        body: JSON.stringify(buildTtsBody(params, model)),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('synthesize: network error', { message });
      return { success: false, provider: this.name, model, error: message };
    }

    if (!response.ok) {
      const body = await response.text().catch((err: unknown) => {
        logger.warn('Failed to read error response body', {
          error: err instanceof Error ? err.message : String(err),
        });
        return '';
      });
      logger.error('synthesize: ElevenLabs API error', {
        status: response.status,
        body,
      });
      return {
        success: false,
        provider: this.name,
        model,
        errorCode: classifyElevenLabsStatus(response.status, body),
        error: `ElevenLabs TTS API error ${response.status}: ${sanitizeElevenLabsError(
          body,
          params.text,
        )}`,
      };
    }

    let audioBuffer: Buffer;
    try {
      const arrayBuffer = await response.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('synthesize: failed to read response body', { message });
      return {
        success: false,
        provider: this.name,
        model,
        error: `Failed to read ElevenLabs TTS response: ${message}`,
      };
    }

    // PCM S16LE requires even byte count — truncate trailing byte if odd
    if (
      (resultFormat === 'pcm' || resultFormat === 'wav') &&
      audioBuffer.byteLength % 2 !== 0
    ) {
      audioBuffer = audioBuffer.subarray(0, audioBuffer.byteLength - 1);
    }

    // ElevenLabs has no native WAV; raw PCM is unplayable in Slack/macOS, so
    // wrap PCM in a RIFF header for both wav requests and disk writes.
    if (resultFormat === 'wav' || (resultFormat === 'pcm' && params.workDir)) {
      audioBuffer = pcmToWav(audioBuffer);
    }

    logger.debug('synthesize: success', { bytes: audioBuffer.byteLength });

    // Persist for path-based channel delivery (parity with OpenAI/Local adapters).
    let localPath: string | undefined;
    if (params.workDir) {
      try {
        await mkdir(params.workDir, { recursive: true });
        const ext = resultFormat === 'pcm' ? 'wav' : resultFormat;
        const filename = `tts_${crypto.randomUUID()}.${ext}`;
        localPath = join(params.workDir, filename);
        await writeFile(localPath, audioBuffer);
      } catch (err) {
        logger.warn('synthesize: failed to save audio to disk', {
          err: err instanceof Error ? err.message : String(err),
        });
        localPath = undefined;
      }
    }

    return {
      success: true,
      provider: this.name,
      model,
      audioData: audioBuffer,
      format: resultFormat,
      localPath,
    };
  }

  // --------------------------------------------------------------------------
  // TTS — Streaming
  // --------------------------------------------------------------------------

  async *synthesizeStream(params: TTSParams): AsyncGenerator<Buffer> {
    const model = params.model ?? DEFAULT_TTS_MODEL;
    const voiceId =
      params.voice && ELEVENLABS_VOICE_ID_RE.test(params.voice)
        ? params.voice
        : FALLBACK_VOICE_ID;
    const { outputFormat } = resolveOutputFormat(params.format);
    // output_format is a QUERY parameter, not a body parameter
    const url = `${this.baseUrl}/v1/text-to-speech/${voiceId}/stream?output_format=${outputFormat}`;

    logger.debug('synthesizeStream: sending streaming TTS request', {
      model,
      voiceId,
      outputFormat,
      textLength: params.text.length,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.config.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/*',
      },
      body: JSON.stringify(
        buildTtsBody(params, model, { optimizeStreamingLatency: 3 }),
      ),
      signal: params.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `ElevenLabs streaming TTS error ${response.status}: ${body}`,
      );
    }

    if (!response.body) {
      throw new Error('ElevenLabs streaming TTS: no response body');
    }

    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield Buffer.from(value);
      }
      logger.debug('synthesizeStream: stream complete');
    } finally {
      reader.releaseLock();
    }
  }

  // --------------------------------------------------------------------------
  // Voice Listing
  // --------------------------------------------------------------------------

  /**
   * Fetch voices from the user's library (/v1/voices).
   * Includes premade, cloned, and generated voices.
   */
  private async fetchUserVoices(signal?: AbortSignal): Promise<VoiceInfo[]> {
    const url = `${this.baseUrl}/v1/voices`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'xi-api-key': this.config.apiKey },
        signal,
      });
    } catch (err) {
      logger.warn('fetchUserVoices: network error', {
        message: err instanceof Error ? err.message : String(err),
      });
      return [];
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('elevenlabs_auth');
      }
      logger.warn('fetchUserVoices: API error', { status: response.status });
      return [];
    }

    let data: ElevenLabsVoicesResponse;
    try {
      data = (await response.json()) as ElevenLabsVoicesResponse;
    } catch {
      return [];
    }

    logger.debug('fetchUserVoices: got', { count: data.voices?.length ?? 0 });

    return (data.voices ?? [])
      .map((v) => ({
        id: v.voice_id,
        name: `[ElevenLabs] ${v.name}`,
        gender: (v.labels?.gender as VoiceInfo['gender']) ?? 'neutral',
        language: normalizeLang(v.labels?.language),
        description: humanizeDescription(v.labels?.description),
        previewUrl: v.preview_url,
        category: v.category,
        provider: 'ElevenLabs',
      }))
      .filter((v) => isCleanVoiceName(v.name));
  }

  /**
   * Fetch shared voices for a single language from /v1/shared-voices.
   * Used to fill in languages not covered by the user's library voices.
   */
  private async fetchSharedVoicesForLanguage(
    lang: string,
    signal?: AbortSignal,
  ): Promise<VoiceInfo[]> {
    const url = new URL(`${this.baseUrl}/v1/shared-voices`);
    url.searchParams.set('language', lang);
    url.searchParams.set('page_size', String(SHARED_VOICES_PER_LANG));

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { 'xi-api-key': this.config.apiKey },
        signal,
      });
    } catch (err) {
      logger.warn(`fetchSharedVoices[${lang}]: network error`, {
        message: err instanceof Error ? err.message : String(err),
      });
      return [];
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn(`fetchSharedVoices[${lang}]: API error`, {
        status: response.status,
        body: body.slice(0, 200),
      });
      return [];
    }

    let data: SharedVoicesResponse;
    try {
      data = (await response.json()) as SharedVoicesResponse;
    } catch {
      return [];
    }

    logger.debug(
      `fetchSharedVoices[${lang}]: got ${data.voices?.length ?? 0} voices`,
    );

    return (data.voices ?? [])
      .map((v) => ({
        id: v.voice_id,
        name: `[ElevenLabs] ${v.name}`,
        gender: (v.gender as VoiceInfo['gender']) ?? 'neutral',
        language: normalizeLang(v.language) ?? lang,
        description: humanizeDescription(v.descriptive ?? v.description),
        previewUrl: v.preview_url,
        category: v.category,
        provider: 'ElevenLabs',
      }))
      .filter((v) => isCleanVoiceName(v.name));
  }

  /**
   * List voices: user library voices (premade first) + shared voices to
   * fill gaps, capped at SHARED_VOICES_PER_LANG per language.
   */
  async listVoices(): Promise<VoiceInfo[]> {
    logger.debug('listVoices: fetching voices from ElevenLabs');

    // Fetch user voices + shared voices for each language in parallel
    // Bound total wait time so a hung API call doesn't block indefinitely
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const [userVoices, ...sharedResults] = await Promise.all([
      this.fetchUserVoices(controller.signal),
      ...SUPPORTED_LANGUAGES.map((lang) =>
        this.fetchSharedVoicesForLanguage(lang, controller.signal),
      ),
    ]).finally(() => clearTimeout(timeoutId));

    // Dedupe by voice_id — user library voices take priority over shared
    const seen = new Set<string>();
    const all: VoiceInfo[] = [];

    const addUnique = (batch: VoiceInfo[]) => {
      for (const v of batch) {
        if (!seen.has(v.id)) {
          seen.add(v.id);
          all.push(v);
        }
      }
    };

    addUnique(userVoices);
    for (const batch of sharedResults) addUnique(batch);
    addUnique(DEFAULT_VOICES);

    // Cap each language to SHARED_VOICES_PER_LANG voices
    const langCount = new Map<string, number>();
    const voices: VoiceInfo[] = [];
    for (const v of all) {
      const lang = v.language ?? 'unknown';
      const count = langCount.get(lang) ?? 0;
      if (count < SHARED_VOICES_PER_LANG) {
        voices.push(v);
        langCount.set(lang, count + 1);
      }
    }

    logger.debug('listVoices: done', {
      user: userVoices.length,
      shared: sharedResults.reduce((n, b) => n + b.length, 0),
      total: voices.length,
    });

    return voices;
  }
}
