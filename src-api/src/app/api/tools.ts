// Stateless tool-search — caller ships its current registry with each
// search. Adapters that own session state can wire AdapterToolRegistry
// server-side instead.

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  executeConnectorTool,
  type BinderRunContext,
} from '@/shared/connectors/binder';
import { listDesignModeConnectorTools } from '@/shared/connectors/binder/design-mode';
import { connectorDefinitionToDetail } from '@/shared/connectors/catalog';
import { isConnectorPlatformV2Enabled } from '@/shared/connectors/feature-flag';
import { getComposioProvider } from '@/shared/connectors/providers/composio';
import { ConnectorServiceError } from '@/shared/connectors/providers/composio/errors';
import { lookupBridgeToken } from '@/shared/mcp/subprocess-bridge/token-store';
import {
  searchTools,
  toolDescriptorSchema,
  toolSearchInputSchema,
} from '@/shared/mcp/tool-search';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ToolsRoutes');

export const toolsRoutes = new Hono();

const searchBodySchema = z.object({
  // Cap registry length to bound scoring work — descriptors are caller-supplied.
  registry: z.array(toolDescriptorSchema).max(2000),
  input: toolSearchInputSchema,
});

const connectorExecuteBodySchema = z.object({
  connectorId: z.string().min(1).max(128),
  toolName: z.string().min(1).max(256),
  input: z.unknown().default({}),
  connectedAccountId: z.string().min(1).max(256).optional(),
  userId: z.string().min(1).max(256).optional(),
});

toolsRoutes.post('/search', zValidator('json', searchBodySchema), (c) => {
  try {
    const { registry, input } = c.req.valid('json');
    const result = searchTools(registry, input);
    return c.json(result);
  } catch (err) {
    logger.error('tool-search failed:', err);
    return c.json({ error: 'tool-search failed' }, 500 as ContentfulStatusCode);
  }
});

toolsRoutes.get('/connectors/list', async (c) => {
  if (!isConnectorPlatformV2Enabled()) {
    return c.json({ error: 'Connector platform V2 is disabled' }, 404);
  }
  const entry = readConnectorBridgeToken(c);
  if (!entry.ok) return c.json({ error: entry.error }, 403);

  try {
    const provider = getComposioProvider();
    const details = await Promise.all(
      provider
        .getFastDefinitions()
        .map((definition) => provider.getDetail(definition.id)),
    );
    const context = bridgeRunContext(entry.entry, {
      surface: 'design_mode',
      workDir: c.req.query('workDir'),
    });
    const list = listDesignModeConnectorTools({
      catalog: details.length
        ? details
        : provider.getFastDefinitions().map(connectorDefinitionToDetail),
      context,
    });
    const connectorId = entry.entry.connectorScope?.connectorId;
    return c.json(
      connectorId
        ? {
            tools: list.tools.filter(
              (tool) => tool.connectorId === connectorId,
            ),
          }
        : list,
    );
  } catch (err) {
    logger.error('connector tool list failed:', err);
    return c.json(
      { error: 'connector tool list failed' },
      502 as ContentfulStatusCode,
    );
  }
});

toolsRoutes.post(
  '/connectors/execute',
  zValidator('json', connectorExecuteBodySchema),
  async (c) => {
    if (!isConnectorPlatformV2Enabled()) {
      return c.json({ error: 'Connector platform V2 is disabled' }, 404);
    }
    const entry = readConnectorBridgeToken(c);
    if (!entry.ok) return c.json({ error: entry.error }, 403);
    if (!entry.entry.connectorScope) {
      return c.json({ error: 'Connector tool token scope is missing' }, 403);
    }

    const body = c.req.valid('json');
    if (
      entry.entry.connectorScope.connectorId !== body.connectorId ||
      (entry.entry.connectorScope.toolName &&
        entry.entry.connectorScope.toolName !== body.toolName)
    ) {
      return c.json({ error: 'Connector tool token scope mismatch' }, 403);
    }

    try {
      return c.json(
        await executeConnectorTool({
          connectorId: body.connectorId,
          toolName: body.toolName,
          input: body.input,
          context: bridgeRunContext(entry.entry, {
            surface: 'subprocess',
            connectedAccountId:
              entry.entry.connectorScope.connectedAccountId ??
              body.connectedAccountId,
            userId: entry.entry.connectorScope.userId ?? body.userId,
          }),
        }),
      );
    } catch (err) {
      logger.error('connector tool execution failed:', err);
      if (err instanceof ConnectorServiceError) {
        return c.json(
          {
            error: {
              code: err.code,
              message: err.message,
              retryable: err.retryable,
              details: err.details,
            },
          },
          err.status,
        );
      }
      return c.json(
        { error: 'connector tool execution failed' },
        502 as ContentfulStatusCode,
      );
    }
  },
);

type BridgeTokenEntry = NonNullable<ReturnType<typeof lookupBridgeToken>>;

function readConnectorBridgeToken(c: {
  req: { header(name: string): string | undefined };
}): { ok: true; entry: BridgeTokenEntry } | { ok: false; error: string } {
  const token =
    bearerToken(c.req.header('authorization')) ??
    c.req.header('x-neuma-tool-token');
  const entry = lookupBridgeToken(token);
  if (!entry || entry.connector !== 'connector') {
    return { ok: false, error: 'Connector tool token is missing or expired' };
  }
  return { ok: true, entry };
}

function bridgeRunContext(
  entry: BridgeTokenEntry,
  input: {
    surface: BinderRunContext['surface'];
    connectedAccountId?: string;
    userId?: string;
    workDir?: string;
  },
): BinderRunContext {
  const policyContext = entry.policyContext ?? {};
  const platform = policyContext.platform ?? 'desktop';
  return {
    runId: entry.sessionId,
    surface: input.surface,
    platform,
    configId: policyContext.channelId,
    channelId: policyContext.channelId,
    accountId: policyContext.identityId ?? input.userId ?? 'default',
    identityId: policyContext.identityId ?? input.userId,
    permissionTier:
      policyContext.permissionTier ??
      (platform === 'desktop' ? 'admin' : undefined),
    automationOrigin: policyContext.automationOrigin,
    connectedAccountId: input.connectedAccountId,
    providerUserId: input.userId,
    workDir: input.workDir,
  };
}

function bearerToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1];
}
