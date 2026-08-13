/**
 * Metaso (秘塔搜索) Search Adapter
 *
 * Chinese AI search engine with strong Chinese content coverage.
 * POST https://metaso.cn/api/search
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
  link?: string;
  snippet?: string;
  content?: string;
}

export class MetasoAdapter implements SearchAdapter {
  readonly id = 'metaso';
  readonly name = '秘塔搜索 (Metaso)';
  readonly requiresApiKey = true;

  constructor(private readonly config: SearchAdapterConfig) {}

  private get baseUrl(): string {
    return (this.config.baseUrl ?? 'https://metaso.cn/api').replace(/\/$/, '');
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const res = await fetch(`${this.baseUrl}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        query: params.query,
        max_results: params.maxResults ?? 5,
        language: params.language ?? 'zh',
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok)
      throw new Error(
        `Metaso API error: ${res.status} ${errBody.slice(0, 200)}`,
      );
    const data = await res.json();

    const items: RawResult[] = data.results ?? data.data?.results ?? [];

    return {
      query: params.query,
      results: items.map((r: RawResult): SearchResult => ({
        title: r.title ?? '',
        url: r.url ?? r.link ?? '',
        snippet: r.snippet ?? r.content?.slice(0, 300) ?? '',
        content: r.content,
        source: 'metaso',
      })),
      answer: data.answer ?? data.data?.answer,
      provider: 'metaso',
      latencyMs: 0,
      cached: false,
    };
  }

  async testConnection() {
    return testSearchConnection(this, '测试');
  }
}
