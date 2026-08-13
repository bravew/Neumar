/**
 * Speech Service — Router
 *
 * Automatically finds the best adapter for TTS or STT requests
 * by scanning all providers synced from the frontend settings.
 *
 * The router reads the `providers` setting from the backend SQLite DB
 * (synced from the frontend). This keeps credentials secure — they
 * never leave the backend process.
 *
 * @module speech/router
 */

import { getSetting } from '@/shared/db/operations';
import type { MediaDataEgress } from '@/shared/media/data-egress';
import { createLogger } from '@/shared/utils/logger';

import { ElevenLabsSfxAdapter } from './adapters/elevenlabs-sfx';
import { LocalSpeechAdapter } from './adapters/local';
import { isSilentPcm, pcmToWav } from './audio-utils';
import { createAdapterForProvider, isSTTModel, isTTSModel } from './registry';
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
} from './types';

const logger = createLogger('SpeechRouter');

/** TTL for the adapter discovery cache (ms). Avoids redundant DB reads during streaming TTS. */
const ADAPTER_CACHE_TTL_MS = 10_000;

let cachedAdapters: SpeechAdapter[] | null = null;
let cacheTimestamp = 0;

/** TTL for the voice list cache (ms). Voices rarely change — 5 minutes. */
const VOICE_CACHE_TTL_MS = 5 * 60 * 1000;

/** Cached voice lists keyed by provider filter ("__all__" for unfiltered). */
const voiceCache = new Map<
  string,
  { voices: VoiceInfo[]; timestamp: number }
>();

// ============================================================================
// Provider Discovery
// ============================================================================

/**
 * Read the full providers list from the synced settings DB.
 * Returns only enabled providers with a valid API key and base URL.
 */
function getEnabledProviders(): SpeechProviderConfig[] {
  try {
    const raw = getSetting('providers');
    if (!raw) {
      logger.info(
        'No providers setting found in DB — speech requires synced settings',
      );
      return appendEnvironmentProviders([]);
    }

    // The value may be double-stringified (JSON string stored as a JSON string).
    // Try parsing once; if the result is still a string, parse again.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.error('Invalid JSON in providers setting');
      return appendEnvironmentProviders([]);
    }

    // Handle double-stringified values (frontend sends JSON.stringify(array),
    // which may be stored as a string literal in some code paths)
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        logger.error('Double-stringified providers value is invalid JSON');
        return appendEnvironmentProviders([]);
      }
    }

    if (!Array.isArray(parsed)) {
      logger.error('Providers setting is not an array, got:', typeof parsed);
      return appendEnvironmentProviders([]);
    }

    const providers = parsed as unknown[];
    logger.debug(`Found ${providers.length} total providers in DB`);

    const enabled = providers
      .filter(
        (
          p,
        ): p is {
          id: string;
          name: string;
          apiKey: string;
          baseUrl: string;
          enabled: boolean;
          models: string[];
        } =>
          typeof p === 'object' &&
          p !== null &&
          'id' in p &&
          'apiKey' in p &&
          'baseUrl' in p &&
          typeof (p as Record<string, unknown>).apiKey === 'string' &&
          typeof (p as Record<string, unknown>).baseUrl === 'string' &&
          !!(p as Record<string, unknown>).apiKey &&
          !!(p as Record<string, unknown>).baseUrl &&
          (p as Record<string, unknown>).enabled !== false,
      )
      .map((p) => ({
        id: String(p.id),
        name: String(p.name ?? p.id),
        apiKey: p.apiKey,
        baseUrl: p.baseUrl.trim(),
        models: Array.isArray(p.models) ? p.models : [],
      }));

    logger.info(
      `Enabled providers: ${enabled.length} (${enabled.map((p) => `${p.name}[${p.models.length} models]`).join(', ')})`,
    );

    return appendEnvironmentProviders(enabled);
  } catch (error) {
    logger.error('Failed to read providers from settings:', error);
    return appendEnvironmentProviders([]);
  }
}

function appendEnvironmentProviders(
  providers: SpeechProviderConfig[],
): SpeechProviderConfig[] {
  const next = [...providers];
  const hasProvider = (needle: string) =>
    next.some(
      (provider) =>
        provider.id.toLowerCase().includes(needle) ||
        provider.baseUrl.toLowerCase().includes(needle),
    );

  if (process.env.ELEVENLABS_API_KEY && !hasProvider('elevenlabs')) {
    next.push({
      id: 'elevenlabs-env',
      name: 'ElevenLabs',
      apiKey: process.env.ELEVENLABS_API_KEY,
      baseUrl: 'https://api.elevenlabs.io',
      models: ['eleven_multilingual_v2', 'elevenlabs-sfx', 'scribe_v2'],
    });
  }
  if (process.env.SENSEAUDIO_API_KEY && !hasProvider('senseaudio')) {
    next.push({
      id: 'senseaudio-env',
      name: 'SenseAudio',
      apiKey: process.env.SENSEAUDIO_API_KEY,
      baseUrl: 'https://api.senseaudio.cn',
      models: ['senseaudio-tts-1.5-260319'],
    });
  }

  return next;
}

/**
 * Build adapters for all enabled providers that support speech.
 * Results are cached for ADAPTER_CACHE_TTL_MS to avoid redundant DB reads
 * during streaming TTS (called per sentence).
 *
 * The local speech adapter is always included because it requires no
 * API key or provider entry — it uses locally downloaded models.
 */
function discoverAdapters(): SpeechAdapter[] {
  const now = Date.now();
  if (cachedAdapters && now - cacheTimestamp < ADAPTER_CACHE_TTL_MS) {
    return cachedAdapters;
  }

  // Adapters changed — clear the voice cache so voices are re-fetched
  if (voiceCache.size > 0) {
    logger.debug('Adapter cache expired — clearing voice cache');
    voiceCache.clear();
  }

  const adapters: SpeechAdapter[] = [];

  // Discover adapters from configured providers first (OpenAI, Deepgram, etc.)
  // so cloud/streaming-capable providers take priority over local.
  const providers = getEnabledProviders();

  for (const provider of providers) {
    const adapter = createAdapterForProvider(provider);
    if (adapter) {
      adapters.push(adapter);
      logger.info(
        `Discovered speech adapter: ${adapter.name} (tts=${adapter.supportsTTS}, stt=${adapter.supportsSTT}, streamingSTT=${adapter.supportsStreamingSTT}, streamingTTS=${adapter.supportsStreamingTTS}) from provider "${provider.name}" (baseUrl=${provider.baseUrl})`,
      );
    } else {
      logger.debug(
        `Provider "${provider.name}" (baseUrl=${provider.baseUrl}, models=${provider.models.join(',')}) is not a speech provider — skipping`,
      );
    }
    if (isElevenLabsProvider(provider)) {
      adapters.push(new ElevenLabsSfxAdapter(provider));
      logger.info(
        `Discovered speech adapter: ElevenLabs SFX (sfx=true) from provider "${provider.name}"`,
      );
    }
  }

  // Always include the local adapter as a fallback — it needs no credentials
  // and uses on-device models (SenseVoice for STT, Kokoro for TTS).
  const localAdapter = new LocalSpeechAdapter({
    id: 'local',
    name: 'Local',
    apiKey: '',
    baseUrl: 'local',
    models: ['sensevoice', 'kokoro'],
  });
  adapters.push(localAdapter);
  logger.debug(
    `Registered local speech adapter (tts=${localAdapter.supportsTTS}, stt=${localAdapter.supportsSTT})`,
  );

  cachedAdapters = adapters;
  cacheTimestamp = now;

  return adapters;
}

// ============================================================================
// Adapter Finders
// ============================================================================

/** Provider names that are sub-engines of the Local adapter. */
const LOCAL_SUB_PROVIDERS = new Set([
  'kokoro',
  'pocket',
  'kitten',
  'local',
  'sensevoice',
  'whisper',
  'whisperx',
  'whisperx-local',
]);

function isElevenLabsProvider(provider: SpeechProviderConfig) {
  return (
    provider.id.toLowerCase().includes('elevenlabs') ||
    provider.baseUrl.toLowerCase().includes('elevenlabs.io') ||
    provider.models.some((model) => /^eleven[-_]/i.test(model))
  );
}

function adapterMatchesTerm(adapter: SpeechAdapter, term: string): boolean {
  const lower = term.toLowerCase();
  const name = adapter.name.toLowerCase();
  if (name.includes(lower)) return true;
  if (lower.includes('elevenlabs') && name.includes('elevenlabs')) return true;
  if (lower.includes('senseaudio') && name.includes('senseaudio')) return true;
  if (lower.includes('minimax') || /^speech-/i.test(term)) {
    return name.includes('minimax');
  }
  if (/gpt-4o-mini-tts|tts-1/i.test(term)) return name.includes('openai');
  if (LOCAL_SUB_PROVIDERS.has(lower)) return name.includes('local');
  return false;
}

/**
 * Find the first adapter that supports TTS.
 * Optionally prefer a specific provider name.
 */
function findTTSAdapter(preferredProvider?: string): SpeechAdapter | null {
  const adapters = discoverAdapters().filter((a) => a.supportsTTS);

  if (preferredProvider) {
    // Map local sub-providers (kokoro, pocket, kitten) to the "Local" adapter
    const normalized = LOCAL_SUB_PROVIDERS.has(preferredProvider.toLowerCase())
      ? 'local'
      : preferredProvider;
    const preferred = adapters.find((a) => adapterMatchesTerm(a, normalized));
    if (preferred) return preferred;
  }

  return adapters[0] ?? null;
}

function findSFXAdapter(preferredProvider?: string): SpeechAdapter | null {
  const adapters = discoverAdapters().filter((a) => a.supportsSFX);

  if (preferredProvider) {
    const preferred = adapters.find((a) =>
      adapterMatchesTerm(a, preferredProvider),
    );
    if (preferred) return preferred;
  }

  return adapters[0] ?? null;
}

/**
 * Find the first adapter that supports STT.
 * Optionally prefer a specific provider name.
 */
function findSTTAdapter(preferredProvider?: string): SpeechAdapter | null {
  const adapters = discoverAdapters().filter((a) => a.supportsSTT);

  if (preferredProvider) {
    const normalized = LOCAL_SUB_PROVIDERS.has(preferredProvider.toLowerCase())
      ? 'local'
      : preferredProvider;
    const preferred = adapters.find((a) => adapterMatchesTerm(a, normalized));
    if (preferred) return preferred;
  }

  return adapters[0] ?? null;
}

export interface SttProviderInfo {
  provider: string;
  dataEgress: MediaDataEgress;
}

export function getSttProviderInfo(
  preferredProvider?: string,
): SttProviderInfo | null {
  const adapter = findSTTAdapter(preferredProvider);
  if (!adapter) return null;
  return {
    provider: adapter.name,
    dataEgress: adapter.dataEgress,
  };
}

/**
 * Find the first adapter that supports streaming STT.
 * Optionally prefer a specific provider name.
 */
function findStreamingSTTAdapter(
  preferredProvider?: string,
): SpeechAdapter | null {
  const adapters = discoverAdapters().filter((a) => a.supportsStreamingSTT);

  if (preferredProvider) {
    const preferred = adapters.find((a) =>
      a.name.toLowerCase().includes(preferredProvider.toLowerCase()),
    );
    if (preferred) return preferred;
  }

  return adapters[0] ?? null;
}

/**
 * Find the first adapter that supports streaming TTS.
 * Optionally prefer a specific provider name.
 */
function findStreamingTTSAdapter(
  preferredProvider?: string,
): SpeechAdapter | null {
  const adapters = discoverAdapters().filter((a) => a.supportsStreamingTTS);

  if (preferredProvider) {
    const normalized = LOCAL_SUB_PROVIDERS.has(preferredProvider.toLowerCase())
      ? 'local'
      : preferredProvider;
    const preferred = adapters.find((a) =>
      a.name.toLowerCase().includes(normalized.toLowerCase()),
    );
    if (preferred) return preferred;
  }

  return adapters[0] ?? null;
}

// ============================================================================
// Public API — called by the MCP server tools
// ============================================================================

/**
 * Synthesize speech from text using the best available TTS provider.
 */
export async function synthesize(
  params: TTSParams & { provider?: string },
): Promise<TTSResult> {
  const adapter = findTTSAdapter(params.provider ?? params.model);

  if (!adapter) {
    return {
      success: false,
      provider: 'none',
      model: 'none',
      error:
        'No TTS provider configured. ' +
        'Add a provider with a TTS model (e.g., OpenAI, ElevenLabs) in Settings → Models.',
    };
  }

  if (!adapter.synthesize) {
    return {
      success: false,
      provider: adapter.name,
      model: 'none',
      error: `${adapter.name} adapter does not support TTS synthesis.`,
    };
  }

  logger.info(`Routing TTS synthesis to ${adapter.name}`);
  return adapter.synthesize(params);
}

export async function synthesizeSoundEffect(
  params: TTSParams & { provider?: string },
): Promise<TTSResult> {
  const adapter = findSFXAdapter(params.provider ?? params.model);

  if (!adapter?.synthesizeSfx) {
    return {
      success: false,
      provider: 'none',
      model: params.model ?? 'elevenlabs-sfx',
      errorCode: 'provider',
      error:
        'No SFX provider configured. Add ElevenLabs credentials in Settings or ELEVENLABS_API_KEY.',
    };
  }

  logger.info(`Routing SFX synthesis to ${adapter.name}`);
  return adapter.synthesizeSfx(params);
}

/**
 * Synthesize speech as an audio stream. Falls back to batch synthesis as a
 * single chunk when the selected adapter does not expose a native stream.
 */
export async function synthesizeStream(
  params: TTSParams & { provider?: string },
): Promise<{
  success: boolean;
  provider: string;
  model: string;
  format: string;
  stream?: AsyncGenerator<Buffer>;
  error?: string;
}> {
  // When the user explicitly picks a provider, honor it — even if it's
  // batch-only — instead of silently swapping to whichever adapter happens
  // to support streaming. Auto mode (no provider) prefers streaming.
  const isExplicit = Boolean(params.provider) && params.provider !== 'auto';
  const adapter = isExplicit
    ? findTTSAdapter(params.provider)
    : (findStreamingTTSAdapter() ?? findTTSAdapter());

  if (!adapter) {
    return {
      success: false,
      provider: 'none',
      model: 'none',
      format: params.format ?? 'pcm',
      error:
        'No TTS provider configured. Add a provider with a TTS model in Settings -> Models.',
    };
  }

  if (adapter.synthesizeStream) {
    logger.info(`Routing streaming TTS synthesis to ${adapter.name}`);
    return {
      success: true,
      provider: adapter.name,
      model: params.model ?? 'auto',
      format: params.format ?? 'pcm',
      stream: adapter.synthesizeStream(params),
    };
  }

  if (!adapter.synthesize) {
    return {
      success: false,
      provider: adapter.name,
      model: 'none',
      format: params.format ?? 'pcm',
      error: `${adapter.name} adapter does not support TTS synthesis.`,
    };
  }

  logger.info(
    `No streaming TTS adapter found; using batch fallback via ${adapter.name}`,
  );
  const result = await adapter.synthesize(params);
  if (!result.success || !result.audioData) {
    return {
      success: false,
      provider: result.provider,
      model: result.model,
      format: result.format ?? params.format ?? 'pcm',
      error: result.error ?? 'Synthesis failed',
    };
  }

  async function* oneChunk() {
    yield result.audioData!;
  }

  return {
    success: true,
    provider: result.provider,
    model: result.model,
    format: result.format ?? params.format ?? 'pcm',
    stream: oneChunk(),
  };
}

/**
 * Transcribe audio to text using the best available STT provider.
 */
export async function transcribe(
  params: STTParams & { provider?: string },
): Promise<STTResult> {
  const adapter = findSTTAdapter(params.provider);

  if (!adapter) {
    return {
      success: false,
      provider: 'none',
      model: 'none',
      dataEgress: 'local',
      error:
        'No STT provider configured. ' +
        'Add a provider with an STT model (e.g., OpenAI Whisper, Deepgram) in Settings → Models.',
    };
  }

  if (!adapter.transcribe) {
    return {
      success: false,
      provider: adapter.name,
      model: 'none',
      dataEgress: adapter.dataEgress,
      error: `${adapter.name} adapter does not support STT transcription.`,
    };
  }

  logger.info(`Routing STT transcription to ${adapter.name}`);
  const result = await adapter.transcribe(params);
  return { ...result, dataEgress: adapter.dataEgress };
}

/**
 * Create a streaming STT session using the best available provider.
 * Returns a session object the caller uses to stream audio and receive transcripts.
 *
 * When no streaming-capable adapter is available but a batch STT adapter exists,
 * a fallback session is created that accumulates audio chunks and runs batch
 * transcription when the session is closed — providing a seamless experience
 * for local-only setups (e.g., SenseVoice via sherpa-onnx).
 */
export function createStreamingSTTSession(
  config: StreamingSTTConfig & { provider?: string },
): StreamingSTTSession {
  // When the user explicitly picks a provider, honor that choice — even if
  // it's batch-only — instead of silently swapping to whichever adapter
  // happens to support streaming. Auto mode (no provider) prefers streaming.
  const isExplicit = Boolean(config.provider) && config.provider !== 'auto';

  if (isExplicit) {
    const userAdapter = findSTTAdapter(config.provider);
    if (userAdapter?.transcribeStream && userAdapter.supportsStreamingSTT) {
      logger.info(`Routing streaming STT session to ${userAdapter.name}`);
      return userAdapter.transcribeStream(config);
    }
    if (userAdapter?.transcribe) {
      logger.info(
        `${userAdapter.name} has no streaming STT; using batch fallback`,
      );
      return createBatchFallbackSTTSession(userAdapter, config);
    }
    // User picked something we can't satisfy — fall through to auto-select.
  }

  const streamingAdapter = findStreamingSTTAdapter();
  if (streamingAdapter?.transcribeStream) {
    logger.info(`Routing streaming STT session to ${streamingAdapter.name}`);
    return streamingAdapter.transcribeStream(config);
  }

  const batchAdapter = findSTTAdapter();
  if (batchAdapter?.transcribe) {
    logger.info(
      `No streaming STT adapter found; using batch fallback via ${batchAdapter.name}`,
    );
    return createBatchFallbackSTTSession(batchAdapter, config);
  }

  // No adapter at all — return a no-op session that immediately emits an error
  const errorMessage =
    'No STT provider configured. ' +
    'Add a provider with an STT model (e.g., OpenAI Whisper, Deepgram, or download a local model) in Settings → Models.';
  logger.error(errorMessage);
  return {
    sendAudio: () => undefined,
    onPartial: () => undefined,
    onFinal: () => undefined,
    onEndOfTurn: () => undefined,
    onVADStart: () => undefined,
    onVADEnd: () => undefined,
    onError: (cb) => {
      cb(new Error(errorMessage));
    },
    close: () => undefined,
  };
}

// ============================================================================
// Batch Fallback STT Session
// ============================================================================

/**
 * Create a "fake" streaming session that accumulates audio chunks in memory
 * and runs batch transcription when close() is called.
 *
 * This allows local-only setups (SenseVoice) to work through the same
 * WebSocket interface the frontend expects. The user records audio, and
 * when they stop, the full recording is transcribed in one shot.
 */
/** Maximum audio buffer size (10 MB) for batch fallback STT sessions. */
const MAX_BATCH_AUDIO_BYTES = 10 * 1024 * 1024;

/** Sample rate of raw PCM streamed from the frontend AudioWorklet (Hz). */
const BATCH_FALLBACK_SAMPLE_RATE = 16_000;

function createBatchFallbackSTTSession(
  adapter: SpeechAdapter,
  config: StreamingSTTConfig,
): StreamingSTTSession {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let finalCb: ((text: string) => void) | null = null;
  let errorCb: ((error: Error) => void) | null = null;
  let endOfTurnCb: (() => void) | null = null;
  let closed = false;

  return {
    sendAudio(chunk: Buffer): void {
      if (!closed) {
        if (totalBytes + chunk.byteLength > MAX_BATCH_AUDIO_BYTES) {
          logger.warn(
            'Batch fallback STT: audio buffer limit reached, dropping chunk',
          );
          return;
        }
        chunks.push(chunk);
        totalBytes += chunk.byteLength;
      }
    },

    onPartial: () => undefined, // Batch mode has no partial results
    onVADStart: () => undefined,
    onVADEnd: () => undefined,

    onFinal(cb: (text: string) => void): void {
      finalCb = cb;
    },

    onEndOfTurn(cb: () => void): void {
      endOfTurnCb = cb;
    },

    onError(cb: (error: Error) => void): void {
      errorCb = cb;
    },

    close(): void {
      if (closed) return;
      closed = true;

      if (totalBytes === 0) {
        logger.debug(
          'Batch fallback STT: no audio received, skipping transcription',
        );
        chunks.length = 0;
        return;
      }

      const rawPcm = Buffer.concat(chunks);
      chunks.length = 0; // Release memory immediately after concat

      if (isSilentPcm(rawPcm)) {
        logger.warn(
          'Batch fallback STT: captured audio is silent — likely a microphone permission issue',
        );
        errorCb?.(
          new Error(
            'Microphone captured silence. Check that the app has microphone access in System Settings → Privacy & Security → Microphone, and that the correct input device is selected.',
          ),
        );
        return;
      }

      const audioData = pcmToWav(rawPcm, BATCH_FALLBACK_SAMPLE_RATE);
      logger.info(
        `Batch fallback STT: transcribing ${audioData.byteLength} bytes via ${adapter.name}`,
      );

      // Run batch transcription asynchronously
      adapter.transcribe!({
        audioData,
        mimeType: 'audio/wav',
        language: config.language,
        model: config.model,
      })
        .then((result) => {
          if (result.success && result.text) {
            logger.debug('Batch fallback STT: transcription complete', {
              chars: result.text.length,
            });
            finalCb?.(result.text);
            endOfTurnCb?.();
          } else {
            const msg = result.error ?? 'Batch transcription returned no text';
            logger.error('Batch fallback STT: transcription failed', {
              error: msg,
            });
            errorCb?.(new Error(msg));
          }
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          logger.error('Batch fallback STT: unexpected error', {
            error: message,
          });
          errorCb?.(err instanceof Error ? err : new Error(message));
        });
    },
  };
}

/**
 * List all available TTS voices from ALL adapters that support TTS.
 * This aggregates voices from cloud providers and all local models so
 * the voice dropdown shows everything available.
 *
 * Results are cached for VOICE_CACHE_TTL_MS so that repeated calls
 * (e.g. the agent querying speech_list_voices, or the frontend
 * refreshing settings) don't re-hit external APIs every time.
 */
export async function listVoices(provider?: string): Promise<VoiceInfo[]> {
  // Run adapter discovery BEFORE checking voice cache so that provider
  // changes (e.g. ElevenLabs API key added) can invalidate the voice cache.
  const adapters = discoverAdapters().filter((a) => a.supportsTTS);

  const cacheKey = provider ?? '__all__';
  const now = Date.now();
  const cached = voiceCache.get(cacheKey);
  if (cached && now - cached.timestamp < VOICE_CACHE_TTL_MS) {
    logger.debug(
      `listVoices: returning cached result for "${cacheKey}" (${cached.voices.length} voices)`,
    );
    return cached.voices;
  }

  if (adapters.length === 0) {
    logger.info('No TTS provider available for listVoices');
    return [];
  }

  // If a specific provider is requested, only list from that one
  if (provider) {
    const adapter = adapters.find((a) =>
      a.name.toLowerCase().includes(provider.toLowerCase()),
    );
    if (adapter?.listVoices) {
      logger.info(`Listing voices from ${adapter.name}`);
      const voices = await adapter.listVoices();
      voiceCache.set(cacheKey, { voices, timestamp: now });
      return voices;
    }
    return [];
  }

  // Aggregate voices from all adapters in parallel — listVoices is networked
  // for cloud providers; sequential awaits add latency for no benefit.
  const allVoices: VoiceInfo[] = [];
  const seenIds = new Set<string>();

  const results = await Promise.all(
    adapters
      .filter((a) => a.listVoices)
      .map(async (adapter) => {
        try {
          return { adapter, voices: await adapter.listVoices!() };
        } catch (err) {
          logger.error(`Failed to list voices from ${adapter.name}:`, err);
          return { adapter, voices: [] as VoiceInfo[] };
        }
      }),
  );

  for (const { voices } of results) {
    for (const voice of voices) {
      if (!seenIds.has(voice.id)) {
        seenIds.add(voice.id);
        allVoices.push(voice);
      }
    }
  }

  logger.info(
    `Aggregated ${allVoices.length} voices from ${adapters.length} adapters`,
  );
  voiceCache.set(cacheKey, { voices: allVoices, timestamp: now });
  return allVoices;
}

/**
 * List all available speech capabilities broken down by type.
 * Useful for the agent to understand what's available.
 */
export function listCapabilities(): {
  ttsProviders: string[];
  sttProviders: string[];
  streamingSTTProviders: string[];
  streamingTTSProviders: string[];
  sfxProviders: string[];
} {
  const adapters = discoverAdapters();
  return {
    ttsProviders: adapters.filter((a) => a.supportsTTS).map((a) => a.name),
    sttProviders: adapters.filter((a) => a.supportsSTT).map((a) => a.name),
    streamingSTTProviders: adapters
      .filter((a) => a.supportsStreamingSTT)
      .map((a) => a.name),
    streamingTTSProviders: adapters
      .filter((a) => a.supportsStreamingTTS)
      .map((a) => a.name),
    sfxProviders: adapters.filter((a) => a.supportsSFX).map((a) => a.name),
  };
}

export function hasSpeechProvider(provider: string): boolean {
  const lower = provider.toLowerCase();
  return discoverAdapters().some((adapter) =>
    adapterMatchesTerm(adapter, lower),
  );
}

// Re-export model detection utilities for external use
export { isSTTModel, isTTSModel };
