/**
 * Media Generation — Provider Registry
 *
 * Maps provider identifiers to adapter factory functions.
 * New providers are added by registering a factory here.
 *
 * The registry is pattern-based:
 *   • It matches provider IDs or base URLs to adapter factories.
 *   • A provider is considered "media-capable" if any of its models
 *     match image or video generation patterns.
 *
 * @module media-generation/registry
 */

import { BytePlusAdapter } from './adapters/byteplus';
import { CodexAdapter } from './adapters/codex';
import { FalMediaAdapter } from './adapters/fal';
import { GeminiAdapter } from './adapters/gemini';
import { HedraAdapter } from './adapters/hedra';
import { LeonardoImageAdapter } from './adapters/leonardo';
import { OpenAIAdapter } from './adapters/openai';
import {
  CustomOpenAIImageAdapter,
  ImageRouterAdapter,
} from './adapters/openai-compatible';
import { isNanoBananaEnabled, isNanoBananaModel } from './feature-flags';
import type { MediaGenerationAdapter, MediaProviderConfig } from './types';

// ============================================================================
// Adapter Factories
// ============================================================================

type AdapterFactory = (config: MediaProviderConfig) => MediaGenerationAdapter;

/**
 * Each entry maps a detection pattern to an adapter factory.
 * Detection is tried against the provider's base URL and model names.
 */
interface RegistryEntry {
  /** Human-readable label for logs */
  name: string;
  /**
   * Authoritative provider-ID prefix (Vercel AI SDK convention). When any of
   * the config's models starts with `${providerIdPrefix}:`, this entry wins
   * — checked *before* any regex patterns to avoid collisions like
   * `codex:gpt-image-2` matching OpenAI's `/gpt-image/` modelPattern.
   */
  providerIdPrefix?: string;
  /** Test against base URL */
  urlPattern?: RegExp;
  /** Test against any model name in the provider's model list */
  modelPattern?: RegExp;
  /** Factory — creates the adapter with the provider config */
  factory: AdapterFactory;
}

// ============================================================================
// Registry Entries
// ============================================================================

/**
 * Detection rules. Resolution happens in two phases:
 *   1. Exact `providerIdPrefix:` match on any model ID
 *   2. `urlPattern` / `modelPattern` regex (first match wins; order matters)
 */
const REGISTRY: RegistryEntry[] = [
  {
    name: 'Codex CLI',
    providerIdPrefix: 'codex',
    urlPattern: /^codex:\/\/local/i,
    modelPattern: /^codex(:|$)/i,
    factory: (config) => new CodexAdapter(config),
  },
  {
    name: 'BytePlus',
    urlPattern: /byteplus|bytedance|volcengine|ark\./i,
    modelPattern: /seedream|seedance|seededit|doubao-seedream|omnihuman/i,
    factory: (config) => new BytePlusAdapter(config),
  },
  {
    name: 'Hedra',
    providerIdPrefix: 'hedra',
    urlPattern: /hedra\.com/i,
    modelPattern: /^hedra(?::|-)|character-?3|lipsync/i,
    factory: (config) => new HedraAdapter(config),
  },
  {
    name: 'Leonardo.ai',
    providerIdPrefix: 'leonardo',
    urlPattern: /leonardo\.ai/i,
    modelPattern: /^leonardo(?::|-)|leonardo.*(phoenix|kino|flux|anime)/i,
    factory: (config) => new LeonardoImageAdapter(config),
  },
  {
    name: 'Custom OpenAI Image',
    providerIdPrefix: 'custom-image',
    modelPattern: /^custom-image(?::|$)/i,
    factory: (config) => new CustomOpenAIImageAdapter(config),
  },
  {
    name: 'ImageRouter',
    providerIdPrefix: 'imagerouter',
    urlPattern: /imagerouter\.io/i,
    modelPattern: /^imagerouter(?::|$)|image.?router/i,
    factory: (config) => new ImageRouterAdapter(config),
  },
  {
    name: 'fal.ai',
    providerIdPrefix: 'fal',
    urlPattern: /queue\.fal\.run|fal\.(ai|run)/i,
    modelPattern:
      /^fal(?::|$)|fal-ai\/|flux|recraft|ideogram|kling|hailuo|runway|ltx|wan|luma/i,
    factory: (config) => new FalMediaAdapter(config),
  },
  {
    name: 'OpenAI',
    urlPattern: /openai\.com/i,
    modelPattern: /dall-e|gpt-image|chatgpt-image|sora/i,
    factory: (config) => new OpenAIAdapter(config),
  },
  {
    name: 'Google Gemini',
    urlPattern: /googleapis\.com|generativelanguage\.google/i,
    modelPattern: /imagen|veo|gemini.*image/i,
    factory: (config) => new GeminiAdapter(config),
  },
];

function isNanoOnlyProvider(config: MediaProviderConfig): boolean {
  return config.models.length > 0 && config.models.every(isNanoBananaModel);
}

/**
 * Startup collision assertion: for every entry with a `providerIdPrefix`,
 * verify no *other* entry's `modelPattern` claims a `${prefix}:sample` model.
 * Fails loudly on module load if a new registry entry would re-introduce the
 * kind of silent mis-routing that sent `codex:gpt-image-2` to OpenAI.
 */
(function assertNoPatternCollisions(): void {
  for (const entry of REGISTRY) {
    if (!entry.providerIdPrefix) continue;
    const sample = `${entry.providerIdPrefix}:sample-model-id`;
    for (const other of REGISTRY) {
      if (other === entry) continue;
      if (other.modelPattern?.test(sample)) {
        throw new Error(
          `Media registry collision: "${other.name}" modelPattern matches "${sample}" ` +
            `intended for "${entry.name}". Narrow "${other.name}" modelPattern ` +
            `(e.g. anchor it, or exclude the "${entry.providerIdPrefix}:" prefix).`,
        );
      }
    }
  }
})();

// ============================================================================
// Public API
// ============================================================================

/**
 * Try to create an adapter for a given provider config.
 *
 * Returns `null` if the provider doesn't match any known media-generation
 * service (i.e., it's a chat-only provider).
 */
export function createAdapterForProvider(
  config: MediaProviderConfig,
): MediaGenerationAdapter | null {
  // Phase 1: authoritative `providerId:modelId` prefix match.
  for (const entry of REGISTRY) {
    if (!entry.providerIdPrefix) continue;
    const prefix = `${entry.providerIdPrefix.toLowerCase()}:`;
    if (config.models.some((m) => m.toLowerCase().startsWith(prefix))) {
      return entry.factory(config);
    }
  }

  if (isNanoBananaEnabled() && config.models.some(isNanoBananaModel)) {
    return new GeminiAdapter(config);
  }

  // Phase 2: URL / regex fallback — first match wins.
  for (const entry of REGISTRY) {
    if (entry.urlPattern?.test(config.baseUrl)) {
      if (
        entry.name === 'Google Gemini' &&
        isNanoOnlyProvider(config) &&
        !isNanoBananaEnabled()
      ) {
        continue;
      }
      return entry.factory(config);
    }
    if (
      entry.modelPattern &&
      config.models.some((m) => entry.modelPattern!.test(m))
    ) {
      return entry.factory(config);
    }
  }
  return null;
}

/**
 * Check if a specific model name is recognised as a media-generation model.
 */
export function isMediaModel(modelName: string): boolean {
  if (isNanoBananaModel(modelName)) {
    return isNanoBananaEnabled();
  }
  return REGISTRY.some(
    (entry) => entry.modelPattern && entry.modelPattern.test(modelName),
  );
}

/**
 * Check if a model is an image-generation model.
 */
export function isImageModel(modelName: string): boolean {
  if (isNanoBananaModel(modelName)) {
    return isNanoBananaEnabled();
  }
  const imagePatterns = [
    /seedream|seededit|doubao-seedream/i,
    /^leonardo(?::|-)|leonardo.*(phoenix|kino|flux|anime)/i,
    /^custom-image(?::|$)/i,
    /^imagerouter(?::|$)|image.?router/i,
    /^fal(?::|$)|fal-ai\/|flux|recraft|ideogram/i,
    /dall-e|gpt-image|chatgpt-image/i,
    /imagen|gemini.*image|image.*generation/i,
    /^codex:(gpt-image|dall-e|chatgpt-image)/i,
  ];
  return imagePatterns.some((p) => p.test(modelName));
}

/**
 * Check if a model is a video-generation model.
 */
export function isVideoModel(modelName: string): boolean {
  const videoPatterns = [
    /seedance/i,
    /sora/i,
    /veo/i,
    /^imagerouter(?::|$)/i,
    /^hedra(?::|-)|character-?3|lipsync/i,
    /^fal(?::|$)|fal-ai\/|kling|hailuo|runway|ltx|wan|luma/i,
    /omnihuman/i,
  ];
  return videoPatterns.some((p) => p.test(modelName));
}

/**
 * Well-known aliases for adapter names.
 * Maps user-friendly terms → registry entry names so the router can match
 * informal references like "nano banana" → "Google Gemini".
 */
const ADAPTER_ALIASES: Record<string, string> = {
  gemini: 'Google Gemini',
  google: 'Google Gemini',
  imagen: 'Google Gemini',
  seedream: 'BytePlus',
  seedance: 'BytePlus',
  byteplus: 'BytePlus',
  hedra: 'Hedra',
  'character-3': 'Hedra',
  lipsync: 'Hedra',
  leonardo: 'Leonardo.ai',
  'custom-image': 'Custom OpenAI Image',
  imagerouter: 'ImageRouter',
  'image-router': 'ImageRouter',
  fal: 'fal.ai',
  'fal.ai': 'fal.ai',
  // Must precede 'gpt-image'/'dall-e': alias lookup uses substring match, first win.
  codex: 'Codex CLI',
  'codex-cli': 'Codex CLI',
  'dall-e': 'OpenAI',
  'gpt-image': 'OpenAI',
  openai: 'OpenAI',
  sora: 'OpenAI',
};

/**
 * Resolve a user-provided term (model name, brand, keyword) to a registry
 * entry name. This allows flexible matching — e.g., "Seedream" → "BytePlus".
 *
 * Checks in order: explicit aliases, entry name substring, model pattern, URL pattern.
 * Returns `null` if no registry entry matches.
 */
export function resolveAdapterName(term: string): string | null {
  const lower = term.toLowerCase();

  if (lower.includes('nano banana')) {
    return isNanoBananaEnabled() ? 'Google Gemini' : null;
  }

  // Check explicit aliases first (handles multi-word terms like "nano banana")
  for (const [alias, name] of Object.entries(ADAPTER_ALIASES)) {
    if (lower.includes(alias)) return name;
  }

  for (const entry of REGISTRY) {
    if (entry.name.toLowerCase().includes(lower)) return entry.name;
    if (entry.modelPattern?.test(term)) return entry.name;
    if (entry.urlPattern?.test(term)) return entry.name;
  }
  return null;
}
