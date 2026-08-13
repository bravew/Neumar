import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getSetting } from '@/shared/db/operations';
import {
  safeFetch,
  type SafeFetchResponse,
} from '@/shared/network-policy/fetch';
import { externalApiPolicy } from '@/shared/network-policy/schema';
import { createLogger } from '@/shared/utils/logger';
import type { MusicProviderId } from '@/shared/video/types';

import { getProviderConfig } from './store';

export type { MusicProviderId };

export interface MusicGenerationRequest {
  prompt: string;
  durationMs: number;
  tempoBpm?: number;
  mood?: string;
  provider?: MusicProviderId;
  model?: string;
  seed?: number;
  outputDir: string;
  signal?: AbortSignal;
}

export interface MusicGenerationResult {
  provider: MusicProviderId;
  model: string;
  filePath: string;
  format: 'mp3' | 'wav';
  sampleRate?: number;
  channels?: number;
  costCents: number;
  license: string;
  commercialUse: boolean;
  fallbackReason?: string;
}

interface StoredProvider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
  enabled?: boolean;
}

interface MusicProviderCredentials {
  apiKey: string;
  baseUrl: string;
  models: string[];
}

const logger = createLogger('VideoMusicProviders');
const fallbackWarnings = new Set<MusicProviderId>();
const PROVIDER_REQUEST_TIMEOUT_MS = 300_000;
const AUDIO_DOWNLOAD_TIMEOUT_MS = 120_000;

export async function generateMusicWithProvider(
  request: MusicGenerationRequest,
): Promise<MusicGenerationResult> {
  const provider = chooseMusicProvider(request.provider);
  const credentials = resolveMusicCredentials(provider);
  if (!credentials) {
    return writeSilentFallback(request, provider, 'missing-credentials');
  }

  try {
    if (provider === 'elevenlabs-music') {
      return await generateElevenLabsMusic(request, credentials);
    }
    if (provider === 'minimax-music') {
      return await generateMiniMaxMusic(request, credentials);
    }
    return await generateStableAudio(request, credentials);
  } catch (error) {
    logger.warn('video.music.provider_failed', {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
    return writeSilentFallback(
      request,
      provider,
      error instanceof Error ? error.message : 'provider-error',
    );
  }
}

export function createSilentWav(durationMs: number): Buffer {
  const sampleRate = 48000;
  const channels = 2;
  const bitsPerSample = 16;
  const sampleCount = Math.max(1, Math.ceil((durationMs / 1000) * sampleRate));
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function chooseMusicProvider(provider?: MusicProviderId): MusicProviderId {
  if (provider) return provider;
  if (resolveMusicCredentials('elevenlabs-music')) return 'elevenlabs-music';
  if (resolveMusicCredentials('stable-audio')) return 'stable-audio';
  if (resolveMusicCredentials('minimax-music')) return 'minimax-music';
  return 'elevenlabs-music';
}

async function generateElevenLabsMusic(
  request: MusicGenerationRequest,
  credentials: MusicProviderCredentials,
): Promise<MusicGenerationResult> {
  const providerConfig = getProviderConfig('elevenlabs-music');
  const model =
    request.model ?? stringSetting(providerConfig.settings.model) ?? 'music_v1';
  const outputFormat =
    stringSetting(providerConfig.settings.outputFormat) ?? 'mp3_44100_128';
  const endpointPath =
    stringSetting(providerConfig.settings.endpointPath) ?? '/v1/music';
  const url = new URL(
    endpointPath,
    `${credentials.baseUrl.replace(/\/+$/, '')}/`,
  );
  url.searchParams.set('output_format', outputFormat);

  const body = JSON.stringify({
    prompt: musicPrompt(request),
    model_id: model,
    music_length_ms: request.durationMs,
    ...(request.seed !== undefined ? { seed: request.seed } : {}),
  });

  const response = await safeFetch(url.toString(), externalApiPolicy(), {
    method: 'POST',
    headers: {
      'xi-api-key': credentials.apiKey,
      accept: 'audio/mpeg',
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
    body,
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    maxRedirects: 0,
    signal: request.signal,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `ElevenLabs Music API error ${
        response.status
      }: ${sanitizeProviderError(response.body.toString('utf8'), request.prompt)}`,
    );
  }

  const filePath = await writeAudioFile(
    request.outputDir,
    'elevenlabs',
    'mp3',
    response.body,
  );
  return {
    provider: 'elevenlabs-music',
    model,
    filePath,
    format: 'mp3',
    costCents: estimateMusicCostCents('elevenlabs-music', request.durationMs),
    license: 'provider-plan',
    commercialUse: true,
  };
}

/**
 * MiniMax Music 2.6 (https://platform.minimax.io/docs/api-reference/music-generation).
 *
 * We use the synchronous form (`stream: false`), which returns the whole track
 * as a hex-encoded string in `data.audio` in a single response — no chunk
 * accumulation. The bed is instrumental, so we send `prompt` only (no lyrics).
 * MiniMax wraps failures in `base_resp.status_code` (0 = ok; 1004 = auth,
 * 1008 = insufficient balance), so a 200 can still carry an error.
 */
async function generateMiniMaxMusic(
  request: MusicGenerationRequest,
  credentials: MusicProviderCredentials,
): Promise<MusicGenerationResult> {
  const providerConfig = getProviderConfig('minimax-music');
  const model =
    request.model ??
    stringSetting(providerConfig.settings.model) ??
    'music-2.6';
  const baseUrl = credentials.baseUrl.replace(/\/+$/, '');
  const body = JSON.stringify({
    model,
    prompt: musicPrompt(request),
    stream: false,
    output_format: 'hex',
    audio_setting: { sample_rate: 44_100, bitrate: 256_000, format: 'mp3' },
  });

  const response = await safeFetch(
    `${baseUrl}/v1/music_generation`,
    externalApiPolicy(),
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credentials.apiKey}`,
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
      },
      body,
      timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      maxRedirects: 0,
      signal: request.signal,
    },
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `MiniMax Music API error ${response.status}: ${sanitizeProviderError(
        response.body.toString('utf8'),
        request.prompt,
      )}`,
    );
  }

  const audio = readMiniMaxAudioHex(response.body.toString('utf8'));
  const filePath = await writeAudioFile(
    request.outputDir,
    'minimax',
    'mp3',
    Buffer.from(audio, 'hex'),
  );
  return {
    provider: 'minimax-music',
    model,
    filePath,
    format: 'mp3',
    costCents: estimateMusicCostCents('minimax-music', request.durationMs),
    license: 'provider-plan',
    commercialUse: true,
  };
}

/**
 * Parse a MiniMax music response, surfacing `base_resp` failures (1004 auth /
 * 1008 balance) and the missing-audio case as throwable errors.
 */
function readMiniMaxAudioHex(raw: string): string {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error('MiniMax Music response was not valid JSON');
  }
  const record = (body ?? {}) as {
    data?: { audio?: unknown };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  const code = record.base_resp?.status_code;
  if (typeof code === 'number' && code !== 0) {
    const label =
      code === 1004
        ? 'authentication failed'
        : code === 1008
          ? 'insufficient balance'
          : (record.base_resp?.status_msg ?? 'unknown error');
    throw new Error(`MiniMax Music error ${code}: ${label}`);
  }
  const audio = record.data?.audio;
  if (typeof audio !== 'string' || !audio) {
    throw new Error('MiniMax Music response did not include audio');
  }
  return audio;
}

async function generateStableAudio(
  request: MusicGenerationRequest,
  credentials: MusicProviderCredentials,
): Promise<MusicGenerationResult> {
  const providerConfig = getProviderConfig('stable-audio');
  const model =
    request.model ??
    stringSetting(providerConfig.settings.model) ??
    credentials.models.find((candidate) =>
      candidate.startsWith('stable-audio'),
    ) ??
    'stable-audio-3';
  const baseUrl = credentials.baseUrl.replace(/\/+$/, '');
  const endpointPath =
    stringSetting(providerConfig.settings.endpointPath) ??
    `/v2beta/audio/${encodeURIComponent(model)}/text-to-audio`;
  const outputFormat =
    stringSetting(providerConfig.settings.outputFormat) ?? 'mp3';
  const url = new URL(endpointPath, `${baseUrl}/`);
  const fields: Array<readonly [string, string]> = [
    ['prompt', musicPrompt(request)],
    ['duration', String(Math.ceil(request.durationMs / 1000))],
    ['output_format', outputFormat],
  ];
  if (request.seed !== undefined) fields.push(['seed', String(request.seed)]);
  const form = createMultipartFormData(fields);

  const response = await safeFetch(url.toString(), externalApiPolicy(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credentials.apiKey}`,
      accept: outputFormat === 'wav' ? 'audio/wav' : 'audio/mpeg',
      'content-type': form.contentType,
      'content-length': String(form.body.byteLength),
    },
    body: form.body,
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    maxRedirects: 0,
    signal: request.signal,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Stable Audio API error ${
        response.status
      }: ${sanitizeProviderError(response.body.toString('utf8'), request.prompt)}`,
    );
  }

  const bytes = await responseAudioBytes(response, request.signal);
  const format = outputFormat === 'wav' ? 'wav' : 'mp3';
  const filePath = await writeAudioFile(
    request.outputDir,
    'stable-audio',
    format,
    bytes,
  );
  return {
    provider: 'stable-audio',
    model,
    filePath,
    format,
    costCents: estimateMusicCostCents('stable-audio', request.durationMs),
    license: 'provider-plan',
    commercialUse: true,
  };
}

async function responseAudioBytes(
  response: SafeFetchResponse,
  signal?: AbortSignal,
): Promise<Buffer> {
  const contentType = response.headers['content-type'] ?? '';
  if (contentType.startsWith('audio/')) {
    return response.body;
  }

  let body: unknown = {};
  try {
    body = JSON.parse(response.body.toString('utf8')) as unknown;
  } catch {
    body = {};
  }
  const base64 = readStableAudioBase64(body);
  if (base64) return Buffer.from(base64, 'base64');
  const resultUrl = readString(body, 'url') ?? readString(body, 'audio_url');
  if (!resultUrl) {
    throw new Error('Stable Audio response did not include audio data');
  }
  const result = await safeFetch(resultUrl, externalApiPolicy(), {
    timeoutMs: AUDIO_DOWNLOAD_TIMEOUT_MS,
    signal,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      `Stable Audio result download failed: HTTP ${result.status}`,
    );
  }
  return result.body;
}

function createMultipartFormData(
  fields: ReadonlyArray<readonly [name: string, value: string]>,
): { body: Buffer; contentType: string } {
  const boundary = `neuma-${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of fields) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function readStableAudioBase64(value: unknown): string | undefined {
  const direct = readString(value, 'audio');
  if (direct) return direct;
  if (!value || typeof value !== 'object') return undefined;
  const artifacts = (value as Record<string, unknown>).artifacts;
  if (!Array.isArray(artifacts)) return undefined;
  return artifacts
    .map((artifact) => readString(artifact, 'base64'))
    .find((item): item is string => Boolean(item));
}

async function writeSilentFallback(
  request: MusicGenerationRequest,
  provider: MusicProviderId,
  fallbackReason: string,
): Promise<MusicGenerationResult> {
  if (!fallbackWarnings.has(provider)) {
    fallbackWarnings.add(provider);
    logger.warn('video.music.silent_fallback', { provider, fallbackReason });
  }
  const bytes = createSilentWav(request.durationMs);
  const filePath = await writeAudioFile(
    request.outputDir,
    'silent',
    'wav',
    bytes,
  );
  return {
    provider,
    model: 'silent-placeholder',
    filePath,
    format: 'wav',
    sampleRate: 48000,
    channels: 2,
    costCents: 0,
    license: 'local-placeholder',
    commercialUse: true,
    fallbackReason,
  };
}

async function writeAudioFile(
  outputDir: string,
  prefix: string,
  extension: 'mp3' | 'wav',
  bytes: Buffer,
): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(
    outputDir,
    `${prefix}-${crypto.randomUUID()}.${extension}`,
  );
  await fs.writeFile(filePath, bytes);
  return filePath;
}

function estimateMusicCostCents(
  provider: MusicProviderId,
  durationMs: number,
): number {
  const configured = getProviderConfig(provider).defaultCostCentsPerSec;
  const rate =
    typeof configured === 'number'
      ? configured
      : provider === 'elevenlabs-music'
        ? 1
        : 0.5;
  return Math.ceil((durationMs / 1000) * rate);
}

function resolveMusicCredentials(
  provider: MusicProviderId,
): MusicProviderCredentials | null {
  const fromEnv = credentialsFromEnv(provider);
  const stored = findStoredProvider(provider);
  const apiKey = fromEnv?.apiKey ?? stored?.apiKey;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl:
      stringSetting(getProviderConfig(provider).settings.baseUrl) ??
      fromEnv?.baseUrl ??
      stored?.baseUrl ??
      defaultMusicBaseUrl(provider),
    models: stored?.models ?? [],
  };
}

function credentialsFromEnv(
  provider: MusicProviderId,
): MusicProviderCredentials | null {
  if (provider === 'elevenlabs-music' && process.env.ELEVENLABS_API_KEY) {
    return {
      apiKey: process.env.ELEVENLABS_API_KEY,
      baseUrl: 'https://api.elevenlabs.io',
      models: ['music_v1'],
    };
  }
  const stableKey =
    process.env.STABILITY_API_KEY ??
    process.env.STABILITY_AI_API_KEY ??
    process.env.STABLE_AUDIO_API_KEY;
  if (provider === 'stable-audio' && stableKey) {
    return {
      apiKey: stableKey,
      baseUrl: 'https://api.stability.ai',
      models: ['stable-audio-3'],
    };
  }
  // Neuma-neutral env name (not html-video's OD_MINIMAX_* — Reject baseline).
  if (provider === 'minimax-music' && process.env.MINIMAX_API_KEY) {
    return {
      apiKey: process.env.MINIMAX_API_KEY,
      baseUrl: 'https://api.minimax.io',
      models: ['music-2.6'],
    };
  }
  return null;
}

function findStoredProvider(provider: MusicProviderId): StoredProvider | null {
  const matches =
    provider === 'elevenlabs-music'
      ? isElevenLabsProvider
      : provider === 'minimax-music'
        ? isMiniMaxProvider
        : isStabilityProvider;
  return readStoredProviders().find(matches) ?? null;
}

function readStoredProviders(): StoredProvider[] {
  const raw = getSetting('providers');
  if (!raw) return [];
  try {
    let parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredProvider).map((provider) => ({
      ...provider,
      models: provider.models.filter(
        (model): model is string => typeof model === 'string',
      ),
    }));
  } catch {
    return [];
  }
}

function isStoredProvider(value: unknown): value is StoredProvider {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.apiKey === 'string' &&
    Boolean(record.apiKey) &&
    typeof record.baseUrl === 'string' &&
    (record.enabled === undefined || record.enabled !== false) &&
    Array.isArray(record.models)
  );
}

function isElevenLabsProvider(provider: StoredProvider): boolean {
  return (
    includesProviderTerm(provider, 'elevenlabs') ||
    // `music(?!-\d)` so MiniMax's `music-2.6` model name doesn't cross-match
    // here and get auth'd against ElevenLabs' endpoint/headers.
    provider.models.some((model) => /^eleven[-_]|music(?!-\d)/i.test(model))
  );
}

function isStabilityProvider(provider: StoredProvider): boolean {
  return (
    includesProviderTerm(provider, 'stability') ||
    includesProviderTerm(provider, 'stable-audio') ||
    provider.models.some((model) => /^stable-audio/i.test(model))
  );
}

function isMiniMaxProvider(provider: StoredProvider): boolean {
  return (
    includesProviderTerm(provider, 'minimax') ||
    provider.models.some((model) => /^music-(?:2|cover)/i.test(model))
  );
}

function includesProviderTerm(provider: StoredProvider, term: string): boolean {
  return (
    provider.id.toLowerCase().includes(term) ||
    provider.name.toLowerCase().includes(term) ||
    provider.baseUrl.toLowerCase().includes(term)
  );
}

function defaultMusicBaseUrl(provider: MusicProviderId): string {
  if (provider === 'elevenlabs-music') return 'https://api.elevenlabs.io';
  if (provider === 'minimax-music') return 'https://api.minimax.io';
  return 'https://api.stability.ai';
}

function musicPrompt(request: MusicGenerationRequest): string {
  return [
    request.prompt.trim(),
    request.mood ? `Mood: ${request.mood.trim()}` : undefined,
    request.tempoBpm ? `Tempo: ${request.tempoBpm} BPM` : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n');
}

function sanitizeProviderError(raw: string, prompt: string): string {
  const compact = raw.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!compact) return 'provider rejected the request';
  return compact.replaceAll(prompt, '[redacted prompt]');
}

function stringSetting(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return typeof record[key] === 'string' ? record[key] : undefined;
}
