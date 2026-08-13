/**
 * Search Service — Provider Presets
 *
 * Metadata for all supported search providers.
 * Drives the settings UI (provider list, API key URLs, config fields).
 *
 * @module search/presets
 */

import type { SearchProviderPreset } from './types';

export const SEARCH_PROVIDER_PRESETS: SearchProviderPreset[] = [
  // ── AI-Native Search ──
  {
    id: 'tavily',
    name: 'Tavily',
    description:
      'AI-optimized search with relevance scoring and answer summaries',
    descriptionKey: 'search.provider.tavily.desc',
    category: 'ai-native',
    requiresApiKey: true,
    apiKeyUrl: 'https://app.tavily.com/home',
    defaultPriority: 10,
  },
  {
    id: 'exa',
    name: 'Exa',
    description:
      'Semantic search, great for academic papers and deep content discovery',
    descriptionKey: 'search.provider.exa.desc',
    category: 'ai-native',
    requiresApiKey: true,
    apiKeyUrl: 'https://dashboard.exa.ai/api-keys',
    defaultPriority: 20,
  },
  {
    id: 'brave',
    name: 'Brave Search',
    description: 'Privacy-focused search with independent index, no tracking',
    descriptionKey: 'search.provider.brave.desc',
    category: 'privacy',
    requiresApiKey: true,
    apiKeyUrl: 'https://api.search.brave.com/app/keys',
    defaultPriority: 25,
  },
  {
    id: 'perplexity',
    name: 'Perplexity Sonar',
    description: 'Search-augmented AI answers with citations',
    descriptionKey: 'search.provider.perplexity.desc',
    category: 'ai-native',
    requiresApiKey: true,
    apiKeyUrl: 'https://www.perplexity.ai/settings/api',
    defaultPriority: 30,
  },
  {
    id: 'you',
    name: 'You.com',
    description: 'Web + news search with free livecrawl for full-page content',
    descriptionKey: 'search.provider.you.desc',
    category: 'ai-native',
    requiresApiKey: true,
    apiKeyUrl: 'https://you.com/dashboard',
    defaultPriority: 35,
  },

  // ── SERP APIs ──
  {
    id: 'serper',
    name: 'Serper',
    description:
      'Fast Google search API with excellent price-performance ratio',
    descriptionKey: 'search.provider.serper.desc',
    category: 'serp',
    requiresApiKey: true,
    apiKeyUrl: 'https://serper.dev/api-key',
    defaultPriority: 40,
  },
  {
    id: 'serpapi',
    name: 'SerpAPI',
    description:
      'Google search results API with support for 80+ search engines and regions',
    descriptionKey: 'search.provider.serpapi.desc',
    category: 'serp',
    requiresApiKey: true,
    apiKeyUrl: 'https://serpapi.com/manage-api-key',
    defaultPriority: 50,
  },

  // ── Chinese Search ──
  {
    id: 'metaso',
    name: '秘塔搜索 (Metaso)',
    description:
      'Chinese AI search engine with strong Chinese content coverage',
    descriptionKey: 'search.provider.metaso.desc',
    category: 'chinese',
    requiresApiKey: true,
    defaultPriority: 45,
  },

  // ── Content Extraction ──
  {
    id: 'jina',
    name: 'Jina Search',
    description: 'Search + URL-to-markdown conversion, works without API key',
    descriptionKey: 'search.provider.jina.desc',
    category: 'ai-native',
    requiresApiKey: false,
    apiKeyUrl: 'https://jina.ai/reader/',
    defaultPriority: 55,
  },

  // ── SERP (continued) ──
  {
    id: 'google-cse',
    name: 'Google CSE',
    description: 'Google Custom Search Engine, requires search engine ID',
    descriptionKey: 'search.provider.google-cse.desc',
    category: 'serp',
    requiresApiKey: true,
    apiKeyUrl: 'https://programmablesearchengine.google.com/',
    extraConfigFields: [
      {
        key: 'searchEngineId',
        label: 'Search Engine ID',
        labelKey: 'search.provider.google-cse.searchEngineId',
        placeholder: 'cx=...',
        required: true,
      },
    ],
    defaultPriority: 70,
  },

  // ── Regional ──
  {
    id: 'yandex',
    name: 'Yandex Search',
    description: 'Best for Russian and CIS region content',
    descriptionKey: 'search.provider.yandex.desc',
    category: 'serp',
    requiresApiKey: true,
    defaultPriority: 75,
  },

  // ── Self-Hosted ──
  {
    id: 'searxng',
    name: 'SearXNG',
    description:
      'Self-hosted meta search engine, aggregates 70+ providers, free',
    descriptionKey: 'search.provider.searxng.desc',
    category: 'self-hosted',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:8888',
    defaultPriority: 80,
  },

  // ── Privacy (free fallback) ──
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    description:
      'Free, key-free fallback. Limited to instant answers (not full web results)',
    descriptionKey: 'search.provider.duckduckgo.desc',
    category: 'privacy',
    requiresApiKey: false,
    defaultPriority: 100,
  },
];
