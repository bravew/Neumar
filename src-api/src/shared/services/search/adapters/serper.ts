/**
 * Serper.dev Search Adapter
 *
 * Fast Google search API with excellent price-performance ratio.
 * POST https://google.serper.dev/search
 * Auth: X-API-KEY header
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
}

const ENDPOINT_MAP: Record<string, string> = {
  web: 'https://google.serper.dev/search',
  news: 'https://google.serper.dev/news',
  images: 'https://google.serper.dev/images',
};

export class SerperAdapter implements SearchAdapter {
  readonly id = 'serper';
  readonly name = 'Serper';
  readonly requiresApiKey = true;

  constructor(private readonly config: SearchAdapterConfig) {}

  async search(params: SearchParams): Promise<SearchResponse> {
    const endpoint =
      ENDPOINT_MAP[params.type ?? 'web'] ?? 'https://google.serper.dev/search';

    const body: Record<string, unknown> = {
      q: params.query,
      num: params.maxResults ?? 5,
    };
    if (params.country) body.gl = params.country;
    if (params.language) body.hl = params.language;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': this.config.apiKey!,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok)
      throw new Error(
        `Serper API error: ${res.status} ${errBody.slice(0, 200)}`,
      );
    const data = await res.json();

    const organic: RawResult[] = data.organic ?? [];

    return {
      query: params.query,
      results: organic.map((r: RawResult): SearchResult => ({
        title: r.title ?? '',
        url: r.link ?? '',
        snippet: r.snippet ?? '',
        publishedDate: r.date,
        source: 'serper',
      })),
      answer: data.answerBox?.answer ?? data.answerBox?.snippet,
      provider: 'serper',
      latencyMs: 0,
      cached: false,
    };
  }

  async testConnection() {
    return testSearchConnection(this);
  }
}
