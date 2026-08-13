/**
 * Jina Search Adapter
 *
 * Search + URL-to-markdown conversion. Works without API key (limited).
 * GET https://s.jina.ai/{query}  (query embedded in URL path)
 * Auth: Authorization: Bearer <api_key> (optional)
 * Use Accept: application/json for structured output.
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
  content?: string;
}

export class JinaAdapter implements SearchAdapter {
  readonly id = 'jina';
  readonly name = 'Jina Search';
  readonly requiresApiKey = false;

  constructor(private readonly config: SearchAdapterConfig) {}

  async search(params: SearchParams): Promise<SearchResponse> {
    const encodedQuery = encodeURIComponent(params.query);
    const url = `https://s.jina.ai/${encodedQuery}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok)
      throw new Error(
        `Jina Search API error: ${res.status} ${errBody.slice(0, 200)}`,
      );
    const data = await res.json();

    const items: RawResult[] = data.data ?? [];
    const maxResults = params.maxResults ?? 5;

    return {
      query: params.query,
      results: items.slice(0, maxResults).map((r: RawResult): SearchResult => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.description ?? r.content?.slice(0, 300) ?? '',
        content: r.content,
        source: 'jina',
      })),
      provider: 'jina',
      latencyMs: 0,
      cached: false,
    };
  }

  async testConnection() {
    return testSearchConnection(this);
  }
}
