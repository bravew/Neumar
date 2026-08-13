/**
 * Operating Profiles API Routes
 *
 * Endpoints for managing operating profiles — composite configurations
 * that bundle agent profiles, budget policies, MCP defaults, and skill defaults.
 */

import crypto from 'crypto';

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  activateProfile,
  createOperatingProfile,
  deleteOperatingProfile,
  getActiveProfile,
  getAllOperatingProfiles,
  getOperatingProfile,
  updateOperatingProfile,
} from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ProfilesAPI');

export const profilesRoutes = new Hono();

const profileBodySchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional().nullable(),
  is_active: z.number().optional(),
  agent_profile_ids: z.string().optional().nullable(),
  budget_policy_ids: z.string().optional().nullable(),
  mcp_defaults: z.string().optional().nullable(),
  skills_defaults: z.string().optional().nullable(),
  workspace_root: z.string().optional().nullable(),
});

// id is excluded from updates to prevent primary key overwrite
const profileUpdateSchema = profileBodySchema.omit({ id: true }).partial();

/** GET /profiles — list all operating profiles */
profilesRoutes.get('/', (c) => {
  try {
    const profiles = getAllOperatingProfiles();
    return c.json({ profiles });
  } catch (err) {
    logger.error('Failed to list operating profiles:', err);
    return c.json(
      { error: 'Failed to list operating profiles' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /profiles/active — get currently active profile */
profilesRoutes.get('/active', (c) => {
  try {
    const profile = getActiveProfile();
    if (!profile) {
      return c.json({ profile: null });
    }
    return c.json({ profile });
  } catch (err) {
    logger.error('Failed to get active profile:', err);
    return c.json(
      { error: 'Failed to get active profile' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /profiles/:id — get single profile */
profilesRoutes.get('/:id', (c) => {
  try {
    const id = c.req.param('id');
    const profile = getOperatingProfile(id);
    if (!profile) {
      return c.json(
        { error: 'Profile not found' },
        404 as ContentfulStatusCode,
      );
    }
    return c.json({ profile });
  } catch (err) {
    logger.error('Failed to get operating profile:', err);
    return c.json(
      { error: 'Failed to get operating profile' },
      500 as ContentfulStatusCode,
    );
  }
});

/** POST /profiles — create profile */
profilesRoutes.post('/', zValidator('json', profileBodySchema), async (c) => {
  try {
    const body = c.req.valid('json');
    const id = body.id || crypto.randomUUID();
    const profile = createOperatingProfile({
      ...body,
      id,
      is_active: body.is_active ?? 0,
    });
    return c.json({ profile }, 201 as ContentfulStatusCode);
  } catch (err) {
    logger.error('Failed to create operating profile:', err);
    return c.json(
      { error: 'Failed to create operating profile' },
      500 as ContentfulStatusCode,
    );
  }
});

/** PUT /profiles/:id — update profile */
profilesRoutes.put(
  '/:id',
  zValidator('json', profileUpdateSchema),
  async (c) => {
    try {
      const id = c.req.param('id');
      const existing = getOperatingProfile(id);
      if (!existing) {
        return c.json(
          { error: 'Profile not found' },
          404 as ContentfulStatusCode,
        );
      }
      const updates = c.req.valid('json');
      const profile = updateOperatingProfile(id, updates);
      return c.json({ profile });
    } catch (err) {
      logger.error('Failed to update operating profile:', err);
      return c.json(
        { error: 'Failed to update operating profile' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

/** DELETE /profiles/:id — delete profile */
profilesRoutes.delete('/:id', (c) => {
  try {
    const id = c.req.param('id');
    const existing = getOperatingProfile(id);
    if (!existing) {
      return c.json(
        { error: 'Profile not found' },
        404 as ContentfulStatusCode,
      );
    }
    deleteOperatingProfile(id);
    return c.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete operating profile:', err);
    return c.json(
      { error: 'Failed to delete operating profile' },
      500 as ContentfulStatusCode,
    );
  }
});

/** POST /profiles/:id/activate — activate profile (deactivates all others) */
profilesRoutes.post('/:id/activate', (c) => {
  try {
    const id = c.req.param('id');
    const existing = getOperatingProfile(id);
    if (!existing) {
      return c.json(
        { error: 'Profile not found' },
        404 as ContentfulStatusCode,
      );
    }
    const profile = activateProfile(id);
    return c.json({ profile });
  } catch (err) {
    logger.error('Failed to activate profile:', err);
    return c.json(
      { error: 'Failed to activate profile' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /profiles/:id/export — export profile (allowlist-only, no workspace_root) */
profilesRoutes.get('/:id/export', (c) => {
  try {
    const id = c.req.param('id');
    const profile = getOperatingProfile(id);
    if (!profile) {
      return c.json(
        { error: 'Profile not found' },
        404 as ContentfulStatusCode,
      );
    }

    // Allowlist export — never include workspace_root
    const exported = {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      agent_profile_ids: profile.agent_profile_ids,
      budget_policy_ids: profile.budget_policy_ids,
      mcp_defaults: profile.mcp_defaults,
      skills_defaults: profile.skills_defaults,
    };

    return c.json({ profile: exported });
  } catch (err) {
    logger.error('Failed to export operating profile:', err);
    return c.json(
      { error: 'Failed to export operating profile' },
      500 as ContentfulStatusCode,
    );
  }
});
