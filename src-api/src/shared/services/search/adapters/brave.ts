/**
 * Brave Search Adapter
 *
 * Privacy-focused search with independent index.
 * GET https://api.search.brave.com/res/v1/web/search
 * Auth: X-Subscription-Token header (NOT Bearer)
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
  description?: string;
  age?: string;
  thumbnail?: { src?: string };
}

export class BraveAdapter implements SearchAdapter {
  readonly id = 'brave';
  readonly name = 'Brave Search';
  readonly requiresApiKey = true;

  constructor(private readonly config: SearchAdapterConfig) {}

  async search(params: SearchParams): Promise<SearchResponse> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', params.query);
    url.searchParams.set('count', String(params.maxResults ?? 5));
    if (params.country) url.searchParams.set('country', params.country);
    if (params.language) url.searchParams.set('search_lang', params.language);
    if (params.freshness) url.searchParams.set('freshness', params.freshness);
    if (params.safeSearch)
      url.searchParams.set('safesearch', params.safeSearch);

    const res = await fetch(url.toString(), {
      headers: { 'X-Subscription-Token': this.config.apiKey! },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok)
      throw new Error(
        `Brave Search API error: ${res.status} ${errBody.slice(0, 200)}`,
      );
    const data = await res.json();

    const webResults: RawResult[] = data.web?.results ?? [];

    return {
      query: params.query,
      results: webResults.map((r: RawResult): SearchResult => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.description ?? '',
        publishedDate: r.age,
        thumbnail: r.thumbnail?.src,
        source: 'brave',
      })),
      provider: 'brave',
      latencyMs: 0,
      cached: false,
    };
  }

  async testConnection() {
    return testSearchConnection(this);
  }
}
