/**
 * DuckDuckGo Search Adapter
 *
 * Free, key-free fallback. Uses the official Instant Answer API.
 * NOTE: This API only returns instant answers / Wikipedia summaries,
 * NOT ranked web search results. Use as a last-resort fallback.
 * GET https://api.duckduckgo.com/?q={query}&format=json
 * Auth: None
 */

import type {
  SearchAdapter,
  SearchAdapterConfig,
  SearchParams,
  SearchResponse,
  SearchResult,
} from '../types';
import { testSearchConnection } from './test-helper';

interface RawTopic {
  FirstURL?: string;
  Text?: string;
}

export class DuckDuckGoAdapter implements SearchAdapter {
  readonly id = 'duckduckgo';
  readonly name = 'DuckDuckGo';
  readonly requiresApiKey = false;

  constructor(private readonly config: SearchAdapterConfig) {}

  async search(params: SearchParams): Promise<SearchResponse> {
    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', params.query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('skip_disambig', '1');

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok)
      throw new Error(
        `DuckDuckGo API error: ${res.status} ${errBody.slice(0, 200)}`,
      );
    const data = await res.json();

    const results: SearchResult[] = [];

    // Main abstract (usually Wikipedia)
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.Heading ?? params.query,
        url: data.AbstractURL,
        snippet: data.AbstractText,
        source: 'duckduckgo',
      });
    }

    // Related topics
    const relatedTopics: RawTopic[] = data.RelatedTopics ?? [];
    for (const topic of relatedTopics) {
      if (topic.FirstURL && topic.Text) {
        results.push({
          title: topic.Text.split(' - ')[0] ?? topic.Text,
          url: topic.FirstURL,
          snippet: topic.Text,
          source: 'duckduckgo',
        });
      }
      if (results.length >= (params.maxResults ?? 5)) break;
    }

    return {
      query: params.query,
      results,
      answer: data.AbstractText || data.Answer || undefined,
      provider: 'duckduckgo',
      latencyMs: 0,
      cached: false,
    };
  }

  async testConnection() {
    return testSearchConnection(this);
  }
}
