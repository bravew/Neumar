/**
 * Tavily Search Adapter
 *
 * AI-optimized search with relevance scoring and answer summaries.
 * POST https://api.tavily.com/search
 * Auth: Authorization: Bearer <api_key>
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
  score?: number;
}

export class TavilyAdapter implements SearchAdapter {
  readonly id = 'tavily';
  readonly name = 'Tavily';
  readonly requiresApiKey = true;

  constructor(private readonly config: SearchAdapterConfig) {}

  async search(params: SearchParams): Promise<SearchResponse> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        query: params.query,
        max_results: params.maxResults ?? 5,
        search_depth: 'basic',
        include_answer: 'basic',
        include_domains: params.includeDomains,
        exclude_domains: params.excludeDomains,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok)
      throw new Error(
        `Tavily API error: ${res.status} ${errBody.slice(0, 200)}`,
      );
    const data = await res.json();

    return {
      query: params.query,
      results: ((data.results as RawResult[]) ?? []).map(
        (r: RawResult): SearchResult => ({
          title: r.title ?? '',
          url: r.url ?? '',
          snippet: r.content?.slice(0, 300) ?? '',
          content: r.content,
          score: r.score,
          source: 'tavily',
        }),
      ),
      answer: data.answer,
      provider: 'tavily',
      latencyMs: 0,
      cached: false,
    };
  }

  async testConnection() {
    return testSearchConnection(this);
  }
}
