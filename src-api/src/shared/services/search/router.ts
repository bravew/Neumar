/**
 * Search Service — Router
 *
 * Main entry point for web search.
 *
 * Mirrors the speech/router.ts pattern:
 * 1. Read enabled providers from settings (sorted by priority)
 * 2. Check result cache (query hash → cached response)
 * 3. Try providers in priority order with failover
 * 4. Normalize results to common format
 * 5. Cache successful results
 *
 * Adapter instances cached for 10 seconds (same as speech router).
 * Search results cached for 15 minutes (configurable).
 *
 * @module search/router
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';
import { validateBaseUrlForFetch } from '@/shared/utils/url-validator';

import { createSearchAdapter, providerRequiresApiKey } from './registry';
import type {
  SearchAdapter,
  SearchConfig,
  SearchParams,
  SearchProviderEntry,
  SearchResponse,
} from './types';
import { DEFAULT_SEARCH_CONFIG } from './types';

const logger = createLogger('SearchRouter');

/** Zod schema for SearchConfig — validates DB values before use. */
const searchProviderEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  config: z.record(z.string(), z.string()).optional(),
  priority: z.number(),
});

const searchConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['auto', 'always', 'manual']),
  providers: z.array(searchProviderEntrySchema),
  maxResults: z.number(),
  timeoutSeconds: z.number(),
  cacheTtlMinutes: z.number(),
  defaultCountry: z.string().optional(),
  defaultLanguage: z.string().optional(),
  safeSearch: z.enum(['off', 'moderate', 'strict']),
});

// ============================================================================
// Caches
// ============================================================================

/** TTL for adapter instance cache (ms). */
const ADAPTER_CACHE_TTL_MS = 10_000;

/** TTL for parsed config cache (ms). Avoids redundant SQLite reads. */
const CONFIG_CACHE_TTL_MS = 5_000;

/** Max entries in the result cache to prevent unbounded growth. */
const MAX_RESULT_CACHE_SIZE = 500;

const adapterCache = new Map<
  string,
  { adapter: SearchAdapter; expiresAt: number }
>();

const resultCache = new Map<
  string,
  { response: SearchResponse; expiresAt: number }
>();

let configCache: { config: SearchConfig; expiresAt: number } | null = null;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Read the search configuration from the synced settings DB.
 * Cached for CONFIG_CACHE_TTL_MS to avoid repeated SQLite reads on hot paths.
 */
export function getSearchConfig(): SearchConfig {
  const now = Date.now();
  if (configCache && configCache.expiresAt > now) return configCache.config;

  try {
    const raw = getSetting('search');
    if (!raw) return DEFAULT_SEARCH_CONFIG;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return DEFAULT_SEARCH_CONFIG;
    }

    // Handle double-stringified values
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return DEFAULT_SEARCH_CONFIG;
      }
    }

    // Validate with Zod to reject corrupted DB values (e.g. enabled: "yes")
    const result = searchConfigSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn(`Invalid search config in DB: ${result.error.message}`);
      return DEFAULT_SEARCH_CONFIG;
    }
    const config: SearchConfig = result.data;
    configCache = { config, expiresAt: now + CONFIG_CACHE_TTL_MS };
    return config;
  } catch {
    return DEFAULT_SEARCH_CONFIG;
  }
}

/**
 * Check if the search service is enabled and has at least one usable provider.
 */
export function isSearchEnabled(): boolean {
  const config = getSearchConfig();
  return (
    config.enabled &&
    config.providers.some(
      (p) => p.enabled && (p.apiKey || !providerRequiresApiKey(p.id)),
    )
  );
}

// ============================================================================
// Adapter Management
// ============================================================================

function getOrCreateAdapter(
  provider: SearchProviderEntry,
  timeoutMs: number,
): SearchAdapter | null {
  const now = Date.now();
  const cached = adapterCache.get(provider.id);
  if (cached && cached.expiresAt > now) {
    return cached.adapter;
  }

  const adapter = createSearchAdapter(provider.id, {
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    config: provider.config,
    timeoutMs,
  });

  if (adapter) {
    adapterCache.set(provider.id, {
      adapter,
      expiresAt: now + ADAPTER_CACHE_TTL_MS,
    });
  }

  return adapter;
}

// ============================================================================
// Cache Helpers
// ============================================================================

function computeCacheKey(params: SearchParams): string {
  const payload = JSON.stringify({
    q: params.query,
    max: params.maxResults,
    country: params.country,
    lang: params.language,
    fresh: params.freshness,
    incl: params.includeDomains,
    excl: params.excludeDomains,
    type: params.type,
    safe: params.safeSearch,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function pruneResultCache(): void {
  if (resultCache.size === 0) return;
  const now = Date.now();
  for (const [key, entry] of resultCache) {
    if (entry.expiresAt <= now) {
      resultCache.delete(key);
    }
  }
}

setInterval(pruneResultCache, 5 * 60 * 1000).unref();

// ============================================================================
// Public API
// ============================================================================

/**
 * Execute a web search using the highest-priority enabled provider.
 * Automatically fails over to the next provider on error.
 */
export async function search(params: SearchParams): Promise<SearchResponse> {
  const config = getSearchConfig();
  if (!config.enabled || config.providers.length === 0) {
    throw new Error('Search service is not configured');
  }

  // Check cache
  const cacheKey = computeCacheKey(params);
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    logger.debug(
      `Cache hit for "${params.query}" (provider: ${cached.response.provider})`,
    );
    return { ...cached.response, cached: true };
  }

  // Get enabled providers sorted by priority
  const enabledProviders = config.providers
    .filter((p) => p.enabled && (p.apiKey || !providerRequiresApiKey(p.id)))
    .sort((a, b) => a.priority - b.priority);

  if (enabledProviders.length === 0) {
    throw new Error('No search providers configured with valid credentials');
  }

  const timeoutMs = config.timeoutSeconds * 1000;

  // Try each provider in priority order
  for (const provider of enabledProviders) {
    try {
      // SSRF validation for user-configured base URLs
      if (provider.baseUrl) {
        const validation = await validateBaseUrlForFetch(provider.baseUrl);
        if (!validation.valid) {
          logger.warn(
            `Skipping provider ${provider.id}: base URL blocked — ${validation.reason}`,
          );
          continue;
        }
      }

      const adapter = getOrCreateAdapter(provider, timeoutMs);
      if (!adapter) continue;

      const mergedParams: SearchParams = {
        ...params,
        maxResults: params.maxResults ?? config.maxResults,
        country: params.country ?? config.defaultCountry,
        language: params.language ?? config.defaultLanguage,
        safeSearch: params.safeSearch ?? config.safeSearch,
      };

      const start = Date.now();
      const response = await adapter.search(mergedParams);
      response.latencyMs = Date.now() - start;
      response.provider = provider.id;
      response.cached = false;

      // Cache the result (with bounded size)
      if (config.cacheTtlMinutes > 0) {
        if (resultCache.size >= MAX_RESULT_CACHE_SIZE) {
          const oldest = resultCache.keys().next().value;
          if (oldest) resultCache.delete(oldest);
        }
        resultCache.set(cacheKey, {
          response,
          expiresAt: Date.now() + config.cacheTtlMinutes * 60 * 1000,
        });
      }

      logger.info(
        `Search "${params.query}" → ${response.results.length} results via ${provider.id} (${response.latencyMs}ms)`,
      );
      return response;
    } catch (err) {
      logger.warn(
        `Search provider ${provider.id} failed: ${err}. Trying next...`,
      );
      continue;
    }
  }

  throw new Error(`All search providers failed for query: "${params.query}"`);
}

/**
 * List available search providers and their status.
 */
export function listProviders(): Array<{
  id: string;
  name: string;
  enabled: boolean;
  hasCredentials: boolean;
  priority: number;
}> {
  const config = getSearchConfig();
  return config.providers.map((p) => ({
    id: p.id,
    name: p.name,
    enabled: p.enabled,
    hasCredentials: !!p.apiKey || !providerRequiresApiKey(p.id),
    priority: p.priority,
  }));
}

/**
 * Test a specific search provider's connectivity.
 */
export async function testProvider(
  providerId: string,
  adapterConfig: {
    apiKey?: string;
    baseUrl?: string;
    config?: Record<string, string>;
  },
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  // SSRF validation
  if (adapterConfig.baseUrl) {
    const validation = await validateBaseUrlForFetch(adapterConfig.baseUrl);
    if (!validation.valid) {
      return {
        ok: false,
        latencyMs: 0,
        error: `URL blocked: ${validation.reason}`,
      };
    }
  }

  const adapter = createSearchAdapter(providerId, {
    apiKey: adapterConfig.apiKey,
    baseUrl: adapterConfig.baseUrl,
    config: adapterConfig.config,
    timeoutMs: 10_000,
  });

  if (!adapter) {
    return {
      ok: false,
      latencyMs: 0,
      error: `Unknown provider: ${providerId}`,
    };
  }

  return adapter.testConnection();
}
