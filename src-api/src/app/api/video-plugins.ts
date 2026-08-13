import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  applyVideoPlugin,
  detectVideoPluginCandidateAfterRender,
  dismissVideoPluginCandidate,
  exportVideoPluginBundle,
  importVideoPluginBundle,
  listVideoPluginCandidates,
  loadVideoPlugins,
  saveVideoPluginCandidate,
  selectVideoPlugins,
  summarizeVideoPlugin,
  type VideoPlugin,
  type VideoPluginLoadIssue,
} from '@/shared/video/plugins';

export const videoPluginRoutes = new Hono();

const pluginApplySchema = z
  .object({
    inputs: z.record(z.string(), z.unknown()).optional(),
    approvedCapabilities: z.array(z.string().min(1)).max(50).optional(),
    lastReviewedDigest: z.string().min(1).nullable().optional(),
    signatureOk: z.boolean().nullable().optional(),
  })
  .strict();
const candidateStatusSchema = z.enum(['active', 'dismissed', 'saved']);
const candidateDetectSchema = z
  .object({
    projectId: z.string().min(1),
  })
  .strict();
const candidateSaveSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(1000).optional(),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
    scope: z.enum(['project', 'user']).optional(),
  })
  .strict();
const pluginBundleSchema = z
  .object({
    format: z.literal('neuma.video-plugin.bundle.v1'),
    exportedAt: z.string().min(1),
    genericManifest: z.record(z.string(), z.unknown()),
    videoManifest: z.record(z.string(), z.unknown()),
  })
  .strict();
const pluginImportSchema = z
  .object({
    scope: z.enum(['project', 'user']).optional(),
    bundle: pluginBundleSchema,
  })
  .strict();
const VIDEO_PLUGIN_ROUTE_CACHE_TTL_MS = 1_000;
let routeLoadCache: {
  expiresAt: number;
  result: Promise<{
    plugins: VideoPlugin[];
    issues: VideoPluginLoadIssue[];
  }>;
} | null = null;

videoPluginRoutes.get('/', async (c) => {
  const { plugins, issues } = await loadVideoPluginsForRoute();
  const query = c.req.query('query') ?? '';
  const limit = parseLimit(c.req.query('limit'));

  return c.json({
    plugins: selectVideoPlugins(plugins, { query, limit }),
    issues,
  });
});

videoPluginRoutes.get('/candidates', (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) return c.json({ error: 'projectId is required' }, 400);
  const rawStatus = c.req.query('status');
  const status = rawStatus ? candidateStatusSchema.safeParse(rawStatus) : null;
  if (status && !status.success) {
    return c.json({ error: 'Invalid candidate status' }, 400);
  }
  return c.json({
    candidates: listVideoPluginCandidates(projectId, status?.data),
  });
});

videoPluginRoutes.post(
  '/candidates/detect',
  zValidator('json', candidateDetectSchema),
  async (c) => {
    const { projectId } = c.req.valid('json');
    return c.json({
      candidate: await detectVideoPluginCandidateAfterRender(projectId),
    });
  },
);

videoPluginRoutes.post('/candidates/:candidateId/dismiss', (c) => {
  try {
    return c.json({
      candidate: dismissVideoPluginCandidate(c.req.param('candidateId')),
    });
  } catch (error) {
    return routeError(c, error);
  }
});

videoPluginRoutes.post(
  '/candidates/:candidateId/save',
  zValidator('json', candidateSaveSchema),
  async (c) => {
    try {
      const result = await saveVideoPluginCandidate(
        c.req.param('candidateId'),
        c.req.valid('json'),
      );
      invalidateVideoPluginRouteCache();
      return c.json(result, 201);
    } catch (error) {
      return routeError(c, error);
    }
  },
);

videoPluginRoutes.post(
  '/import',
  zValidator('json', pluginImportSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');
      const plugin = await importVideoPluginBundle(body.bundle, {
        scope: body.scope,
      });
      invalidateVideoPluginRouteCache();
      return c.json(
        {
          plugin,
        },
        201,
      );
    } catch (error) {
      return routeError(c, error);
    }
  },
);

videoPluginRoutes.get('/:id/export', async (c) => {
  try {
    return c.json({ bundle: await exportVideoPluginBundle(c.req.param('id')) });
  } catch (error) {
    return routeError(c, error);
  }
});

videoPluginRoutes.get('/:id', async (c) => {
  const loaded = await loadVideoPluginById(c.req.param('id'));
  if (!loaded.plugin) {
    return c.json(
      { error: 'Video plugin not found', issues: loaded.issues },
      404,
    );
  }

  return c.json({
    plugin: summarizeVideoPlugin(loaded.plugin),
    manifest: loaded.plugin.manifest,
    issues: loaded.issues,
  });
});

videoPluginRoutes.post(
  '/:id/apply',
  zValidator('json', pluginApplySchema),
  async (c) => {
    const loaded = await loadVideoPluginById(c.req.param('id'));
    if (!loaded.plugin) {
      return c.json(
        { error: 'Video plugin not found', issues: loaded.issues },
        404,
      );
    }

    const request = c.req.valid('json');
    const applied = applyVideoPlugin(loaded.plugin, {
      inputs: request.inputs,
      approvedCapabilities: request.approvedCapabilities,
      lastReviewedDigest: request.lastReviewedDigest,
      signatureOk: request.signatureOk,
    });

    return c.json({
      plugin: applied.summary,
      prompt: applied.prompt,
      gate: {
        restricted: applied.gate.restricted,
        grants: applied.gate.grants,
        requestedCapabilities: applied.gate.requestedCapabilities,
        grantedCapabilities: applied.gate.grantedCapabilities,
        deniedCapabilities: applied.gate.deniedCapabilities,
        requiresReview: applied.summary.requiresReview,
        promptGuideIncluded: Boolean(applied.gate.promptContext),
      },
      context: applied.context,
      issues: loaded.issues,
    });
  },
);

async function loadVideoPluginById(pluginId: string): Promise<{
  plugin?: VideoPlugin;
  issues: VideoPluginLoadIssue[];
}> {
  const { plugins, issues } = await loadVideoPluginsForRoute();
  return {
    plugin: plugins.find((plugin) => plugin.id === pluginId),
    issues,
  };
}

function loadVideoPluginsForRoute(): Promise<{
  plugins: VideoPlugin[];
  issues: VideoPluginLoadIssue[];
}> {
  const now = Date.now();
  if (routeLoadCache && routeLoadCache.expiresAt > now) {
    return routeLoadCache.result;
  }
  const result = loadVideoPlugins({ watch: false });
  routeLoadCache = {
    expiresAt: now + VIDEO_PLUGIN_ROUTE_CACHE_TTL_MS,
    result,
  };
  void result.catch(() => {
    if (routeLoadCache?.result === result) routeLoadCache = null;
  });
  return result;
}

export function invalidateVideoPluginRouteCache(): void {
  routeLoadCache = null;
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const limit = Number.parseInt(value, 10);
  return Number.isFinite(limit) ? limit : undefined;
}

function routeError(c: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = (
    message.includes('not found')
      ? 404
      : message.includes('already been saved') ||
          message.includes('Refusing to overwrite')
        ? 409
        : 400
  ) as ContentfulStatusCode;
  return c.json({ error: message }, status);
}
