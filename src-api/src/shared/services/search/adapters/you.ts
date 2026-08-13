/**
 * You.com Search Adapter
 *
 * Web + news search with free livecrawl for full-page content.
 * GET https://chat-api.you.com/search
 * Auth: X-API-Key header
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
  snippet?: string;
  content?: string;
  published_date?: string;
  thumbnail_url?: string;
}

export class YouAdapter implements SearchAdapter {
  readonly id = 'you';
  readonly name = 'You.com';
  readonly requiresApiKey = true;

  constructor(private readonly config: SearchAdapterConfig) {}

  async search(params: SearchParams): Promise<SearchResponse> {
    const url = new URL('https://chat-api.you.com/search');
    url.searchParams.set('query', params.query);
    if (params.maxResults)
      url.searchParams.set('count', String(params.maxResults));
    if (params.country) url.searchParams.set('country', params.country);
    if (params.safeSearch)
      url.searchParams.set('safesearch', params.safeSearch);

    const res = await fetch(url.toString(), {
      headers: {
        'X-API-Key': this.config.apiKey!,
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok)
      throw new Error(
        `You.com API error: ${res.status} ${errBody.slice(0, 200)}`,
      );
    const data = await res.json();

    const hits: RawResult[] = data.hits ?? [];

    return {
      query: params.query,
      results: hits.map((r: RawResult): SearchResult => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.description ?? r.snippet ?? '',
        content: r.content,
        publishedDate: r.published_date,
        thumbnail: r.thumbnail_url,
        source: 'you',
      })),
      provider: 'you',
      latencyMs: 0,
      cached: false,
    };
  }

  async testConnection() {
    return testSearchConnection(this);
  }
}
