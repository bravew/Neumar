/**
 * Usage API Routes
 *
 * Endpoints for querying usage statistics, request logs, and model pricing.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  createPricing,
  getAllPricing,
  getModelPricing,
  renamePricing,
  updatePricing,
} from '@/shared/services/pricing';
import {
  clearUsageLogs,
  getDailyUsage,
  getRequestLogs,
  getUsageByCallType,
  getUsageByModel,
  getUsageByProvider,
  getUsageSummary,
} from '@/shared/services/usage-logger';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('UsageAPI');

// ============================================================================
// Schemas
// ============================================================================

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?$/, 'Invalid date format');

const TimeRangeSchema = z.object({
  start: dateStringSchema.optional(),
  end: dateStringSchema.optional(),
  billing_type: z.enum(['api', 'subscription', 'free']).optional(),
  source: z.enum(['channel', 'desktop']).optional(),
});

const LogsQuerySchema = TimeRangeSchema.extend({
  model: z.string().optional(),
  provider: z.string().optional(),
  call_type: z
    .enum(['agent', 'title', 'embedding', 'image', 'speech', 'ptc', 'other'])
    .optional(),
  locality: z.enum(['local', 'non_local']).optional(),
  sort_field: z
    .enum(['created_at', 'total_cost', 'tokens', 'latency_ms'])
    .optional(),
  sort_dir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  // source is inherited from TimeRangeSchema
});

const PricingCreateSchema = z.object({
  model_id: z.string().min(1),
  provider: z.string().min(1),
  display_name: z.string().optional(),
  default_billing_type: z.enum(['api', 'subscription', 'free']).optional(),
});

const PricingRenameSchema = z.object({
  new_model_id: z.string().min(1),
});

const PricingUpdateSchema = z.object({
  input_cost_per_million: z.number().optional(),
  output_cost_per_million: z.number().optional(),
  cache_read_cost_per_million: z.number().optional(),
  cache_creation_cost_per_million: z.number().optional(),
  unit_cost: z.number().optional(),
  unit_type: z.string().optional(),
  default_billing_type: z.enum(['api', 'subscription', 'free']).optional(),
});

// ============================================================================
// Routes
// ============================================================================

export const usageRoutes = new Hono();

/** GET /usage/summary — Overall usage summary with billing breakdown */
usageRoutes.get('/summary', zValidator('query', TimeRangeSchema), (c) => {
  try {
    const { start, end, billing_type, source } = c.req.valid('query');
    const summary = getUsageSummary({
      start,
      end,
      billingType: billing_type,
      source,
    });
    return c.json(summary);
  } catch (err) {
    logger.error('Failed to get usage summary:', err);
    return c.json(
      { error: 'Failed to get usage summary' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /usage/by-provider — Usage grouped by provider */
usageRoutes.get('/by-provider', zValidator('query', TimeRangeSchema), (c) => {
  try {
    const { start, end, billing_type, source } = c.req.valid('query');
    const data = getUsageByProvider({
      start,
      end,
      billingType: billing_type,
      source,
    });
    return c.json(data);
  } catch (err) {
    logger.error('Failed to get usage by provider:', err);
    return c.json(
      { error: 'Failed to get usage by provider' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /usage/by-model — Usage grouped by model */
usageRoutes.get('/by-model', zValidator('query', TimeRangeSchema), (c) => {
  try {
    const { start, end, billing_type, source } = c.req.valid('query');
    const data = getUsageByModel({
      start,
      end,
      billingType: billing_type,
      source,
    });
    return c.json(data);
  } catch (err) {
    logger.error('Failed to get usage by model:', err);
    return c.json(
      { error: 'Failed to get usage by model' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /usage/by-call-type — Usage grouped by call type */
usageRoutes.get('/by-call-type', zValidator('query', TimeRangeSchema), (c) => {
  try {
    const { start, end, billing_type, source } = c.req.valid('query');
    const data = getUsageByCallType({
      start,
      end,
      billingType: billing_type,
      source,
    });
    return c.json(data);
  } catch (err) {
    logger.error('Failed to get usage by call type:', err);
    return c.json(
      { error: 'Failed to get usage by call type' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /usage/daily — Daily usage aggregation */
usageRoutes.get('/daily', zValidator('query', TimeRangeSchema), (c) => {
  try {
    const { start, end, billing_type, source } = c.req.valid('query');
    const data = getDailyUsage({
      start,
      end,
      billingType: billing_type,
      source,
    });
    return c.json(data);
  } catch (err) {
    logger.error('Failed to get daily usage:', err);
    return c.json(
      { error: 'Failed to get daily usage' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /usage/logs — Paginated request logs */
usageRoutes.get('/logs', zValidator('query', LogsQuerySchema), (c) => {
  try {
    const {
      start,
      end,
      billing_type,
      source,
      model,
      provider,
      call_type,
      locality,
      sort_field,
      sort_dir,
      limit,
      offset,
    } = c.req.valid('query');
    const data = getRequestLogs({
      start,
      end,
      billingType: billing_type,
      source,
      model,
      provider,
      callType: call_type,
      locality,
      sortField: sort_field,
      sortDir: sort_dir,
      limit,
      offset,
    });
    return c.json(data);
  } catch (err) {
    logger.error('Failed to get request logs:', err);
    return c.json(
      { error: 'Failed to get request logs' },
      500 as ContentfulStatusCode,
    );
  }
});

/** DELETE /usage/logs — Clear all usage logs */
usageRoutes.delete('/logs', (c) => {
  try {
    const deleted = clearUsageLogs();
    return c.json({ deleted });
  } catch (err) {
    logger.error('Failed to clear usage logs:', err);
    return c.json(
      { error: 'Failed to clear usage logs' },
      500 as ContentfulStatusCode,
    );
  }
});

/** POST /usage/pricing — Create pricing entry for a user-defined model */
usageRoutes.post('/pricing', zValidator('json', PricingCreateSchema), (c) => {
  try {
    const body = c.req.valid('json');
    const created = createPricing(body);
    return c.json(created, 201 as ContentfulStatusCode);
  } catch (err) {
    logger.error('Failed to create pricing:', err);
    return c.json(
      { error: 'Failed to create pricing' },
      500 as ContentfulStatusCode,
    );
  }
});

/** PATCH /usage/pricing/:modelId/rename — Rename a pricing record's model_id */
usageRoutes.patch(
  '/pricing/:modelId/rename',
  zValidator('json', PricingRenameSchema),
  (c) => {
    try {
      const { modelId } = c.req.param();
      const { new_model_id } = c.req.valid('json');
      const updated = renamePricing(modelId, new_model_id);
      if (!updated)
        return c.json(
          { error: 'Model not found' },
          404 as ContentfulStatusCode,
        );
      return c.json(updated);
    } catch (err) {
      logger.error('Failed to rename pricing:', err);
      return c.json(
        { error: 'Failed to rename pricing' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

/** GET /usage/pricing — All model pricing */
usageRoutes.get('/pricing', (c) => {
  try {
    const data = getAllPricing();
    return c.json(data);
  } catch (err) {
    logger.error('Failed to get pricing:', err);
    return c.json(
      { error: 'Failed to get pricing' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /usage/pricing/:modelId — Single model pricing */
usageRoutes.get('/pricing/:modelId', (c) => {
  const { modelId } = c.req.param();
  const pricing = getModelPricing(modelId);
  if (!pricing) {
    return c.json({ error: 'Model not found' }, 404 as ContentfulStatusCode);
  }
  return c.json(pricing);
});

/** PUT /usage/pricing/:modelId — Update model pricing */
usageRoutes.put(
  '/pricing/:modelId',
  zValidator('json', PricingUpdateSchema),
  (c) => {
    try {
      const { modelId } = c.req.param();
      const body = c.req.valid('json');
      const updated = updatePricing(modelId, body);
      if (!updated) {
        return c.json(
          { error: 'Model not found' },
          404 as ContentfulStatusCode,
        );
      }
      return c.json(updated);
    } catch (err) {
      logger.error('Failed to update pricing:', err);
      return c.json(
        { error: 'Failed to update pricing' },
        500 as ContentfulStatusCode,
      );
    }
  },
);
