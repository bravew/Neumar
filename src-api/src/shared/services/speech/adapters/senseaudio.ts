import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { nanoid } from 'nanoid';

import { createLogger } from '@/shared/utils/logger';

import type {
  SpeechAdapter,
  SpeechProviderConfig,
  TTSParams,
  TTSResult,
  VoiceInfo,
} from '../types';

const logger = createLogger('SenseAudioSpeech');

const DEFAULT_MODEL = 'senseaudio-tts-1.5-260319';
const DEFAULT_VOICE = 'female_0033_b';

export const SENSEAUDIO_VOICES: VoiceInfo[] = [
  {
    id: 'female_0033_b',
    name: 'SenseAudio Female 0033',
    language: 'zh',
    gender: 'female',
    category: 'standard',
    provider: 'SenseAudio',
  },
  {
    id: 'male_0297_b',
    name: 'SenseAudio Male 0297',
    language: 'zh',
    gender: 'male',
    category: 'standard',
    provider: 'SenseAudio',
  },
  {
    id: 'female_0088_b',
    name: 'SenseAudio Female 0088',
    language: 'en',
    gender: 'female',
    category: 'standard',
    provider: 'SenseAudio',
  },
  {
    id: 'male_0095_b',
    name: 'SenseAudio Male 0095',
    language: 'en',
    gender: 'male',
    category: 'standard',
    provider: 'SenseAudio',
  },
];

interface SenseAudioT2AResponse {
  data?: {
    audio?: string;
  };
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
}

export class SenseAudioSpeechAdapter implements SpeechAdapter {
  readonly name = 'SenseAudio';
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
    const model =
      params.model && params.model !== 'senseaudio-tts'
        ? params.model
        : pickModel(this.config.models);
    const request = {
      model,
      text: params.text,
      stream: false,
      voice_setting: {
        voice_id: params.voice ?? DEFAULT_VOICE,
        speed: params.speed ?? 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        format: 'mp3',
        sample_rate: 32_000,
        bitrate: 128_000,
        channel: 'stereo',
      },
    };

    let response: Response;
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
      logger.error('SenseAudio TTS network error', { message });
      return failure(this.name, model, 'provider', message);
    }

    const bodyText = await response.text();
    if (!response.ok) {
      const errorCode =
        response.status === 401 || response.status === 403
          ? 'auth'
          : response.status === 429
            ? 'rate_limited'
            : 'provider';
      return failure(
        this.name,
        model,
        errorCode,
        `SenseAudio TTS API error ${response.status}`,
      );
    }

    let body: SenseAudioT2AResponse;
    try {
      body = JSON.parse(bodyText) as SenseAudioT2AResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure(
        this.name,
        model,
        'provider',
        `Invalid SenseAudio TTS response: ${message}`,
      );
    }

    if (body.base_resp?.status_code && body.base_resp.status_code !== 0) {
      const errorCode =
        body.base_resp.status_code === 401 || body.base_resp.status_code === 403
          ? 'auth'
          : 'provider';
      return failure(
        this.name,
        model,
        errorCode,
        `SenseAudio TTS error ${body.base_resp.status_code}: ${
          body.base_resp.status_msg ?? 'unknown error'
        }`,
      );
    }
    if (!body.data?.audio) {
      return failure(
        this.name,
        model,
        'provider',
        'SenseAudio TTS response did not include audio.',
      );
    }

    const audioData = Buffer.from(body.data.audio, 'hex');
    let localPath: string | undefined;
    if (params.workDir) {
      await mkdir(params.workDir, { recursive: true });
      localPath = join(params.workDir, `senseaudio_tts_${nanoid()}.mp3`);
      await writeFile(localPath, audioData);
    }

    return {
      success: true,
      provider: this.name,
      model,
      audioData,
      localPath,
      format: 'mp3',
    };
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return SENSEAUDIO_VOICES;
  }
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = (baseUrl || 'https://api.senseaudio.cn')
    .trim()
    .split(/[?#]/, 1)[0]!
    .replace(/\/+$/, '');
  return trimmed.replace(/\/v1$/i, '');
}

function pickModel(models: string[]) {
  return (
    models.find((model) => /senseaudio.*tts|tts.*senseaudio/i.test(model)) ??
    DEFAULT_MODEL
  );
}

function failure(
  provider: string,
  model: string,
  errorCode: TTSResult['errorCode'],
  error: string,
): TTSResult {
  logger.warn('byok_tts_failed', {
    provider: 'senseaudio',
    kind: errorCode,
  });
  return {
    success: false,
    provider,
    model,
    errorCode,
    error,
  };
}
