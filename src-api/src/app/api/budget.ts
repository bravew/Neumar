/**
 * Budget API Routes
 *
 * Endpoints for managing budget policies and checking current spend.
 */

import crypto from 'crypto';

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  createBudgetPolicy,
  deleteBudgetPolicy,
  getAllBudgetPolicies,
  getBudgetPolicy,
  updateBudgetPolicy,
} from '@/shared/db/operations';
import {
  CreateBudgetPolicySchema,
  UpdateBudgetPolicySchema,
} from '@/shared/db/schemas';
import { budgetPreflight, getBudgetStatus } from '@/shared/services/budget';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('BudgetAPI');

export const budgetRoutes = new Hono();

const PreflightQuerySchema = z.object({
  scope_type: z.enum([
    'global',
    'provider',
    'model',
    'agent_profile',
    'project',
    'automation',
  ]),
  scope_id: z.string().optional(),
});

/** GET /budget/policies — list all policies */
budgetRoutes.get('/policies', (c) => {
  try {
    const policies = getAllBudgetPolicies();
    return c.json({ policies });
  } catch (err) {
    logger.error('Failed to list budget policies:', err);
    return c.json(
      { error: 'Failed to list budget policies' },
      500 as ContentfulStatusCode,
    );
  }
});

/** POST /budget/policies — create a new policy */
budgetRoutes.post(
  '/policies',
  zValidator('json', CreateBudgetPolicySchema),
  (c) => {
    try {
      const input = c.req.valid('json');
      const id = input.id || crypto.randomUUID();
      const policy = createBudgetPolicy({ ...input, id });
      return c.json({ policy }, 201 as ContentfulStatusCode);
    } catch (err) {
      logger.error('Failed to create budget policy:', err);
      return c.json(
        { error: 'Failed to create budget policy' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

/** PUT /budget/policies/:id — update a policy */
budgetRoutes.put(
  '/policies/:id',
  zValidator('json', UpdateBudgetPolicySchema),
  (c) => {
    try {
      const id = c.req.param('id');
      const existing = getBudgetPolicy(id);
      if (!existing) {
        return c.json(
          { error: 'Budget policy not found' },
          404 as ContentfulStatusCode,
        );
      }
      const updates = c.req.valid('json');
      const policy = updateBudgetPolicy(id, updates);
      return c.json({ policy });
    } catch (err) {
      logger.error('Failed to update budget policy:', err);
      return c.json(
        { error: 'Failed to update budget policy' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

/** DELETE /budget/policies/:id — delete a policy */
budgetRoutes.delete('/policies/:id', (c) => {
  try {
    const id = c.req.param('id');
    const existing = getBudgetPolicy(id);
    if (!existing) {
      return c.json(
        { error: 'Budget policy not found' },
        404 as ContentfulStatusCode,
      );
    }
    deleteBudgetPolicy(id);
    return c.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete budget policy:', err);
    return c.json(
      { error: 'Failed to delete budget policy' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /budget/preflight — check budget for a given scope */
budgetRoutes.get(
  '/preflight',
  zValidator('query', PreflightQuerySchema),
  (c) => {
    try {
      const { scope_type, scope_id } = c.req.valid('query');
      const result = budgetPreflight({
        scopeType: scope_type,
        scopeId: scope_id,
      });
      return c.json(result);
    } catch (err) {
      logger.error('Budget preflight failed:', err);
      return c.json(
        { error: 'Budget preflight failed' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

/** GET /budget/status — all policies with current utilization */
budgetRoutes.get('/status', (c) => {
  try {
    const items = getBudgetStatus();
    return c.json({ items });
  } catch (err) {
    logger.error('Failed to get budget status:', err);
    return c.json(
      { error: 'Failed to get budget status' },
      500 as ContentfulStatusCode,
    );
  }
});
