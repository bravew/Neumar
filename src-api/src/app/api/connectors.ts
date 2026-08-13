/**
 * Connector access control and catalog API.
 *
 * Existing `/connectors/access/*` endpoints are preserved for the legacy
 * global connector gates. The platform V2 routes add catalog hydration,
 * Composio managed-auth config, OAuth start/callback, tool overrides, and
 * gated execution for in-process callers.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { LRUCache } from 'lru-cache';
import { z } from 'zod';

import {
  type ConnectorAccessSetting,
  type GlobalConnector,
  LEGACY_GLOBAL_CONNECTORS,
  connectorAccessSettingKey,
  readConnectorToolOverrides,
  setConnectorToolOverride,
} from '@/shared/auth/connector-policy';
import { getAuditLog } from '@/shared/channels/audit-log';
import {
  executeConnectorTool,
  invalidateConnectorToolCache,
} from '@/shared/connectors/binder';
import { connectorDefinitionToDetail } from '@/shared/connectors/catalog';
import { isConnectorPlatformV2Enabled } from '@/shared/connectors/feature-flag';
import {
  ConnectorServiceError,
  getComposioProvider,
} from '@/shared/connectors/providers/composio';
import { getConnectorCatalogDefinitions } from '@/shared/connectors/seed';
import { getSetting, saveSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ConnectorsAPI');

const connectorsRoutes = new Hono();

const tierSchema = z.enum(['viewer', 'operator', 'admin', 'disabled']);
const accessSettingSchema = z.object({
  defaultTier: tierSchema,
  channels: z.record(z.string(), tierSchema).optional(),
});

const connectorParamSchema = z.object({
  connector: z.string().min(1).max(128),
});

const connectorIdParamSchema = z.object({
  id: z.string().min(1).max(128),
});

const connectBodySchema = z.object({
  callbackBaseUrl: z.string().url(),
  scopeKey: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[a-zA-Z0-9:_-]+$/),
  userId: z.string().min(1).max(256),
});

const prepareAuthBodySchema = z.object({
  connectorId: z.string().min(1).max(128),
});

const configBodySchema = z.object({
  apiKey: z.string().min(1).max(4096).nullable(),
});

const executeBodySchema = z.object({
  connectedAccountId: z.string().min(1).max(256),
  userId: z.string().min(1).max(256),
  input: z.unknown().default({}),
});

const overrideParamSchema = z.object({
  id: z.string().min(1).max(128),
  toolName: z.string().min(1).max(256),
});

const overrideBodySchema = z.object({
  accountId: z.string().min(1).max(256).default('default'),
  approval: z.enum(['auto', 'confirm', 'disabled']),
});

interface LogoCacheEntry {
  body: ArrayBuffer;
  contentType: string;
}

const logoCache = new LRUCache<string, LogoCacheEntry>({
  max: 128,
  ttl: 24 * 60 * 60 * 1000,
});

const logoMissCache = new LRUCache<string, true>({
  max: 1024,
  ttl: 24 * 60 * 60 * 1000,
});

const logoInflight = new Map<string, Promise<LogoCacheEntry | null>>();
const LOGO_ALLOWED_MIME = new Set([
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

function allConnectorIds(): GlobalConnector[] {
  const ids = new Set<GlobalConnector>(LEGACY_GLOBAL_CONNECTORS);
  for (const definition of getConnectorCatalogDefinitions())
    ids.add(definition.id);
  return [...ids];
}

function readAccess(connector: GlobalConnector): ConnectorAccessSetting {
  const raw = getSetting(connectorAccessSettingKey(connector));
  if (!raw) return { defaultTier: 'admin' };
  try {
    return JSON.parse(raw) as ConnectorAccessSetting;
  } catch {
    return { defaultTier: 'admin' };
  }
}

connectorsRoutes.get('/access', (c) => {
  const result = Object.fromEntries(
    allConnectorIds().map((conn) => [conn, readAccess(conn)]),
  );
  return c.json({ access: result });
});

connectorsRoutes.get(
  '/access/:connector',
  zValidator('param', connectorParamSchema),
  (c) => {
    const { connector } = c.req.valid('param');
    return c.json({ connector, access: readAccess(connector) });
  },
);

function requireAdminOrigin(
  c: Context,
): { ok: true } | { ok: false; status: 401 | 403; error: string } {
  const adminOrigin = c.req.header('x-neuma-admin-origin');
  if (adminOrigin !== 'desktop') {
    return {
      ok: false,
      status: 403,
      error: 'Admin-only endpoint — missing X-Neuma-Admin-Origin header',
    };
  }
  const origin = c.req.header('origin') ?? c.req.header('referer');
  const allowedPrefixes = [
    'http://localhost',
    'http://127.0.0.1',
    'tauri://localhost',
    'tauri://',
    'app://',
    'http://tauri.localhost',
  ];
  if (!origin || !allowedPrefixes.some((p) => origin.startsWith(p))) {
    return {
      ok: false,
      status: 403,
      error: 'Admin-only endpoint — request origin missing or not allowed',
    };
  }
  return { ok: true };
}

connectorsRoutes.put(
  '/access/:connector',
  zValidator('param', connectorParamSchema),
  zValidator('json', accessSettingSchema),
  async (c) => {
    const guard = requireAdminOrigin(c);
    if (!guard.ok) {
      logger.warn(
        `connector_access PUT denied: ${guard.error} (path=${c.req.path})`,
      );
      void getAuditLog().write('connector_access_denied', null, null, {
        path: c.req.path,
        reason: guard.error,
      });
      return c.json({ error: guard.error }, guard.status);
    }
    const { connector } = c.req.valid('param');
    const next = c.req.valid('json');
    const previous = readAccess(connector);

    saveSetting(connectorAccessSettingKey(connector), JSON.stringify(next));

    void getAuditLog().write('connector_access_changed', null, null, {
      connector,
      previous,
      next,
    });

    logger.info(
      `Connector access updated: ${connector} defaultTier=${next.defaultTier}`,
    );

    return c.json({ success: true, connector, access: next });
  },
);

connectorsRoutes.use('*', async (c, next) => {
  if (!isConnectorPlatformV2Enabled()) {
    return c.json({ error: 'Connector platform V2 is disabled' }, 404);
  }
  await next();
});

connectorsRoutes.get('/', (c) => {
  const provider = getComposioProvider();
  const definitions = provider.getFastDefinitions();
  const fallback = getConnectorCatalogDefinitions();
  const list = definitions.length > 0 ? definitions : fallback;
  const connected = provider.getConnectedConnectorIds();
  return c.json({
    connectors: list.map((definition) => {
      const detail = connectorDefinitionToDetail(definition);
      if (detail.status === 'available' && connected.has(definition.id)) {
        return { ...detail, status: 'connected' as const };
      }
      return detail;
    }),
  });
});

connectorsRoutes.get('/status', async (c) => {
  const provider = getComposioProvider();
  const details = await Promise.all(
    provider
      .getFastDefinitions()
      .map((definition) => provider.getDetail(definition.id)),
  );
  return c.json({
    configured: provider.isConfigured(),
    connectedCount: details.filter((detail) => detail.status === 'connected')
      .length,
    availableCount: details.length,
  });
});

connectorsRoutes.get('/discovery', async (c) => {
  try {
    const provider = getComposioProvider();
    const definitions = await provider.refreshCatalog();
    invalidateConnectorToolCache('catalog-refresh');
    const connected = provider.getConnectedConnectorIds();
    return c.json({
      connectors: definitions.map((definition) => {
        const detail = connectorDefinitionToDetail(definition);
        if (detail.status === 'available' && connected.has(definition.id)) {
          return { ...detail, status: 'connected' as const };
        }
        return detail;
      }),
    });
  } catch (error) {
    return connectorError(c, error);
  }
});

connectorsRoutes.get('/logos/:slug', async (c) => {
  const slug = normalizeConnectorLogoSlug(c.req.param('slug'));
  if (!slug) return c.json({ error: 'Invalid logo slug' }, 400);

  if (logoMissCache.has(slug)) {
    return c.json({ error: 'Logo unavailable' }, 404, {
      'Cache-Control': 'public, max-age=86400',
    });
  }

  try {
    const cached = await fetchLogo(slug);
    if (!cached) {
      return c.json({ error: 'Logo unavailable' }, 404, {
        'Cache-Control': 'public, max-age=86400',
      });
    }
    return new Response(cached.body, {
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch (error) {
    logger.warn('connector logo proxy failed', { slug, error });
    return c.json({ error: 'Unable to fetch connector logo' }, 502);
  }
});

connectorsRoutes.get('/composio/config', (c) => {
  return c.json(getComposioProvider().getPublicConfig());
});

connectorsRoutes.put(
  '/composio/config',
  zValidator('json', configBodySchema),
  (c) => {
    const guard = requireAdminOrigin(c);
    if (!guard.ok) return c.json({ error: guard.error }, guard.status);
    getComposioProvider().setApiKey(c.req.valid('json').apiKey);
    invalidateConnectorToolCache('provider-config-change');
    return c.json(getComposioProvider().getPublicConfig());
  },
);

connectorsRoutes.post(
  '/auth-configs/prepare',
  zValidator('json', prepareAuthBodySchema),
  async (c) => {
    const guard = requireAdminOrigin(c);
    if (!guard.ok) return c.json({ error: guard.error }, guard.status);
    const result = await getComposioProvider().prepareAuthConfig(
      c.req.valid('json').connectorId,
    );
    return c.json(result);
  },
);

connectorsRoutes.get(
  '/oauth/callback/:id',
  zValidator('param', connectorIdParamSchema),
  async (c) => {
    if (!isLoopbackHost(c.req.header('host') ?? '')) {
      logger.warn('connector oauth callback rejected for non-loopback host');
      return c.text('Forbidden', 403);
    }
    const { id } = c.req.valid('param');
    const state = c.req.query('state');
    if (!state) return c.text('Missing OAuth state', 400);

    try {
      await getComposioProvider().completeOAuthCallback(
        id,
        state,
        new URL(c.req.url).searchParams,
      );
      invalidateConnectorToolCache('connection-status-change');
      return c.html(
        '<!doctype html><title>Connected</title><p>You can close this tab.</p>',
      );
    } catch (error) {
      logger.warn('connector oauth callback failed', {
        connectorId: id,
        error,
      });
      return c.html(
        '<!doctype html><title>Connection failed</title><p>Connection failed. Return to Neuma and try again.</p>',
        400,
      );
    }
  },
);

connectorsRoutes.get(
  '/:id',
  zValidator('param', connectorIdParamSchema),
  async (c) => {
    try {
      return c.json(
        await getComposioProvider().getDetail(c.req.valid('param').id),
      );
    } catch (error) {
      return connectorError(c, error);
    }
  },
);

connectorsRoutes.post(
  '/:id/connect',
  zValidator('param', connectorIdParamSchema),
  zValidator('json', connectBodySchema),
  async (c) => {
    const guard = requireAdminOrigin(c);
    if (!guard.ok) return c.json({ error: guard.error }, guard.status);
    const { id } = c.req.valid('param');
    try {
      const body = c.req.valid('json');
      return c.json(
        await getComposioProvider().startConnection({
          connectorId: id,
          callbackBaseUrl: body.callbackBaseUrl,
          scopeKey: body.scopeKey,
          userId: body.userId,
        }),
      );
    } catch (error) {
      return connectorError(c, error);
    }
  },
);

connectorsRoutes.post(
  '/:id/authorization/cancel',
  zValidator('param', connectorIdParamSchema),
  (c) => {
    const guard = requireAdminOrigin(c);
    if (!guard.ok) return c.json({ error: guard.error }, guard.status);
    getComposioProvider().cancelPending(c.req.valid('param').id);
    return c.json({ success: true });
  },
);

connectorsRoutes.delete(
  '/:id/connection',
  zValidator('param', connectorIdParamSchema),
  async (c) => {
    const guard = requireAdminOrigin(c);
    if (!guard.ok) return c.json({ error: guard.error }, guard.status);
    await getComposioProvider().disconnect(c.req.valid('param').id);
    invalidateConnectorToolCache('connection-status-change');
    return c.json({ success: true });
  },
);

connectorsRoutes.get(
  '/:id/tools/overrides',
  zValidator('param', connectorIdParamSchema),
  (c) => {
    const accountId = c.req.query('accountId') ?? 'default';
    return c.json({
      overrides: readConnectorToolOverrides(accountId, c.req.valid('param').id),
    });
  },
);

connectorsRoutes.put(
  '/:id/tools/:toolName/override',
  zValidator('param', overrideParamSchema),
  zValidator('json', overrideBodySchema),
  (c) => {
    const guard = requireAdminOrigin(c);
    if (!guard.ok) return c.json({ error: guard.error }, guard.status);
    const { id, toolName } = c.req.valid('param');
    const body = c.req.valid('json');
    setConnectorToolOverride({
      accountId: body.accountId,
      connectorId: id,
      toolName,
      approval: body.approval,
    });
    invalidateConnectorToolCache('tool-override-change');
    return c.json({ success: true });
  },
);

connectorsRoutes.post(
  '/:id/tools/:toolName/execute',
  zValidator('param', overrideParamSchema),
  zValidator('json', executeBodySchema),
  async (c) => {
    const guard = requireAdminOrigin(c);
    if (!guard.ok) return c.json({ error: guard.error }, guard.status);
    if (c.req.header('x-neuma-connector-execution') !== 'in-process') {
      return c.json(
        { error: 'Connector execution requires an in-process caller' },
        403,
      );
    }
    const { id, toolName } = c.req.valid('param');
    const body = c.req.valid('json');
    try {
      return c.json(
        await executeConnectorTool({
          connectorId: id,
          toolName,
          input: body.input,
          context: {
            runId: c.req.header('x-neuma-run-id') ?? 'connectors-api',
            surface: 'desktop',
            platform: 'desktop',
            accountId: body.userId,
            identityId: body.userId,
            permissionTier: 'admin',
            connectedAccountId: body.connectedAccountId,
            providerUserId: body.userId,
          },
        }),
      );
    } catch (error) {
      return connectorError(c, error);
    }
  },
);

function connectorError(c: Context, error: unknown) {
  if (error instanceof ConnectorServiceError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          details: error.details,
        },
      },
      error.status,
    );
  }
  const message =
    error instanceof Error ? error.message : String(error ?? 'unknown');
  logger.error('connector route failed', {
    path: c.req.path,
    method: c.req.method,
    message,
    stack: error instanceof Error ? error.stack : undefined,
  });
  return c.json(
    {
      error: {
        code: 'CONNECTOR_EXECUTION_FAILED',
        message: 'Connector request failed.',
        retryable: false,
      },
    },
    502 as ContentfulStatusCode,
  );
}

export function normalizeConnectorLogoSlug(slug: string): string {
  const aliases: Record<string, string> = {
    drive: 'googledrive',
    calendar: 'googlecalendar',
    zohobooks: 'zoho_books',
    google_drive: 'googledrive',
    google_calendar: 'googlecalendar',
    drive_composio: 'googledrive',
    calendar_composio: 'googlecalendar',
    gmail_composio: 'gmail',
    notion_composio: 'notion',
    slack_composio: 'slack',
  };
  const normalized = slug.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return aliases[normalized] ?? normalized;
}

async function fetchLogo(slug: string): Promise<LogoCacheEntry | null> {
  const cached = logoCache.get(slug);
  if (cached) return cached;
  const existing = logoInflight.get(slug);
  if (existing) return existing;

  const promise = fetchLogoUncached(slug).finally(() =>
    logoInflight.delete(slug),
  );
  logoInflight.set(slug, promise);
  return promise;
}

async function fetchLogoUncached(slug: string): Promise<LogoCacheEntry | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    // SSRF: host is a fixed allowlisted literal — slug is sanitized upstream
    // to `[a-z0-9_]`. Do NOT make either user-controlled.
    const response = await fetch(`https://cdn.simpleicons.org/${slug}`, {
      signal: controller.signal,
    });
    const contentType =
      response.headers.get('content-type')?.split(';')[0] ?? '';
    if (response.status === 404 || response.status === 410) {
      logoMissCache.set(slug, true);
      return null;
    }
    if (!response.ok || !LOGO_ALLOWED_MIME.has(contentType)) {
      throw new Error(`Logo fetch rejected: ${response.status} ${contentType}`);
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > 1024 * 1024) {
      throw new Error('Logo exceeds 1 MB');
    }
    const entry = { body, contentType };
    logoCache.set(slug, entry);
    return entry;
  } finally {
    clearTimeout(timeout);
  }
}

function isLoopbackHost(hostHeader: string): boolean {
  const host = hostHeader.replace(/^\[/, '').replace(/\].*$/, '').split(':')[0];
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    Boolean(host?.startsWith('127.'))
  );
}

export { connectorsRoutes };
