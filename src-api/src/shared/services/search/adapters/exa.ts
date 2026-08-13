/**
 * Exa Search Adapter
 *
 * Semantic search, great for academic papers and deep content discovery.
 * POST https://api.exa.ai/search
 * Auth: x-api-key header
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
  highlights?: string[];
  summary?: string;
  text?: string;
  score?: number;
  publishedDate?: string;
  author?: string;
}

export class ExaAdapter implements SearchAdapter {
  readonly id = 'exa';
  readonly name = 'Exa';
  readonly requiresApiKey = true;

  constructor(private readonly config: SearchAdapterConfig) {}

  async search(params: SearchParams): Promise<SearchResponse> {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey!,
      },
      body: JSON.stringify({
        query: params.query,
        numResults: params.maxResults ?? 5,
        contents: {
          text: true,
          highlights: true,
          summary: true,
        },
        includeDomains: params.includeDomains,
        excludeDomains: params.excludeDomains,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok)
      throw new Error(`Exa API error: ${res.status} ${errBody.slice(0, 200)}`);
    const data = await res.json();

    return {
      query: params.query,
      results: ((data.results as RawResult[]) ?? []).map(
        (r: RawResult): SearchResult => ({
          title: r.title ?? '',
          url: r.url ?? '',
          snippet: r.highlights?.[0] ?? r.summary ?? '',
          content: r.text,
          score: r.score,
          publishedDate: r.publishedDate,
          author: r.author,
          source: 'exa',
        }),
      ),
      answer: data.summary,
      provider: 'exa',
      latencyMs: 0,
      cached: false,
    };
  }

  async testConnection() {
    return testSearchConnection(this);
  }
}
