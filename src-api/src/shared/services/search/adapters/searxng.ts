/**
 * SearXNG Search Adapter
 *
 * Self-hosted meta search engine that aggregates 70+ providers.
 * GET {baseUrl}/search?q={query}&format=json
 * Auth: None (self-hosted). JSON format must be enabled in settings.yml.
 */

import type {
  SearchAdapter,
  SearchAdapterConfig,
  SearchParams,
  SearchResponse,
  SearchResult,
} from '../types';
import { testSearchConnection } from './test-helper';

interface RawResult {
  title?: string;
  url?: string;
  content?: string;
  publishedDate?: string;
  thumbnail?: string;
  score?: number;
}

export class SearxngAdapter implements SearchAdapter {
  readonly id = 'searxng';
  readonly name = 'SearXNG';
  readonly requiresApiKey = false;

  constructor(private readonly config: SearchAdapterConfig) {}

  private get baseUrl(): string {
    return (this.config.baseUrl ?? 'http://localhost:8888').replace(/\/$/, '');
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', params.query);
    url.searchParams.set('format', 'json');
    if (params.language) url.searchParams.set('language', params.language);
    if (params.type === 'images') url.searchParams.set('categories', 'images');
    if (params.type === 'news') url.searchParams.set('categories', 'news');
    if (params.freshness) url.searchParams.set('time_range', params.freshness);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok)
      throw new Error(
        `SearXNG API error: ${res.status} ${errBody.slice(0, 200)}`,
      );
    const data = await res.json();

    const items: RawResult[] = data.results ?? [];
    const maxResults = params.maxResults ?? 5;

    return {
      query: params.query,
      results: items.slice(0, maxResults).map((r: RawResult): SearchResult => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.content ?? '',
        publishedDate: r.publishedDate,
        thumbnail: r.thumbnail,
        score: r.score,
        source: 'searxng',
      })),
      provider: 'searxng',
      latencyMs: 0,
      cached: false,
    };
  }

  async testConnection() {
    return testSearchConnection(this);
  }
}
