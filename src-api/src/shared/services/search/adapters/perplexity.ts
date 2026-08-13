/**
 * Perplexity Sonar Search Adapter
 *
 * Search-augmented AI answers with citations.
 * Uses the OpenAI-compatible chat completions format.
 * POST https://api.perplexity.ai/chat/completions
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
  snippet?: string;
  content?: string;
}

export class PerplexityAdapter implements SearchAdapter {
  readonly id = 'perplexity';
  readonly name = 'Perplexity Sonar';
  readonly requiresApiKey = true;

  constructor(private readonly config: SearchAdapterConfig) {}

  async search(params: SearchParams): Promise<SearchResponse> {
    const body: Record<string, unknown> = {
      model: 'sonar',
      messages: [{ role: 'user', content: params.query }],
    };

    if (params.includeDomains?.length) {
      body.search_domain_filter = params.includeDomains;
    }
    if (params.freshness) {
      body.search_recency_filter = params.freshness;
    }

    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok)
      throw new Error(
        `Perplexity API error: ${res.status} ${errBody.slice(0, 200)}`,
      );
    const data = await res.json();

    const answer = data.choices?.[0]?.message?.content ?? '';
    const citations: string[] = data.citations ?? [];
    const searchResults: RawResult[] = data.search_results ?? [];

    // Build results from citations and search_results
    const results: SearchResult[] = searchResults.length
      ? searchResults.map((r: RawResult): SearchResult => ({
          title: r.title ?? r.url ?? '',
          url: r.url ?? '',
          snippet: r.snippet ?? r.content ?? '',
          source: 'perplexity',
        }))
      : citations.map((url: string, i: number): SearchResult => ({
          title: `Citation ${i + 1}`,
          url,
          snippet: '',
          source: 'perplexity',
        }));

    return {
      query: params.query,
      results,
      answer,
      citations,
      provider: 'perplexity',
      latencyMs: 0,
      cached: false,
    };
  }

  async testConnection() {
    return testSearchConnection(this);
  }
}
