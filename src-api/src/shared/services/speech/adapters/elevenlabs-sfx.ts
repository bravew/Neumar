import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { nanoid } from 'nanoid';

import { createLogger } from '@/shared/utils/logger';

import type {
  SpeechAdapter,
  SpeechProviderConfig,
  TTSParams,
  TTSResult,
} from '../types';

const logger = createLogger('ElevenLabsSFX');

const MAX_PROMPT_CHARS = 500;

export class ElevenLabsSfxAdapter implements SpeechAdapter {
  readonly name = 'ElevenLabs SFX';
  readonly dataEgress = 'cloud';
  readonly supportsTTS = false;
  readonly supportsSTT = false;
  readonly supportsStreamingSTT = false;
  readonly supportsStreamingTTS = false;
  readonly supportsSFX = true;

  private readonly baseUrl: string;

  constructor(private readonly config: SpeechProviderConfig) {
    this.baseUrl = (config.baseUrl || 'https://api.elevenlabs.io').replace(
      /\/+$/,
      '',
    );
  }

  async synthesizeSfx(params: TTSParams): Promise<TTSResult> {
    const prompt = params.text.trim();
    if (prompt.length > MAX_PROMPT_CHARS) {
      return {
        success: false,
        provider: this.name,
        model: 'elevenlabs-sfx',
        errorCode: 'budget',
        error: `ElevenLabs SFX prompts must be ${MAX_PROMPT_CHARS} characters or fewer.`,
      };
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/sound-generation`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: prompt,
          ...(params.targetDuration
            ? { duration_seconds: params.targetDuration }
            : {}),
        }),
        signal: params.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('ElevenLabs SFX network error', { message });
      return {
        success: false,
        provider: this.name,
        model: 'elevenlabs-sfx',
        errorCode: 'provider',
        error: message,
      };
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      return {
        success: false,
        provider: this.name,
        model: 'elevenlabs-sfx',
        errorCode: classifyStatus(response.status, raw),
        error: `ElevenLabs SFX API error ${response.status}: ${sanitizeProviderError(
          raw,
          prompt,
        )}`,
      };
    }

    const audioData = Buffer.from(await response.arrayBuffer());
    let localPath: string | undefined;
    if (params.workDir) {
      await mkdir(params.workDir, { recursive: true });
      localPath = join(params.workDir, `elevenlabs_sfx_${nanoid()}.mp3`);
      await writeFile(localPath, audioData);
    }

    return {
      success: true,
      provider: this.name,
      model: 'elevenlabs-sfx',
      audioData,
      localPath,
      format: 'mp3',
    };
  }
}

function classifyStatus(status: number, body: string): TTSResult['errorCode'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) {
    return /quota|credit|limit/i.test(body) ? 'quota' : 'rate_limited';
  }
  return 'provider';
}

function sanitizeProviderError(raw: string, prompt: string) {
  const compact = raw.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!compact) return 'provider rejected the request';
  return compact.replaceAll(prompt, '[redacted prompt]');
}
