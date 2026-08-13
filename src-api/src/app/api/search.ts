/**
 * Search Service API Routes
 *
 * REST endpoints for search service management and testing.
 *
 * GET  /search/providers  — List configured providers with status
 * GET  /search/presets    — List all available provider presets
 * POST /search/test       — Test a provider (apiKey, baseUrl → { ok, latencyMs })
 * POST /search/query      — Execute a search (for testing UI)
 * GET  /search/config     — Get current search config
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  getSearchConfig,
  listProviders,
  SEARCH_PROVIDER_PRESETS,
  search,
  testProvider,
} from '@/shared/services/search';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SearchAPI');

// ── Schemas ──

const testProviderSchema = z.object({
  providerId: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  config: z.record(z.string(), z.string()).optional(),
});

const searchQuerySchema = z.object({
  query: z.string().min(1).max(2000),
  maxResults: z.number().min(1).max(10).optional(),
  freshness: z.enum(['day', 'week', 'month', 'year']).optional(),
  country: z.string().optional(),
  language: z.string().optional(),
});

export const searchRoutes = new Hono();

// ── List configured providers ──
searchRoutes.get('/providers', (c) => {
  try {
    return c.json(listProviders());
  } catch (err) {
    logger.error('Failed to list providers:', err);
    return c.json(
      { error: 'Failed to list providers' },
      500 as ContentfulStatusCode,
    );
  }
});

// ── List all available provider presets ──
searchRoutes.get('/presets', (c) => {
  return c.json(SEARCH_PROVIDER_PRESETS);
});

// ── Get current search config (without API keys) ──
searchRoutes.get('/config', (c) => {
  try {
    const config = getSearchConfig();
    // Strip API keys for security
    const safe = {
      ...config,
      providers: config.providers.map((p) => ({
        ...p,
        apiKey: p.apiKey ? '••••••••' : '',
      })),
    };
    return c.json(safe);
  } catch (err) {
    logger.error('Failed to get config:', err);
    return c.json(
      { error: 'Failed to get config' },
      500 as ContentfulStatusCode,
    );
  }
});

// ── Test a provider's connectivity ──
searchRoutes.post(
  '/test',
  zValidator('json', testProviderSchema),
  async (c) => {
    try {
      const { providerId, apiKey, baseUrl, config } = c.req.valid('json');
      const result = await testProvider(providerId, {
        apiKey,
        baseUrl,
        config,
      });
      return c.json(result);
    } catch (err) {
      logger.error('Provider test failed:', err);
      return c.json(
        {
          ok: false,
          latencyMs: 0,
          error: errorMessage(err),
        },
        500 as ContentfulStatusCode,
      );
    }
  },
);

// ── Execute a search (for testing UI) ──
searchRoutes.post(
  '/query',
  zValidator('json', searchQuerySchema),
  async (c) => {
    try {
      const { query, maxResults, freshness, country, language } =
        c.req.valid('json');
      const result = await search({
        query,
        maxResults,
        freshness,
        country,
        language,
      });
      return c.json(result);
    } catch (err) {
      logger.error('Search query failed:', err);
      return c.json({ error: errorMessage(err) }, 500 as ContentfulStatusCode);
    }
  },
);
