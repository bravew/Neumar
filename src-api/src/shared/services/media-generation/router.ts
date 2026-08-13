/**
 * Media Generation — Router
 *
 * Automatically finds the best adapter for image or video generation
 * by scanning all providers synced from the frontend settings.
 *
 * The router reads the `providers` setting from the backend SQLite DB
 * (synced from the frontend). This keeps credentials secure — they
 * never leave the backend process.
 *
 * @module media-generation/router
 */

import { getSetting } from '@/shared/db/operations';
import { resolveCodexBinaryPath } from '@/shared/utils/codex-binary';
import { createLogger } from '@/shared/utils/logger';

import { CodexAdapter } from './adapters/codex';
import {
  createAdapterForProvider,
  isImageModel,
  isVideoModel,
  resolveAdapterName,
} from './registry';
import type {
  GenerateImageParams,
  GenerateVideoParams,
  ImageGenerationResult,
  LipsyncParams,
  MediaGenerationAdapter,
  MediaProvenance,
  MediaProviderConfig,
  VideoTaskCreatedResult,
  VideoTaskStatusResult,
} from './types';

const logger = createLogger('MediaRouter');

/** Maximum age of a task entry in the provider map before auto-cleanup (1 hour) */
const TASK_MAP_TTL_MS = 3_600_000;

// ============================================================================
// Circuit Breaker — per-provider failure tracking
// ============================================================================

/**
 * Lightweight circuit breaker: tracks recent provider failures so the router
 * can skip providers that are known to be broken and auto-fallback to the
 * next healthy adapter.
 *
 * - A provider is marked "open" (unhealthy) after `FAILURE_THRESHOLD` failures
 *   within `FAILURE_WINDOW_MS`.
 * - An open circuit automatically resets after `CIRCUIT_RESET_MS` (half-open →
 *   the next request is allowed through as a probe).
 * - Successful requests reset the failure counter immediately.
 */

/** Number of failures within the window before the circuit opens */
const FAILURE_THRESHOLD = 2;
/** Time window for counting failures (ms) */
const FAILURE_WINDOW_MS = 60_000; // 1 minute
/** How long an open circuit stays open before allowing a probe (ms) */
const CIRCUIT_RESET_MS = 300_000; // 5 minutes

type CircuitState = 'closed' | 'open' | 'half-open';

interface ProviderCircuit {
  state: CircuitState;
  /** Timestamps of recent failures (within FAILURE_WINDOW_MS) */
  failures: number[];
  /** When the circuit was opened (for reset timing) */
  openedAt?: number;
}

const circuits = new Map<string, ProviderCircuit>();

function getCircuit(providerName: string): ProviderCircuit {
  let circuit = circuits.get(providerName);
  if (!circuit) {
    circuit = { state: 'closed', failures: [] };
    circuits.set(providerName, circuit);
  }
  return circuit;
}

/** Prune failures outside the sliding window */
function pruneFailures(circuit: ProviderCircuit, now: number): void {
  circuit.failures = circuit.failures.filter(
    (t) => now - t < FAILURE_WINDOW_MS,
  );
}

/** Check if a provider should be skipped (circuit is open) */
function isCircuitOpen(providerName: string): boolean {
  const circuit = getCircuit(providerName);
  const now = Date.now();

  if (circuit.state === 'open') {
    // Check if enough time has passed to allow a probe
    if (circuit.openedAt && now - circuit.openedAt >= CIRCUIT_RESET_MS) {
      circuit.state = 'half-open';
      logger.info(
        `Circuit for "${providerName}" is now half-open — allowing probe request`,
      );
      return false;
    }
    return true;
  }

  return false;
}

/** Record a failure for a provider */
function recordFailure(providerName: string): void {
  const circuit = getCircuit(providerName);
  const now = Date.now();

  pruneFailures(circuit, now);
  circuit.failures.push(now);

  if (
    circuit.state !== 'open' &&
    circuit.failures.length >= FAILURE_THRESHOLD
  ) {
    circuit.state = 'open';
    circuit.openedAt = now;
    logger.warn(
      `Circuit OPENED for "${providerName}" after ${circuit.failures.length} failures — will skip for ${CIRCUIT_RESET_MS / 1000}s`,
    );
  } else {
    logger.debug(
      `Failure recorded for "${providerName}" (${circuit.failures.length}/${FAILURE_THRESHOLD})`,
    );
  }
}

/** Record a success — resets the circuit to closed */
function recordSuccess(providerName: string): void {
  const circuit = getCircuit(providerName);
  if (circuit.state !== 'closed') {
    logger.info(
      `Circuit CLOSED for "${providerName}" after successful request`,
    );
  }
  circuit.state = 'closed';
  circuit.failures = [];
  circuit.openedAt = undefined;
}

// ============================================================================
// Provider Discovery
// ============================================================================

/**
 * Read the full providers list from the synced settings DB.
 * Returns only enabled providers with a valid API key and base URL.
 */
function getEnabledProviders(): MediaProviderConfig[] {
  try {
    const raw = getSetting('providers');
    if (!raw) {
      logger.info(
        'No providers setting found in DB — media generation requires synced settings',
      );
      return [];
    }

    // The value may be double-stringified (JSON string stored as a JSON string).
    // Try parsing once; if the result is still a string, parse again.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.error('Invalid JSON in providers setting');
      return [];
    }

    // Handle double-stringified values (frontend sends JSON.stringify(array),
    // which may be stored as a string literal in some code paths)
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        logger.error('Double-stringified providers value is invalid JSON');
        return [];
      }
    }

    if (!Array.isArray(parsed)) {
      logger.error('Providers setting is not an array, got:', typeof parsed);
      return [];
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

    return enabled;
  } catch (error) {
    logger.error('Failed to read providers from settings:', error);
    return [];
  }
}

/**
 * Build adapters for all enabled providers that support media generation.
 * Caches nothing — always reads fresh from DB (settings may change).
 */
function discoverAdapters(): MediaGenerationAdapter[] {
  const providers = getEnabledProviders();
  const adapters: MediaGenerationAdapter[] = [];

  for (const provider of providers) {
    const adapter = createAdapterForProvider(provider);
    if (adapter) {
      adapters.push(adapter);
      logger.info(
        `Discovered media adapter: ${adapter.name} (image=${adapter.supportsImage}, video=${adapter.supportsVideo}) from provider "${provider.name}" (baseUrl=${provider.baseUrl})`,
      );
    } else {
      logger.debug(
        `Provider "${provider.name}" (baseUrl=${provider.baseUrl}, models=${provider.models.join(',')}) is not a media provider — skipping`,
      );
    }
  }

  maybeAppendCodexAdapter(adapters);

  if (adapters.length === 0) {
    logger.info('No media generation adapters discovered from any provider');
  }

  return adapters;
}

const SYNTHETIC_CODEX_MODELS = ['codex:gpt-image-2'];

/**
 * Build a Codex adapter directly instead of going through
 * createAdapterForProvider — the registry's OpenAI modelPattern would
 * otherwise claim `codex:gpt-image-2` because it contains "gpt-image".
 */
function makeSyntheticCodexAdapter(): CodexAdapter {
  return new CodexAdapter({
    id: 'codex-local',
    name: 'Codex CLI (local)',
    apiKey: '',
    baseUrl: 'codex://local',
    models: [...SYNTHETIC_CODEX_MODELS],
  });
}

function maybeAppendCodexAdapter(adapters: MediaGenerationAdapter[]): void {
  if (adapters.some((a) => a.name === 'Codex CLI')) return;
  const binPath = resolveCodexBinaryPath();
  if (!binPath) return;

  adapters.push(makeSyntheticCodexAdapter());
  logger.info(`Discovered synthetic Codex CLI media adapter at ${binPath}`);
}

/**
 * Match an adapter by name or model keyword.
 *
 * First tries a direct substring match on adapter.name, then falls back
 * to resolving the term via registry patterns (e.g., "Seedream" → "BytePlus").
 */
function matchAdapter(
  adapters: MediaGenerationAdapter[],
  term: string,
): MediaGenerationAdapter | null {
  const lower = term.toLowerCase();

  // Direct name match (e.g., "BytePlus" matches "BytePlus ModelArk")
  const byName = adapters.find((a) => a.name.toLowerCase().includes(lower));
  if (byName) return byName;

  // Resolve via registry patterns (e.g., "Seedream" → "BytePlus")
  const resolvedName = resolveAdapterName(term);
  if (resolvedName) {
    const resolvedLower = resolvedName.toLowerCase();
    const byResolved = adapters.find((a) =>
      a.name.toLowerCase().includes(resolvedLower),
    );
    if (byResolved) return byResolved;
  }

  return null;
}

/**
 * Preferred image adapter order when the agent passes `provider=auto` (no
 * explicit preference). Adapters matched earlier win.
 *
 * Native image APIs come first — they return hosted URLs, handle editing
 * consistently, and don't blow up tool output with huge base64 blobs the way
 * OpenRouter-proxied Gemini chat-completions responses do.
 */
const AUTO_IMAGE_PREFERENCE = [
  'BytePlus',
  'OpenAI',
  'Leonardo',
  'ImageRouter',
  'Custom OpenAI Image',
  'Gemini',
  'Codex CLI',
];

function autoRankIndex(name: string): number {
  const lower = name.toLowerCase();
  for (let i = 0; i < AUTO_IMAGE_PREFERENCE.length; i++) {
    if (lower.includes(AUTO_IMAGE_PREFERENCE[i]!.toLowerCase())) return i;
  }
  return AUTO_IMAGE_PREFERENCE.length; // unknown adapters last
}

/**
 * Return image adapters ordered by preference, skipping circuit-open providers.
 * If a specific provider is requested, it is placed first regardless of circuit
 * state (the caller explicitly wants it), but remaining adapters are still
 * appended for fallback.
 */
function rankImageAdapters(
  preferredProvider?: string,
): MediaGenerationAdapter[] {
  const adapters = discoverAdapters().filter((a) => a.supportsImage);

  if (preferredProvider) {
    const preferred = matchAdapter(adapters, preferredProvider);
    if (preferred) {
      // Put preferred first, then the rest (excluding preferred) filtered by circuit
      const rest = adapters.filter(
        (a) => a.name !== preferred.name && !isCircuitOpen(a.name),
      );
      return [preferred, ...rest];
    }
  }

  // No preference — filter out circuit-open providers, then apply the
  // auto-preference order so dedicated image APIs (Seedream, DALL-E, Imagen)
  // outrank chat-completions-proxied alternatives.
  const byRank = (a: MediaGenerationAdapter, b: MediaGenerationAdapter) =>
    autoRankIndex(a.name) - autoRankIndex(b.name);
  const healthy = adapters.filter((a) => !isCircuitOpen(a.name)).sort(byRank);

  // If all providers are circuit-open, return them all (let the caller try anyway)
  if (healthy.length === 0 && adapters.length > 0) {
    logger.warn(
      'All image providers have open circuits — attempting all as last resort',
    );
    return [...adapters].sort(byRank);
  }

  return healthy;
}

/**
 * Return video adapters ordered by preference, skipping circuit-open providers.
 */
function rankVideoAdapters(
  preferredProvider?: string,
): MediaGenerationAdapter[] {
  const adapters = discoverAdapters().filter((a) => a.supportsVideo);

  if (preferredProvider) {
    const preferred = matchAdapter(adapters, preferredProvider);
    if (preferred) {
      const rest = adapters.filter(
        (a) => a.name !== preferred.name && !isCircuitOpen(a.name),
      );
      return [preferred, ...rest];
    }
  }

  const healthy = adapters.filter((a) => !isCircuitOpen(a.name));

  if (healthy.length === 0 && adapters.length > 0) {
    logger.warn(
      'All video providers have open circuits — attempting all as last resort',
    );
    return adapters;
  }

  return healthy;
}

const AUTO_LIPSYNC_PREFERENCE = ['Hedra', 'BytePlus', 'ImageRouter', 'OpenAI'];

function lipsyncRankIndex(name: string): number {
  const lower = name.toLowerCase();
  for (let i = 0; i < AUTO_LIPSYNC_PREFERENCE.length; i++) {
    if (lower.includes(AUTO_LIPSYNC_PREFERENCE[i]!.toLowerCase())) return i;
  }
  return AUTO_LIPSYNC_PREFERENCE.length;
}

function rankLipsyncAdapters(
  preferredProvider?: string,
): MediaGenerationAdapter[] {
  const adapters = discoverAdapters().filter(
    (a) => a.supportsLipsync && a.createLipsyncTask,
  );

  if (preferredProvider) {
    const preferred = matchAdapter(adapters, preferredProvider);
    if (preferred) {
      const rest = adapters.filter(
        (a) => a.name !== preferred.name && !isCircuitOpen(a.name),
      );
      return [preferred, ...rest];
    }
  }

  const healthy = adapters
    .filter((a) => !isCircuitOpen(a.name))
    .sort((a, b) => lipsyncRankIndex(a.name) - lipsyncRankIndex(b.name));

  if (healthy.length === 0 && adapters.length > 0) {
    logger.warn(
      'All lipsync providers have open circuits — attempting all as last resort',
    );
    return [...adapters].sort(
      (a, b) => lipsyncRankIndex(a.name) - lipsyncRankIndex(b.name),
    );
  }

  return healthy;
}

// ============================================================================
// In-memory task registry (maps taskId → { provider, createdAt } for polling)
// Entries are auto-cleaned after TASK_MAP_TTL_MS to prevent unbounded growth.
// ============================================================================

interface TaskEntry {
  provider: string;
  createdAt: number;
  /** Model used to create the task — needed so the status poller can surface
   *  the same provenance chip as the initial tool response. */
  model?: string;
  /** Requested provider/model at create time, for fallback disclosure on poll */
  requestedProvider?: string;
  requestedModel?: string;
  fallbackReason?: string;
}

const taskProviderMap = new Map<string, TaskEntry>();

/** Remove stale entries older than TASK_MAP_TTL_MS */
function cleanupTaskMap(): void {
  const now = Date.now();
  for (const [id, entry] of taskProviderMap) {
    if (now - entry.createdAt > TASK_MAP_TTL_MS) {
      taskProviderMap.delete(id);
    }
  }
}

// ============================================================================
// Public API — called by the MCP server tools
// ============================================================================

/**
 * Whole-token match for "codex"/"gpt-image" so unrelated substrings
 * (e.g. "codexis") don't misroute.
 */
const CODEX_PROMPT_HINT =
  /(^|[^a-z0-9])(codex|codex[- ]cli|gpt[- ]?image(?:-\d)?)([^a-z0-9]|$)/i;

interface MediaConfig {
  defaultImageProvider?: string;
  defaultImageModel?: string;
  defaultVideoProvider?: string;
  defaultVideoModel?: string;
  /**
   * When true, never silently fall back to another provider if the user-
   * requested provider fails. The failure is returned as-is so the caller
   * can decide. Recommended for compliance-sensitive deployments where
   * model identity must match what the user expects.
   */
  strictProvider?: boolean;
}

function getMediaConfig(): MediaConfig {
  try {
    const raw = getSetting('media');
    if (!raw) return {};
    let parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    if (parsed && typeof parsed === 'object') return parsed as MediaConfig;
  } catch {
    /* ignore malformed setting */
  }
  return {};
}

function isExplicitProvider(value: string | undefined): value is string {
  const trimmed = value?.trim();
  return !!trimmed && trimmed.toLowerCase() !== 'auto';
}

/**
 * If strict-provider mode is on AND the caller specified a provider, drop
 * every alternative from the adapter list so a failure cannot be silently
 * masked by a different model. When no provider was requested, strict mode
 * is a no-op — "auto" implies "pick whatever works".
 */
function applyStrictMode(
  adapters: MediaGenerationAdapter[],
  requested: string | undefined,
): MediaGenerationAdapter[] {
  if (!requested) return adapters;
  if (!getMediaConfig().strictProvider) return adapters;
  if (adapters.length <= 1) return adapters;
  const preferred = adapters[0]!;
  logger.info(
    `Strict-provider mode: limiting to requested adapter "${preferred.name}" (no fallback)`,
  );
  return [preferred];
}

function isOpenAIAdapter(adapter: MediaGenerationAdapter): boolean {
  return adapter.name.toLowerCase().includes('openai');
}

function applyImageMaskConstraints(
  adapters: MediaGenerationAdapter[],
): MediaGenerationAdapter[] {
  const constrained = adapters.filter(isOpenAIAdapter);
  if (constrained.length !== adapters.length) {
    logger.info(
      `Mask-based inpainting: limiting provider fallback to OpenAI-compatible adapters (${constrained.map((a) => a.name).join(', ') || 'none'})`,
    );
  }
  return constrained;
}

/**
 * Image edits require an adapter that actually forwards the reference image to
 * the underlying model. Adapters that opt out via `supportsImageEdit=false`
 * (e.g. an adapter whose underlying API has no input-image surface and would
 * otherwise produce a from-scratch image) are removed so the caller doesn't
 * get a fresh image when they asked for a transformation. If every adapter
 * opts out, return them all and let the call surface a useful error instead
 * of silently producing wrong output.
 */
function applyImageEditConstraints(
  adapters: MediaGenerationAdapter[],
): MediaGenerationAdapter[] {
  const editCapable = adapters.filter((a) => a.supportsImageEdit !== false);
  if (editCapable.length === 0) return adapters;
  if (editCapable.length !== adapters.length) {
    const dropped = adapters
      .filter((a) => a.supportsImageEdit === false)
      .map((a) => a.name)
      .join(', ');
    logger.info(
      `Image edit (reference_image_url): excluding edit-incapable adapters [${dropped}], using [${editCapable.map((a) => a.name).join(', ')}]`,
    );
  }
  return editCapable;
}

/**
 * Pick a provider in priority order:
 *   1. Explicit call arg
 *   2. User-configured default (`media.default{Image,Video}Provider`)
 *   3. Prompt keyword (image only — `prompt` undefined skips this)
 *   4. `undefined` → caller falls back to AUTO_*_PREFERENCE
 */
function resolveEffectiveProvider(
  kind: 'image' | 'video',
  explicit: string | undefined,
  prompt?: string,
): string | undefined {
  if (explicit) return explicit;

  const cfg = getMediaConfig();
  const cfgDefault =
    kind === 'image' ? cfg.defaultImageProvider : cfg.defaultVideoProvider;
  if (isExplicitProvider(cfgDefault)) {
    logger.info(
      `Using user-configured default ${kind} provider="${cfgDefault}"`,
    );
    return cfgDefault;
  }

  if (kind === 'image' && prompt && CODEX_PROMPT_HINT.test(prompt)) {
    logger.info('Inferred provider="codex" from prompt keyword');
    return 'codex';
  }

  return undefined;
}

/**
 * Generate an image using the best available provider.
 * Automatically falls back to the next healthy provider on failure.
 */
export async function generateImage(
  params: GenerateImageParams & { provider?: string; model?: string },
): Promise<ImageGenerationResult> {
  const effectiveRequested = resolveEffectiveProvider(
    'image',
    params.provider,
    params.prompt,
  );
  const rankedAdapters = rankImageAdapters(effectiveRequested);
  // When a reference image is provided, drop adapters that silently ignore it
  // (Codex CLI) BEFORE strict-mode is applied — otherwise a user default of
  // "codex" would produce a from-scratch image that doesn't match the source.
  const editConstrained = params.referenceImageUrl
    ? applyImageEditConstraints(rankedAdapters)
    : rankedAdapters;
  const adapters = params.maskImageUrl
    ? applyImageMaskConstraints(editConstrained)
    : applyStrictMode(editConstrained, effectiveRequested);

  const requestedProvider = effectiveRequested ?? undefined;
  const requestedModel = params.model;

  if (adapters.length === 0) {
    if (params.maskImageUrl) {
      return {
        success: false,
        provider: 'none',
        model: 'none',
        images: [],
        error:
          'Mask-based inpainting requires an OpenAI image edit provider (for example gpt-image-1). Configure OpenAI or remove the mask.',
      };
    }

    return {
      success: false,
      provider: 'none',
      model: 'none',
      images: [],
      error:
        'No image generation provider configured. ' +
        'Add a provider with an image model (e.g., Seedream, DALL-E, Imagen) in Settings → Models.',
    };
  }

  const errors: string[] = [];
  const firstError = { adapter: '', message: '' };

  for (const adapter of adapters) {
    if (!adapter.generateImage) {
      errors.push(`${adapter.name}: does not support image generation`);
      continue;
    }

    logger.info(`Routing image generation to ${adapter.name}`);
    const result = await adapter.generateImage(params);

    if (result.success) {
      recordSuccess(adapter.name);
      const provenance = buildProvenance({
        actualProvider: result.provider,
        actualModel: result.model,
        requestedProvider,
        requestedModel,
        firstError,
      });
      return provenance ? { ...result, provenance } : result;
    }

    // Failed — record and try next adapter
    recordFailure(adapter.name);
    const errMsg = result.error ?? 'unknown error';
    if (!firstError.adapter) {
      firstError.adapter = adapter.name;
      firstError.message = errMsg;
    }
    errors.push(`${adapter.name}: ${errMsg}`);
    logger.warn(
      `Image generation failed with ${adapter.name}: ${errMsg} — trying next provider`,
    );
  }

  // All adapters failed
  return {
    success: false,
    provider: adapters.map((a) => a.name).join(', '),
    model: 'none',
    images: [],
    error: `All providers failed: ${errors.join('; ')}`,
  };
}

/**
 * Build a MediaProvenance record when the actual provider differs from what
 * the caller requested. Matching is case-insensitive and tolerant of
 * display-name suffixes (e.g. requested="BytePlus", actual="BytePlus ModelArk").
 */
interface BuildProvenanceInput {
  actualProvider: string;
  actualModel: string | undefined;
  requestedProvider: string | undefined;
  requestedModel: string | undefined;
  firstError: { adapter: string; message: string };
}

function buildProvenance(i: BuildProvenanceInput): MediaProvenance | undefined {
  const providerMismatch =
    !!i.requestedProvider &&
    !i.actualProvider
      .toLowerCase()
      .includes(i.requestedProvider.toLowerCase()) &&
    !i.requestedProvider.toLowerCase().includes(i.actualProvider.toLowerCase());
  const modelMismatch =
    !!i.requestedModel && !!i.actualModel && i.requestedModel !== i.actualModel;

  if (!providerMismatch && !modelMismatch) return undefined;

  return {
    requestedProvider: i.requestedProvider,
    requestedModel: i.requestedModel,
    fallbackReason:
      providerMismatch && i.firstError.adapter
        ? `${i.firstError.adapter}: ${i.firstError.message}`
        : undefined,
  };
}

/**
 * Start a video generation task using the best available provider.
 * Automatically falls back to the next healthy provider on failure.
 */
export async function createVideoTask(
  params: GenerateVideoParams & { provider?: string; model?: string },
): Promise<VideoTaskCreatedResult> {
  const effectiveRequested = resolveEffectiveProvider('video', params.provider);
  const adapters = applyStrictMode(
    rankVideoAdapters(effectiveRequested),
    effectiveRequested,
  );
  const requestedProvider = effectiveRequested ?? undefined;
  const requestedModel = params.model;

  if (adapters.length === 0) {
    return {
      success: false,
      provider: 'none',
      model: 'none',
      taskId: '',
      error:
        'No video generation provider configured. ' +
        'Add a provider with a video model (e.g., Seedance, Sora, Veo) in Settings → Models.',
    };
  }

  const errors: string[] = [];
  const firstError = { adapter: '', message: '' };

  for (const adapter of adapters) {
    if (!adapter.createVideoTask) {
      errors.push(`${adapter.name}: does not support video generation`);
      continue;
    }

    logger.info(`Routing video generation to ${adapter.name}`);
    const result = await adapter.createVideoTask(params);

    if (result.success && result.taskId) {
      recordSuccess(adapter.name);
      const provenance = buildProvenance({
        actualProvider: result.provider,
        actualModel: result.model,
        requestedProvider,
        requestedModel,
        firstError,
      });
      // Remember which provider owns this task for later polling. Persist
      // provenance too so the status poller can echo the same disclosure.
      cleanupTaskMap();
      taskProviderMap.set(result.taskId, {
        provider: adapter.name,
        createdAt: Date.now(),
        model: result.model,
        requestedProvider: provenance?.requestedProvider,
        requestedModel: provenance?.requestedModel,
        fallbackReason: provenance?.fallbackReason,
      });
      return provenance ? { ...result, provenance } : result;
    }

    // Failed — record and try next adapter
    recordFailure(adapter.name);
    const errMsg = result.error ?? 'unknown error';
    if (!firstError.adapter) {
      firstError.adapter = adapter.name;
      firstError.message = errMsg;
    }
    errors.push(`${adapter.name}: ${errMsg}`);
    logger.warn(
      `Video task creation failed with ${adapter.name}: ${errMsg} — trying next provider`,
    );
  }

  // All adapters failed
  return {
    success: false,
    provider: adapters.map((a) => a.name).join(', '),
    model: 'none',
    taskId: '',
    error: `All providers failed: ${errors.join('; ')}`,
  };
}

/**
 * Start a lipsync video generation task using an adapter that explicitly
 * supports image/audio-driven avatar generation.
 */
export async function createLipsyncTask(
  params: LipsyncParams & { provider?: string; model?: string },
  signal?: AbortSignal,
): Promise<VideoTaskCreatedResult> {
  const effectiveRequested = resolveEffectiveProvider('video', params.provider);
  const adapters = applyStrictMode(
    rankLipsyncAdapters(effectiveRequested),
    effectiveRequested,
  );
  const requestedProvider = effectiveRequested ?? undefined;
  const requestedModel = params.model;

  if (adapters.length === 0) {
    return {
      success: false,
      provider: 'none',
      model: 'none',
      taskId: '',
      error:
        'No lipsync provider configured. Add a provider such as Hedra in Settings → Models.',
    };
  }

  const errors: string[] = [];
  const firstError = { adapter: '', message: '' };

  for (const adapter of adapters) {
    if (!adapter.createLipsyncTask) {
      errors.push(`${adapter.name}: does not support lipsync generation`);
      continue;
    }

    logger.info(`Routing lipsync generation to ${adapter.name}`);
    const result = await adapter.createLipsyncTask(params, signal);

    if (result.success && result.taskId) {
      recordSuccess(adapter.name);
      const provenance = buildProvenance({
        actualProvider: result.provider,
        actualModel: result.model,
        requestedProvider,
        requestedModel,
        firstError,
      });
      cleanupTaskMap();
      taskProviderMap.set(result.taskId, {
        provider: adapter.name,
        createdAt: Date.now(),
        model: result.model,
        requestedProvider: provenance?.requestedProvider,
        requestedModel: provenance?.requestedModel,
        fallbackReason: provenance?.fallbackReason,
      });
      return provenance ? { ...result, provenance } : result;
    }

    recordFailure(adapter.name);
    const errMsg = result.error ?? 'unknown error';
    if (!firstError.adapter) {
      firstError.adapter = adapter.name;
      firstError.message = errMsg;
    }
    errors.push(`${adapter.name}: ${errMsg}`);
    logger.warn(
      `Lipsync task creation failed with ${adapter.name}: ${errMsg} — trying next provider`,
    );
  }

  return {
    success: false,
    provider: adapters.map((a) => a.name).join(', '),
    model: 'none',
    taskId: '',
    error: `All providers failed: ${errors.join('; ')}`,
  };
}

/**
 * Check status of a video generation task.
 * The router remembers which provider created the task.
 */
export async function getVideoTaskStatus(
  taskId: string,
  signal?: AbortSignal,
): Promise<VideoTaskStatusResult> {
  const entry = taskProviderMap.get(taskId);
  const adapters = discoverAdapters().filter((a) => a.supportsVideo);

  // Try the adapter that created the task first
  if (entry) {
    const adapter = adapters.find((a) => a.name === entry.provider);
    if (adapter?.getVideoTaskStatus) {
      const result = await adapter.getVideoTaskStatus(taskId, signal);
      // Clean up completed tasks
      if (
        result.status === 'succeeded' ||
        result.status === 'failed' ||
        result.status === 'cancelled' ||
        result.status === 'expired'
      ) {
        taskProviderMap.delete(taskId);
      }
      // Re-attach provenance + remembered model so the poller's consumer
      // can display the same disclosure badge as the initial create response.
      const enriched = { ...result };
      if (entry.model && !enriched.model) enriched.model = entry.model;
      if (
        entry.requestedProvider ||
        entry.requestedModel ||
        entry.fallbackReason
      ) {
        enriched.provenance = {
          requestedProvider: entry.requestedProvider,
          requestedModel: entry.requestedModel,
          fallbackReason: entry.fallbackReason,
        };
      }
      return enriched;
    }
  }

  // Fallback: try each adapter until one succeeds
  const errors: string[] = [];
  for (const adapter of adapters) {
    if (adapter.getVideoTaskStatus) {
      try {
        const result = await adapter.getVideoTaskStatus(taskId, signal);
        if (result.success) return result;
        errors.push(`${adapter.name}: ${result.error ?? 'unknown error'}`);
      } catch (error) {
        errors.push(
          `${adapter.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return {
    success: false,
    provider: 'unknown',
    taskId,
    status: 'failed',
    error:
      errors.length > 0
        ? `All providers failed: ${errors.join('; ')}`
        : `No provider found for task ${taskId}. The task may have been created in a previous session.`,
  };
}

/**
 * List all available media generation capabilities.
 * Useful for the agent to understand what's available.
 *
 * Returns both adapter names and the specific models available for each,
 * so the planner can match user requests to the correct provider/model.
 */
export function listCapabilities(): {
  imageProviders: string[];
  videoProviders: string[];
  lipsyncProviders: string[];
  /** Detailed provider info including model names (for planning context) */
  providerDetails: Array<{
    name: string;
    imageModels: string[];
    videoModels: string[];
    supportsLipsync: boolean;
  }>;
} {
  const providers = getEnabledProviders();
  const adapters: Array<{
    adapter: MediaGenerationAdapter;
    models: string[];
  }> = [];

  for (const provider of providers) {
    const adapter = createAdapterForProvider(provider);
    if (adapter) {
      adapters.push({ adapter, models: provider.models });
    }
  }

  if (
    !adapters.some((a) => a.adapter.name === 'Codex CLI') &&
    resolveCodexBinaryPath()
  ) {
    adapters.push({
      adapter: makeSyntheticCodexAdapter(),
      models: [...SYNTHETIC_CODEX_MODELS],
    });
  }

  const providerDetails = adapters.map(({ adapter, models }) => ({
    name: adapter.name,
    imageModels: adapter.supportsImage
      ? models.filter((m) => isImageModel(m))
      : [],
    videoModels: adapter.supportsVideo
      ? models.filter((m) => isVideoModel(m))
      : [],
    supportsLipsync: Boolean(adapter.supportsLipsync),
  }));

  return {
    imageProviders: adapters
      .filter(({ adapter }) => adapter.supportsImage)
      .map(({ adapter }) => adapter.name),
    videoProviders: adapters
      .filter(({ adapter }) => adapter.supportsVideo)
      .map(({ adapter }) => adapter.name),
    lipsyncProviders: adapters
      .filter(({ adapter }) => adapter.supportsLipsync)
      .map(({ adapter }) => adapter.name),
    providerDetails,
  };
}

// Re-export model detection utilities for external use
export { isImageModel, isVideoModel };
