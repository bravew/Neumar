/**
 * Search Service — Public API
 *
 * Re-exports everything consumers need. Internal implementation
 * details (adapters, registry) stay private.
 *
 * @module search
 */

// Types
export type {
  SearchAdapter,
  SearchAdapterConfig,
  SearchConfig,
  SearchParams,
  SearchProviderEntry,
  SearchProviderPreset,
  SearchResponse,
  SearchResult,
} from './types';

export { DEFAULT_SEARCH_CONFIG } from './types';

// Router (main entry point for search operations)
export {
  getSearchConfig,
  isSearchEnabled,
  listProviders,
  search,
  testProvider,
} from './router';

// Registry (for advanced use cases)
export {
  createSearchAdapter,
  isKnownProvider,
  providerRequiresApiKey,
} from './registry';

// Presets (for settings UI)
export { SEARCH_PROVIDER_PRESETS } from './presets';
