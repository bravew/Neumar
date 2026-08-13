/**
 * Yandex Search Adapter
 *
 * Best for Russian and CIS region content.
 * GET https://yandex.com/search/xml
 * Auth: apikey query parameter
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
  link?: string;
  snippet?: string;
  passage?: string;
}

export class YandexAdapter implements SearchAdapter {
  readonly id = 'yandex';
  readonly name = 'Yandex Search';
  readonly requiresApiKey = true;

  constructor(private readonly config: SearchAdapterConfig) {}

  private get baseUrl(): string {
    return (this.config.baseUrl ?? 'https://yandex.com/search/xml').replace(
      /\/$/,
      '',
    );
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('query', params.query);
    url.searchParams.set('apikey', this.config.apiKey!);
    url.searchParams.set(
      'groupby',
      `attr=d.mode=deep.groups-on-page=${params.maxResults ?? 5}`,
    );
    if (params.language) url.searchParams.set('l10n', params.language);

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok)
      throw new Error(
        `Yandex API error: ${res.status} ${errBody.slice(0, 200)}`,
      );

    // Yandex may return XML or JSON depending on configuration.
    // Try JSON first; fall back to parsing as text.
    const text = await res.text();
    let items: RawResult[] = [];

    try {
      const data = JSON.parse(text);
      items = data.results ?? data.response?.results?.grouping?.group ?? [];
    } catch {
      // Basic XML text extraction fallback
      const urlMatches = [...text.matchAll(/<url>(.*?)<\/url>/g)];
      const titleMatches = [...text.matchAll(/<title>(.*?)<\/title>/g)];
      const snippetMatches = [...text.matchAll(/<passage>(.*?)<\/passage>/g)];

      for (
        let i = 0;
        i < urlMatches.length && i < (params.maxResults ?? 5);
        i++
      ) {
        items.push({
          url: urlMatches[i]?.[1] ?? '',
          title: titleMatches[i]?.[1]?.replace(/<\/?[^>]+(>|$)/g, '') ?? '',
          snippet: snippetMatches[i]?.[1]?.replace(/<\/?[^>]+(>|$)/g, '') ?? '',
        });
      }
    }

    return {
      query: params.query,
      results: items.map((r: RawResult): SearchResult => ({
        title: r.title ?? '',
        url: r.url ?? r.link ?? '',
        snippet: r.snippet ?? r.passage ?? '',
        source: 'yandex',
      })),
      provider: 'yandex',
      latencyMs: 0,
      cached: false,
    };
  }

  async testConnection() {
    return testSearchConnection(this);
  }
}
