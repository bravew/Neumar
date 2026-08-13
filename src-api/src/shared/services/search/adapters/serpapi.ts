/**
 * SerpAPI Search Adapter
 *
 * Google search results API with support for 80+ search engines and regions.
 * GET https://serpapi.com/search.json
 * Auth: api_key query parameter
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
  date?: string;
  thumbnail?: string;
}

export class SerpApiAdapter implements SearchAdapter {
  readonly id = 'serpapi';
  readonly name = 'SerpAPI';
  readonly requiresApiKey = true;

  constructor(private readonly config: SearchAdapterConfig) {}

  async search(params: SearchParams): Promise<SearchResponse> {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('q', params.query);
    url.searchParams.set('api_key', this.config.apiKey!);
    url.searchParams.set('num', String(params.maxResults ?? 5));
    if (params.country) url.searchParams.set('gl', params.country);
    if (params.language) url.searchParams.set('hl', params.language);
    if (params.safeSearch === 'strict') url.searchParams.set('safe', 'active');

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok)
      throw new Error(`SerpAPI error: ${res.status} ${errBody.slice(0, 200)}`);
    const data = await res.json();

    const organic: RawResult[] = data.organic_results ?? [];

    return {
      query: params.query,
      results: organic.map((r: RawResult): SearchResult => ({
        title: r.title ?? '',
        url: r.link ?? '',
        snippet: r.snippet ?? '',
        publishedDate: r.date,
        thumbnail: r.thumbnail,
        source: 'serpapi',
      })),
      answer: data.answer_box?.answer ?? data.answer_box?.snippet,
      provider: 'serpapi',
      latencyMs: 0,
      cached: false,
    };
  }

  async testConnection() {
    return testSearchConnection(this);
  }
}
