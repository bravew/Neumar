/**
 * Shared test connection helper for search adapters.
 * Avoids duplicating the same boilerplate across 13 adapters.
 */

import { errorMessage } from '@/shared/utils/errors';

import type { SearchAdapter } from '../types';

/**
 * Default test connection implementation.
 * Runs a minimal search and reports ok/latency/error.
 */
export async function testSearchConnection(
  adapter: SearchAdapter,
  query = 'test',
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const res = await adapter.search({ query, maxResults: 1 });
    return { ok: res.results.length > 0, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: errorMessage(err),
    };
  }
}
