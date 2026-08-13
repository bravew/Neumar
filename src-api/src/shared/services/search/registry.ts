/**
 * Search — Provider Registry
 *
 * Maps provider IDs to adapter factory functions.
 * New providers are added by registering a factory here.
 *
 * Unlike the speech registry (which pattern-matches URLs/models),
 * search adapters are selected by explicit provider ID.
 *
 * @module search/registry
 */

import { createLogger } from '@/shared/utils/logger';

import { BraveAdapter } from './adapters/brave';
import { DuckDuckGoAdapter } from './adapters/duckduckgo';
import { ExaAdapter } from './adapters/exa';
import { GoogleCseAdapter } from './adapters/google-cse';
import { JinaAdapter } from './adapters/jina';
import { MetasoAdapter } from './adapters/metaso';
import { PerplexityAdapter } from './adapters/perplexity';
import { SearxngAdapter } from './adapters/searxng';
import { SerpApiAdapter } from './adapters/serpapi';
import { SerperAdapter } from './adapters/serper';
import { TavilyAdapter } from './adapters/tavily';
import { YandexAdapter } from './adapters/yandex';
import { YouAdapter } from './adapters/you';
import type { SearchAdapter, SearchAdapterConfig } from './types';

const logger = createLogger('SearchRegistry');

// ============================================================================
// Adapter Factories
// ============================================================================

type AdapterFactory = (config: SearchAdapterConfig) => SearchAdapter;

const REGISTRY = new Map<string, AdapterFactory>([
  ['tavily', (cfg) => new TavilyAdapter(cfg)],
  ['exa', (cfg) => new ExaAdapter(cfg)],
  ['brave', (cfg) => new BraveAdapter(cfg)],
  ['serper', (cfg) => new SerperAdapter(cfg)],
  ['serpapi', (cfg) => new SerpApiAdapter(cfg)],
  ['perplexity', (cfg) => new PerplexityAdapter(cfg)],
  ['you', (cfg) => new YouAdapter(cfg)],
  ['jina', (cfg) => new JinaAdapter(cfg)],
  ['google-cse', (cfg) => new GoogleCseAdapter(cfg)],
  ['duckduckgo', (cfg) => new DuckDuckGoAdapter(cfg)],
  ['searxng', (cfg) => new SearxngAdapter(cfg)],
  ['metaso', (cfg) => new MetasoAdapter(cfg)],
  ['yandex', (cfg) => new YandexAdapter(cfg)],
]);

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a search adapter for the given provider ID.
 * Returns null if the provider is unknown.
 */
export function createSearchAdapter(
  id: string,
  config: SearchAdapterConfig,
): SearchAdapter | null {
  const factory = REGISTRY.get(id);
  if (!factory) {
    logger.warn(`Unknown search adapter: ${id}`);
    return null;
  }
  return factory(config);
}

/**
 * Check whether a provider ID is registered.
 */
export function isKnownProvider(id: string): boolean {
  return REGISTRY.has(id);
}

/** Providers that work without an API key. */
const KEY_FREE_PROVIDERS = new Set(['duckduckgo', 'jina', 'searxng']);

/**
 * Check whether a provider requires an API key.
 * Returns true for unknown providers (safe default).
 */
export function providerRequiresApiKey(id: string): boolean {
  return !KEY_FREE_PROVIDERS.has(id);
}
