/**
 * Search Service — Shared Types
 *
 * Provider-agnostic interfaces for web search.
 * Every adapter (Tavily, Exa, Brave, …) implements these
 * so the router and MCP server never couple to a single vendor.
 *
 * @module search/types
 */

// ============================================================================
// Search Result (normalized across all providers)
// ============================================================================

/** A single search result, normalized to a common shape. */
export interface SearchResult {
  /** Page title */
  title: string;
  /** Page URL */
  url: string;
  /** Short text snippet / description */
  snippet: string;
  /** Full text content (Tavily, Exa, Jina return this) */
  content?: string;
  /** Publication date (ISO 8601) */
  publishedDate?: string;
  /** Relevance score (0-1, provider-dependent) */
  score?: number;
  /** Which provider returned this result */
  source: string;
  /** Thumbnail image URL */
  thumbnail?: string;
  /** Author name */
  author?: string;
}

// ============================================================================
// Search Response
// ============================================================================

/** Aggregated response from a search provider. */
export interface SearchResponse {
  /** Original query */
  query: string;
  /** Normalized results */
  results: SearchResult[];
  /** AI-generated answer summary (Tavily, Perplexity, Exa) */
  answer?: string;
  /** Citation URLs for the answer */
  citations?: string[];
  /** Provider that served these results */
  provider: string;
  /** Response latency in ms */
  latencyMs: number;
  /** Whether results came from cache */
  cached: boolean;
}

// ============================================================================
// Search Parameters
// ============================================================================

/** Parameters for a web search request. */
export interface SearchParams {
  /** Search query */
  query: string;
  /** Max results to return */
  maxResults?: number;
  /** Country code for regional results (e.g., 'US', 'CN') */
  country?: string;
  /** Language code (e.g., 'en', 'zh') */
  language?: string;
  /** Freshness filter */
  freshness?: 'day' | 'week' | 'month' | 'year';
  /** Domain inclusion filter */
  includeDomains?: string[];
  /** Domain exclusion filter */
  excludeDomains?: string[];
  /** Search type */
  type?: 'web' | 'news' | 'images' | 'academic';
  /** SafeSearch level */
  safeSearch?: 'off' | 'moderate' | 'strict';
}

// ============================================================================
// Search Adapter
// ============================================================================

/** Configuration passed to each adapter instance. */
export interface SearchAdapterConfig {
  apiKey?: string;
  baseUrl?: string;
  config?: Record<string, string>;
  timeoutMs: number;
}

/** Contract every search adapter must implement. */
export interface SearchAdapter {
  /** Provider identifier (e.g., 'tavily', 'brave') */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Whether this provider requires an API key */
  readonly requiresApiKey: boolean;
  /** Execute a search */
  search(params: SearchParams): Promise<SearchResponse>;
  /** Test connectivity and return latency */
  testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}

// ============================================================================
// Search Provider Config (synced from frontend settings)
// ============================================================================

/** Provider entry as stored in SearchConfig.providers. */
export interface SearchProviderEntry {
  /** Provider ID (e.g., 'tavily', 'brave', 'serper') */
  id: string;
  /** Display name */
  name: string;
  /** Whether this provider is enabled */
  enabled: boolean;
  /** API key (empty if not configured or key-free) */
  apiKey: string;
  /** Custom base URL (for self-hosted providers like SearXNG) */
  baseUrl?: string;
  /** Additional config (e.g., Google CSE search engine ID) */
  config?: Record<string, string>;
  /** Priority order (lower = higher priority, 0 = highest) */
  priority: number;
}

/** Master search service configuration. */
export interface SearchConfig {
  /** Master toggle — enables the search service */
  enabled: boolean;
  /** Override mode: 'auto' = non-Claude only, 'always' = all models, 'manual' = explicit tool call only */
  mode: 'auto' | 'always' | 'manual';
  /** Configured search providers (ordered by priority) */
  providers: SearchProviderEntry[];
  /** Max results per search (1-10) */
  maxResults: number;
  /** Search timeout in seconds */
  timeoutSeconds: number;
  /** Result cache TTL in minutes (0 = no cache) */
  cacheTtlMinutes: number;
  /** Default country code for regional results */
  defaultCountry?: string;
  /** Default language for results */
  defaultLanguage?: string;
  /** SafeSearch level */
  safeSearch: 'off' | 'moderate' | 'strict';
}

/** Default search configuration. */
export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  enabled: false,
  mode: 'auto',
  providers: [],
  maxResults: 5,
  timeoutSeconds: 10,
  cacheTtlMinutes: 15,
  safeSearch: 'moderate',
};

// ============================================================================
// Search Provider Preset (UI metadata)
// ============================================================================

/** Metadata for a supported search provider — drives the settings UI. */
export interface SearchProviderPreset {
  id: string;
  name: string;
  description: string;
  /** i18n key for localized description */
  descriptionKey: string;
  category:
    | 'ai-native'
    | 'serp'
    | 'academic'
    | 'privacy'
    | 'chinese'
    | 'self-hosted';
  requiresApiKey: boolean;
  apiKeyUrl?: string;
  defaultBaseUrl?: string;
  /** Additional config fields needed (e.g., Google CSE needs search engine ID) */
  extraConfigFields?: Array<{
    key: string;
    label: string;
    labelKey: string;
    placeholder: string;
    required: boolean;
  }>;
  /** Default priority (lower = higher priority) */
  defaultPriority: number;
}
