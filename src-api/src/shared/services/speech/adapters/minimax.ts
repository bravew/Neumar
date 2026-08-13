/**
 * MiniMax Speech Adapter
 *
 * Implements synchronous T2A v2 over HTTP. MiniMax exposes
 * `language_boost` as a first-class request field for multilingual speech
 * recognition/pronunciation; DesignMode passes it through as `languageBoost`.
 *
 * API reference: https://platform.minimax.io/docs/api-reference/speech-t2a-http
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { nanoid } from 'nanoid';

import { logUsage } from '@/shared/services/usage-logger';
import { createLogger } from '@/shared/utils/logger';

import type {
  SpeechAdapter,
  SpeechProviderConfig,
  TTSParams,
  TTSResult,
} from '../types';

const logger = createLogger('MiniMaxSpeech');

const DEFAULT_TTS_MODEL = 'speech-2.8-turbo';
const DEFAULT_VOICE = 'English_expressive_narrator';
const DEFAULT_FORMAT = 'mp3';
const FORMAT_MAP: Record<string, 'mp3' | 'wav' | 'flac'> = {
  flac: 'flac',
  mp3: 'mp3',
  wav: 'wav',
};
const LANGUAGE_BOOST_BY_BCP47: Record<string, string> = {
  ar: 'Arabic',
  bg: 'Bulgarian',
  ca: 'Catalan',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  fa: 'Persian',
  fi: 'Finnish',
  fil: 'Filipino',
  fr: 'French',
  he: 'Hebrew',
  hi: 'Hindi',
  hr: 'Croatian',
  hu: 'Hungarian',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  ms: 'Malay',
  nl: 'Dutch',
  no: 'Norwegian',
  pl: 'Polish',
  pt: 'Portuguese',
  ro: 'Romanian',
  ru: 'Russian',
  sk: 'Slovak',
  sl: 'Slovenian',
  sv: 'Swedish',
  ta: 'Tamil',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  zh: 'Chinese',
  'zh-hk': 'Chinese,Yue',
  'zh-yue': 'Chinese,Yue',
};

interface MiniMaxT2AResponse {
  data?: {
    audio?: string;
    status?: number;
  } | null;
  extra_info?: {
    audio_format?: string;
    audio_length?: number;
    usage_characters?: number;
  };
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
}

export class MiniMaxSpeechAdapter implements SpeechAdapter {
  readonly name = 'MiniMax';
  readonly dataEgress = 'cloud';
  readonly supportsTTS = true;
  readonly supportsSTT = false;
  readonly supportsStreamingSTT = false;
  readonly supportsStreamingTTS = false;

  private readonly baseUrl: string;

  constructor(private readonly config: SpeechProviderConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
  }

  async synthesize(params: TTSParams): Promise<TTSResult> {
    const model = params.model ?? pickModel(this.config.models);
    const format = FORMAT_MAP[params.format ?? ''] ?? DEFAULT_FORMAT;
    const languageBoost =
      params.languageBoost ?? languageBoostFromLanguage(params.language);
    const request = {
      model,
      text: params.text,
      stream: false,
      language_boost: languageBoost,
      output_format: 'hex',
      voice_setting: {
        voice_id: params.voice ?? DEFAULT_VOICE,
        speed: params.speed ?? 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32_000,
        bitrate: 128_000,
        format,
        channel: 1,
      },
    };

    let response: Response;
    const startedAt = Date.now();
    try {
      response = await fetch(`${this.baseUrl}/v1/t2a_v2`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: params.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('MiniMax TTS network error', { message });
      return { success: false, provider: this.name, model, error: message };
    }

    const bodyText = await response.text();
    if (!response.ok) {
      return {
        success: false,
        provider: this.name,
        model,
        error: `MiniMax TTS API error ${response.status}: ${bodyText}`,
      };
    }

    let body: MiniMaxT2AResponse;
    try {
      body = JSON.parse(bodyText) as MiniMaxT2AResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        provider: this.name,
        model,
        error: `Invalid MiniMax TTS response: ${message}`,
      };
    }

    if (body.base_resp?.status_code && body.base_resp.status_code !== 0) {
      return {
        success: false,
        provider: this.name,
        model,
        error: `MiniMax TTS error ${body.base_resp.status_code}: ${
          body.base_resp.status_msg ?? 'unknown error'
        }`,
      };
    }
    if (!body.data?.audio) {
      return {
        success: false,
        provider: this.name,
        model,
        error: 'MiniMax TTS response did not include audio.',
      };
    }

    const audioData = Buffer.from(body.data.audio, 'hex');
    let localPath: string | undefined;
    if (params.workDir) {
      await mkdir(params.workDir, { recursive: true });
      localPath = join(params.workDir, `minimax_tts_${nanoid()}.${format}`);
      await writeFile(localPath, audioData);
    }

    logUsage({
      callType: 'speech',
      provider: 'minimax',
      model,
      unitType: 'character',
      unitCount: body.extra_info?.usage_characters ?? params.text.length,
      latencyMs: Date.now() - startedAt,
      metadata: {
        direction: 'tts',
        languageBoost,
      },
    });

    return {
      success: true,
      provider: this.name,
      model,
      audioData,
      localPath,
      duration: body.extra_info?.audio_length
        ? body.extra_info.audio_length / 1000
        : undefined,
      format: body.extra_info?.audio_format ?? format,
    };
  }
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = (baseUrl || 'https://api.minimax.io').replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
}

function pickModel(models: string[]) {
  return models.find((model) => /^speech-/i.test(model)) ?? DEFAULT_TTS_MODEL;
}

function languageBoostFromLanguage(language?: string) {
  if (!language) return 'auto';
  return LANGUAGE_BOOST_BY_BCP47[language.toLowerCase()] ?? 'auto';
}
