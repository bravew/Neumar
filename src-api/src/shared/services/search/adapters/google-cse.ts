/**
 * Google Custom Search Engine Adapter
 *
 * Google CSE requires both an API key and a search engine ID.
 * GET https://www.googleapis.com/customsearch/v1
 * Auth: key query parameter
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
  link?: string;
  snippet?: string;
  pagemap?: { cse_thumbnail?: Array<{ src?: string }> };
}

export class GoogleCseAdapter implements SearchAdapter {
  readonly id = 'google-cse';
  readonly name = 'Google CSE';
  readonly requiresApiKey = true;

  constructor(private readonly config: SearchAdapterConfig) {}

  async search(params: SearchParams): Promise<SearchResponse> {
    const searchEngineId = this.config.config?.searchEngineId;
    if (!searchEngineId) {
      throw new Error('Google CSE requires a search engine ID (cx)');
    }

    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', this.config.apiKey!);
    url.searchParams.set('cx', searchEngineId);
    url.searchParams.set('q', params.query);
    url.searchParams.set('num', String(Math.min(params.maxResults ?? 5, 10)));
    if (params.language) url.searchParams.set('lr', `lang_${params.language}`);
    if (params.country) url.searchParams.set('gl', params.country);
    if (params.safeSearch === 'strict') url.searchParams.set('safe', 'active');

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok)
      throw new Error(
        `Google CSE API error: ${res.status} ${errBody.slice(0, 200)}`,
      );
    const data = await res.json();

    const items: RawResult[] = data.items ?? [];

    return {
      query: params.query,
      results: items.map((r: RawResult): SearchResult => ({
        title: r.title ?? '',
        url: r.link ?? '',
        snippet: r.snippet ?? '',
        thumbnail: r.pagemap?.cse_thumbnail?.[0]?.src,
        source: 'google-cse',
      })),
      provider: 'google-cse',
      latencyMs: 0,
      cached: false,
    };
  }

  async testConnection() {
    return testSearchConnection(this);
  }
}
