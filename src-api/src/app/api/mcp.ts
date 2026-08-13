import fs from 'fs/promises';
import path from 'path';

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { getValidAccessToken } from '@/shared/auth/oauth-client';
import {
  externalMcpStatusForConfig,
  listExternalMcpTemplates,
} from '@/shared/mcp/external-client/templates';
import {
  getExternalMcpAuthorizationHeader,
  getExternalMcpTokenMetadata,
  removeExternalMcpTokens,
  ExternalMcpTokenError,
} from '@/shared/mcp/external-client/tokens';
import {
  callExternalMcpTool,
  ExternalMcpTransportError,
  listExternalMcpTools,
  type ExternalMcpHttpServer,
} from '@/shared/mcp/external-client/transport';
import { getFlowStatus, initiateMcpOAuth } from '@/shared/mcp/remote-oauth';
import { createLogger } from '@/shared/utils/logger';

import {
  APP_DISPLAY_NAME,
  getAllMcpConfigPaths,
  getAppMcpConfigPath,
} from '../../config/constants';

const logger = createLogger('McpRoutes');

/** Hostnames blocked for SSRF prevention in server-side fetch. */
const SSRF_BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1', // IPv6 loopback
  '0.0.0.0',
  'metadata.google.internal',
]);

const mcp = new Hono();

// MCP config file path: app data directory mcp.json
const getMcpConfigPath = (): string => getAppMcpConfigPath();

// Ensure directory exists
const ensureDir = async (filePath: string): Promise<void> => {
  const dir = path.dirname(filePath);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory might already exist
  }
};

// MCP Server Config Types
interface MCPServerStdio {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPServerHttp {
  url: string;
  headers?: Record<string, string>;
}

type MCPServerConfig = MCPServerStdio | MCPServerHttp;

interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

// GET /mcp/config - Read MCP config
mcp.get('/config', async (c) => {
  const configPath = getMcpConfigPath();

  try {
    // Check if file exists
    try {
      await fs.access(configPath);
    } catch {
      // File doesn't exist, return empty config
      return c.json({
        success: true,
        data: { mcpServers: {} },
        path: configPath,
      });
    }

    // Read and parse config
    const content = await fs.readFile(configPath, 'utf-8');
    const config: MCPConfig = JSON.parse(content);

    return c.json({
      success: true,
      data: config,
      path: configPath,
    });
  } catch (err) {
    logger.error('Failed to read config:', err);
    return c.json(
      {
        success: false,
        error: 'Failed to read MCP config',
        path: configPath,
      },
      500,
    );
  }
});

// POST /mcp/config - Write MCP config
const mcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()),
});

mcp.post('/config', zValidator('json', mcpConfigSchema), async (c) => {
  const configPath = getMcpConfigPath();

  try {
    const body = c.req.valid('json');

    // Ensure directory exists
    await ensureDir(configPath);

    // Write config
    const configJson = JSON.stringify(body, null, 2);
    await fs.writeFile(configPath, configJson, 'utf-8');

    logger.info('Config saved to:', configPath);

    return c.json({
      success: true,
      message: 'MCP config saved',
      path: configPath,
    });
  } catch (err) {
    logger.error('Failed to write config:', err);
    return c.json(
      {
        success: false,
        error: 'Failed to write MCP config',
      },
      500,
    );
  }
});

// GET /mcp/path - Get MCP config file path
mcp.get('/path', (c) => {
  return c.json({
    success: true,
    path: getMcpConfigPath(),
  });
});

// GET /mcp/all-configs - Read MCP configs from all sources (app and claude)
mcp.get('/all-configs', async (c) => {
  const configPaths = getAllMcpConfigPaths();
  const results: {
    name: string;
    path: string;
    exists: boolean;
    servers: Record<string, MCPServerConfig>;
  }[] = [];

  for (const configInfo of configPaths) {
    try {
      await fs.access(configInfo.path);

      const content = await fs.readFile(configInfo.path, 'utf-8');
      const config = JSON.parse(content);

      // Claude settings.json has a different structure
      if (configInfo.name === 'claude') {
        // Claude settings has mcpServers at root level
        results.push({
          name: configInfo.name,
          path: configInfo.path,
          exists: true,
          servers: config.mcpServers || {},
        });
      } else {
        // App mcp.json structure
        results.push({
          name: configInfo.name,
          path: configInfo.path,
          exists: true,
          servers: config.mcpServers || {},
        });
      }
    } catch {
      // File doesn't exist or can't be read
      results.push({
        name: configInfo.name,
        path: configInfo.path,
        exists: false,
        servers: {},
      });
    }
  }

  return c.json({
    success: true,
    configs: results,
  });
});

mcp.get('/external/templates', (c) =>
  c.json({ templates: listExternalMcpTemplates() }),
);

mcp.get('/external/status/:serverId', async (c) => {
  const serverId = c.req.param('serverId');
  const config = await readMcpConfigFile();
  const tokenMetadata = await getExternalMcpTokenMetadata(serverId);
  return c.json(
    externalMcpStatusForConfig(serverId, config.mcpServers, tokenMetadata),
  );
});

// POST /mcp/oauth/initiate — start MCP Remote OAuth flow for a server
//
// Discovers the OAuth server from the MCP server URL, performs Dynamic Client
// Registration, and returns the authorization URL for the frontend to open in
// the system browser. Works for any MCP server that implements the MCP Remote
// Authorization spec (Notion, Figma, Granola, etc.) — no pre-configured
// credentials are required.
const oauthInitiateSchema = z.object({
  serverName: z.string().min(1),
  serverUrl: z.string().url(),
});
const oauthStartSchema = z.object({
  serverId: z.string().min(1),
});
const toolCallSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional().default({}),
});

async function readMcpConfigFile(): Promise<MCPConfig> {
  const configPath = getMcpConfigPath();
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    return { mcpServers: parsed.mcpServers || parsed };
  } catch {
    return { mcpServers: {} };
  }
}

async function writeMcpConfigFile(config: MCPConfig): Promise<void> {
  const configPath = getMcpConfigPath();
  await ensureDir(configPath);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function validateRemoteMcpUrl(serverUrl: string): string | null {
  const parsed = new URL(serverUrl);
  if (parsed.protocol !== 'https:') {
    return 'MCP server URL must use HTTPS';
  }
  const hostname = parsed.hostname;
  const isBlocked =
    SSRF_BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('169.254.') ||
    hostname.startsWith('168.63.') || // Azure IMDS
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^f[cd][0-9a-f]{2}:/i.test(hostname) || // IPv6 ULA fc00::/7 (fc and fd)
    /^fe[89ab][0-9a-f]:/i.test(hostname); // IPv6 link-local fe80::/10
  if (isBlocked) {
    return 'MCP server URL must not target private networks';
  }
  return null;
}

async function startMcpOAuthFlow(serverName: string, serverUrl: string) {
  const validationError = validateRemoteMcpUrl(serverUrl);
  if (validationError) {
    return { ok: false as const, status: 400 as const, error: validationError };
  }

  try {
    const result = await initiateMcpOAuth(
      serverName,
      serverUrl,
      APP_DISPLAY_NAME,
    );
    return { ok: true as const, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('OAuth initiation failed:', err);
    return { ok: false as const, status: 500 as const, error: msg };
  }
}

async function findConfiguredMcpServer(serverId: string) {
  const config = await readMcpConfigFile();
  const server = config.mcpServers[serverId];
  if (!server) return null;
  if (!('url' in server) || typeof server.url !== 'string') {
    throw new Error('OAuth flow only applies to HTTP/SSE MCP servers');
  }
  return server.url;
}

async function startConfiguredMcpOAuth(serverId: string) {
  let serverUrl: string | null = null;
  try {
    serverUrl = await findConfiguredMcpServer(serverId);
  } catch (err) {
    return {
      ok: false as const,
      status: 400 as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!serverUrl) {
    return {
      ok: false as const,
      status: 404 as const,
      error: `unknown serverId ${serverId}`,
    };
  }
  return startMcpOAuthFlow(serverId, serverUrl);
}

async function findConfiguredHttpMcpServer(
  serverId: string,
): Promise<ExternalMcpHttpServer | null> {
  const config = await readMcpConfigFile();
  const server = config.mcpServers[serverId];
  if (!server) return null;
  if (!('url' in server) || typeof server.url !== 'string') {
    throw new Error('External MCP proxy only applies to HTTP/SSE servers');
  }
  const headers =
    'headers' in server && server.headers && typeof server.headers === 'object'
      ? Object.fromEntries(
          Object.entries(server.headers).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined;
  const authorization = await getExternalMcpAuthorizationHeader(serverId);
  const mergedHeaders = {
    ...(headers ?? {}),
    ...(authorization ? { Authorization: authorization } : {}),
  };
  return {
    url: server.url,
    headers: Object.keys(mergedHeaders).length ? mergedHeaders : undefined,
  };
}

function externalMcpErrorResponse(error: unknown) {
  if (error instanceof ExternalMcpTokenError) {
    return {
      body: { success: false, error: 'auth_required', message: error.message },
      status: 401,
    };
  }
  if (error instanceof ExternalMcpTransportError) {
    return {
      body: { success: false, error: error.code, message: error.message },
      status: error.status,
    };
  }
  if (error instanceof Error) {
    return {
      body: { success: false, error: 'bad_request', message: error.message },
      status: 400,
    };
  }
  return {
    body: {
      success: false,
      error: 'upstream_error',
      message: 'External MCP request failed',
    },
    status: 502,
  };
}

async function getExternalMcpProxyServer(serverId: string) {
  try {
    const server = await findConfiguredHttpMcpServer(serverId);
    if (!server) {
      return {
        ok: false as const,
        body: {
          success: false,
          error: 'not_found',
          message: `unknown serverId ${serverId}`,
        },
        status: 404 as const,
      };
    }
    return { ok: true as const, server };
  } catch (error) {
    return { ok: false as const, ...externalMcpErrorResponse(error) };
  }
}

mcp.post(
  '/oauth/initiate',
  zValidator('json', oauthInitiateSchema),
  async (c) => {
    const { serverName, serverUrl } = c.req.valid('json');

    const outcome = await startMcpOAuthFlow(serverName, serverUrl);
    if (!outcome.ok) {
      return c.json({ success: false, error: outcome.error }, outcome.status);
    }
    return c.json({
      success: true,
      authUrl: outcome.result.authUrl,
      state: outcome.result.state,
      redirectUri: outcome.result.redirectUri,
    });
  },
);

// POST /mcp/oauth/start — start OAuth for an already configured HTTP/SSE server.
mcp.post('/oauth/start', zValidator('json', oauthStartSchema), async (c) => {
  const { serverId } = c.req.valid('json');
  const outcome = await startConfiguredMcpOAuth(serverId);
  if (!outcome.ok) {
    return c.json({ error: outcome.error }, outcome.status);
  }
  return c.json({
    authorizeUrl: outcome.result.authUrl,
    state: outcome.result.state,
    redirectUri: outcome.result.redirectUri,
  });
});

// POST /mcp/external/start-oauth — DesignMode-facing alias for the same flow.
mcp.post(
  '/external/start-oauth',
  zValidator('json', oauthStartSchema),
  async (c) => {
    const { serverId } = c.req.valid('json');
    const outcome = await startConfiguredMcpOAuth(serverId);
    if (!outcome.ok) {
      return c.json({ success: false, error: outcome.error }, outcome.status);
    }
    return c.json({
      success: true,
      authUrl: outcome.result.authUrl,
      authorizeUrl: outcome.result.authUrl,
      state: outcome.result.state,
      flowId: outcome.result.state,
      redirectUri: outcome.result.redirectUri,
    });
  },
);

mcp.post('/external/disconnect/:serverId', async (c) => {
  const serverId = c.req.param('serverId');
  const config = await readMcpConfigFile();
  const server = config.mcpServers[serverId];
  if (!server || typeof server !== 'object') {
    return c.json(
      {
        success: false,
        error: 'not_found',
        message: `unknown serverId ${serverId}`,
      },
      404,
    );
  }

  let changed = false;
  const removedTokens = await removeExternalMcpTokens(serverId);
  if (
    'headers' in server &&
    server.headers &&
    typeof server.headers === 'object'
  ) {
    const headers = server.headers as Record<string, unknown>;
    if (typeof headers.Authorization === 'string') {
      delete headers.Authorization;
      changed = true;
    }
    if (Object.keys(headers).length === 0) {
      delete (server as { headers?: unknown }).headers;
    }
  }
  if ('env' in server && server.env && typeof server.env === 'object') {
    const env = server.env as Record<string, unknown>;
    for (const key of Object.keys(env)) {
      if (/token|api[_-]?key/i.test(key)) {
        delete env[key];
        changed = true;
      }
    }
    if (Object.keys(env).length === 0) {
      delete (server as { env?: unknown }).env;
    }
  }
  if ('oauth' in server) {
    delete (server as { oauth?: unknown }).oauth;
    changed = true;
  }

  if (changed || removedTokens) {
    await writeMcpConfigFile(config);
  }
  return c.json({ success: true, serverId, connected: false });
});

mcp.post('/external/tools/:serverId/list', async (c) => {
  const serverId = c.req.param('serverId');
  const resolved = await getExternalMcpProxyServer(serverId);
  if (!resolved.ok) {
    return c.json(resolved.body, resolved.status as ContentfulStatusCode);
  }

  try {
    const tools = await listExternalMcpTools(resolved.server);
    return c.json({ success: true, serverId, tools });
  } catch (error) {
    const response = externalMcpErrorResponse(error);
    return c.json(response.body, response.status as ContentfulStatusCode);
  }
});

mcp.post(
  '/external/tools/:serverId/call',
  zValidator('json', toolCallSchema),
  async (c) => {
    const serverId = c.req.param('serverId');
    const resolved = await getExternalMcpProxyServer(serverId);
    if (!resolved.ok) {
      return c.json(resolved.body, resolved.status as ContentfulStatusCode);
    }

    try {
      const body = c.req.valid('json');
      const result = await callExternalMcpTool(
        resolved.server,
        body.name,
        body.arguments,
      );
      return c.json({ success: true, serverId, result });
    } catch (error) {
      const response = externalMcpErrorResponse(error);
      return c.json(response.body, response.status as ContentfulStatusCode);
    }
  },
);

// GET /mcp/oauth/status/:state — poll whether an OAuth flow has completed
mcp.get('/oauth/status/:state', (c) => {
  const state = c.req.param('state');
  const status = getFlowStatus(state);
  return c.json(status);
});

// POST /mcp/connect-oauth/notion — legacy: inject existing AccountSettings
// Notion token directly (used when NOTION_CLIENT_ID is configured and the
// user is already connected in Account Settings).
mcp.post('/connect-oauth/notion', async (c) => {
  const token = await getValidAccessToken('notion');
  if (!token) {
    return c.json({ success: false, error: 'Notion is not connected' }, 401);
  }

  const configPath = getMcpConfigPath();
  let config: MCPConfig = { mcpServers: {} };
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    config = { mcpServers: parsed.mcpServers || parsed };
  } catch {
    return c.json({ success: false, error: 'mcp.json not found' }, 404);
  }

  const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';
  let updated = false;
  for (const server of Object.values(config.mcpServers)) {
    if ('url' in server && (server as MCPServerHttp).url === NOTION_MCP_URL) {
      (server as MCPServerHttp).headers = {
        ...(server as MCPServerHttp).headers,
        Authorization: `Bearer ${token}`,
      };
      updated = true;
      break;
    }
  }

  if (!updated) {
    return c.json(
      { success: false, error: 'Notion MCP server not in config' },
      404,
    );
  }

  await ensureDir(configPath);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  logger.info('Injected Notion AccountSettings token into MCP config');
  return c.json({ success: true });
});

export { mcp as mcpRoutes };
