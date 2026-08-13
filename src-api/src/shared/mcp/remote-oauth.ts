/**
 * MCP Remote OAuth Flow
 *
 * Implements the MCP Remote Authorization spec for connecting to HTTP MCP
 * servers that require OAuth (e.g. mcp.notion.com, mcp.figma.com).
 *
 * Flow:
 *   1. Discover the OAuth authorization server from the MCP server URL
 *      via GET {url}/.well-known/oauth-protected-resource
 *   2. Discover OAuth metadata from the authorization server
 *   3. Register a public client via Dynamic Client Registration (RFC 7591)
 *   4. Spin up a temporary localhost callback server
 *   5. Return the authorization URL to the caller to open in a browser
 *   6. Receive the authorization code callback, exchange it for tokens
 *   7. Save the token in the encrypted MCP OAuth token store
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import { createServer } from 'http';
import type { IncomingMessage, Server, ServerResponse } from 'http';

import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import { getAppMcpConfigPath } from '@/config/constants';

import { buildCallbackHtml } from '@/shared/auth/oauth-client';
import { saveExternalMcpTokens } from '@/shared/mcp/external-client/tokens';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('McpRemoteOAuth');

// ---------------------------------------------------------------------------
// In-memory flow tracking
// ---------------------------------------------------------------------------

interface McpOAuthFlow {
  serverName: string;
  serverUrl: string;
  authServerBase: string;
  clientInfo: OAuthClientInformationMixed;
  codeVerifier: string;
  redirectUri: string;
  metadata: AuthorizationServerMetadata;
  /** true once callback received (success or error) */
  completed: boolean;
  error?: string;
  timeoutId: NodeJS.Timeout;
}

const flows = new Map<string, McpOAuthFlow>();
const activeServers = new Map<string, Server>();

const FLOW_TIMEOUT_MS = 10 * 60 * 1000;
const FLOW_COMPLETION_GRACE_MS = 30 * 1000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Kick off the OAuth flow for a remote MCP server.
 * Returns the URL the user must visit to authorize, plus a state token the
 * caller can poll via getFlowStatus().
 */
export async function initiateMcpOAuth(
  serverName: string,
  serverUrl: string,
  appName: string,
): Promise<{ authUrl: string; state: string; redirectUri: string }> {
  const state = crypto.randomBytes(32).toString('base64url');

  // 1. Discover auth server from the MCP server's protected-resource metadata
  let authServerBase: string = serverUrl;
  try {
    const resourceMeta =
      await discoverOAuthProtectedResourceMetadata(serverUrl);
    if (resourceMeta.authorization_servers?.length) {
      authServerBase = resourceMeta.authorization_servers[0]!;
    }
  } catch {
    // Server may not advertise resource metadata; try the server URL directly
  }

  // 2. Discover OAuth authorization server metadata
  const metadata = await discoverAuthorizationServerMetadata(authServerBase);
  if (!metadata) {
    throw new Error(
      `Could not discover OAuth metadata from ${authServerBase}. ` +
        `The server may not support standard MCP Remote Authorization.`,
    );
  }

  // 3. Start local callback server to receive the redirect
  const callbackServer = createServer(handleCallback);
  const port = await new Promise<number>((resolve, reject) => {
    callbackServer.listen(0, '127.0.0.1', () => {
      const addr = callbackServer.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      } else {
        reject(new Error('Failed to bind callback server'));
      }
    });
    callbackServer.on('error', reject);
  });

  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // 4. Dynamic Client Registration (RFC 7591)
  //    Some servers (e.g. Figma) restrict DCR to pre-approved clients and
  //    return 403. In that case we surface a clear error rather than using a
  //    broken fallback client_id that the authorization server won't recognise.
  let clientInfo: OAuthClientInformationMixed;
  try {
    clientInfo = await registerClient(authServerBase, {
      metadata,
      clientMetadata: {
        client_name: appName,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // public client — no secret needed
      },
    });
  } catch (dcrErr) {
    // If the server advertises a registration endpoint but rejected us (403),
    // it means we are not on the approved-client list. Don't fall through with
    // an invalid client_id — the resulting auth URL would just show an error.
    if (metadata.registration_endpoint) {
      logger.error(
        `DCR rejected by ${authServerBase} – this server requires pre-approved clients`,
        dcrErr,
      );
      throw new Error(
        `Dynamic Client Registration was rejected by ${authServerBase}. ` +
          `This MCP server only allows pre-approved OAuth clients. ` +
          `Consider using the local stdio-based server instead (e.g. npx figma-developer-mcp --stdio).`,
      );
    }
    // No registration endpoint advertised — genuine public-client fallback
    logger.warn(
      `DCR not available for ${authServerBase}, using public client fallback`,
    );
    clientInfo = { client_id: new URL(serverUrl).origin };
  }

  // 5. Build the authorization URL
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    authServerBase,
    {
      metadata,
      clientInformation: clientInfo,
      redirectUrl: redirectUri,
      state,
    },
  );

  // 6. Register timeout cleanup
  const timeoutId = setTimeout(() => {
    const flow = flows.get(state);
    if (flow && !flow.completed) {
      flow.completed = true;
      flow.error = 'OAuth flow timed out';
    }
    const srv = activeServers.get(state);
    srv?.close();
    activeServers.delete(state);
    flows.delete(state);
  }, FLOW_TIMEOUT_MS);

  flows.set(state, {
    serverName,
    serverUrl,
    authServerBase,
    clientInfo,
    codeVerifier,
    redirectUri,
    metadata,
    completed: false,
    timeoutId,
  });
  activeServers.set(state, callbackServer);

  logger.info(
    `MCP OAuth flow initiated for "${serverName}" via ${authServerBase}`,
  );
  return { authUrl: authorizationUrl.toString(), state, redirectUri };
}

/**
 * Returns the current status of a previously initiated flow.
 */
export function getFlowStatus(
  state: string,
):
  | { status: 'pending' }
  | { status: 'complete' }
  | { status: 'error'; error: string }
  | { status: 'not_found' } {
  const flow = flows.get(state);
  if (!flow) return { status: 'not_found' };
  if (!flow.completed) return { status: 'pending' };
  if (flow.error) return { status: 'error', error: flow.error };
  return { status: 'complete' };
}

// ---------------------------------------------------------------------------
// Internal: callback server handler
// ---------------------------------------------------------------------------

async function handleCallback(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end();
    return;
  }

  const returnedState = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  const flow = flows.get(returnedState);
  const server = activeServers.get(returnedState);

  const closeAll = () => {
    server?.close();
    activeServers.delete(returnedState);
    if (flow) {
      clearTimeout(flow.timeoutId);
      // Keep the flow record around briefly so a polling client that calls
      // getFlowStatus() right after the redirect can read the final status
      // before the entry is reaped.
      setTimeout(() => {
        flows.delete(returnedState);
      }, FLOW_COMPLETION_GRACE_MS).unref?.();
    }
  };

  if (!flow) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(buildCallbackHtml(false, 'unknown'));
    return;
  }

  if (error || !code) {
    flow.completed = true;
    flow.error = error ?? 'Authorization was denied or cancelled';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buildCallbackHtml(false, flow.serverName));
    closeAll();
    return;
  }

  try {
    const tokens = await exchangeAuthorization(flow.authServerBase, {
      metadata: flow.metadata,
      clientInformation: flow.clientInfo,
      authorizationCode: code,
      codeVerifier: flow.codeVerifier,
      redirectUri: flow.redirectUri,
    });

    await saveTokenForMcpServer(flow, tokens);

    flow.completed = true;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buildCallbackHtml(true, flow.serverName));
    logger.info(`MCP OAuth completed for "${flow.serverName}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    flow.completed = true;
    flow.error = `Token exchange failed: ${msg}`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buildCallbackHtml(false, flow.serverName));
    logger.error(
      `MCP OAuth token exchange failed for "${flow.serverName}":`,
      err,
    );
  }

  closeAll();
}

// ---------------------------------------------------------------------------
// Internal: persist encrypted token metadata and scrub legacy plaintext headers
// ---------------------------------------------------------------------------

async function saveTokenForMcpServer(
  flow: McpOAuthFlow,
  tokens: Awaited<ReturnType<typeof exchangeAuthorization>>,
): Promise<void> {
  const configPath = getAppMcpConfigPath();

  let config: { mcpServers: Record<string, Record<string, unknown>> };
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    config = { mcpServers: parsed.mcpServers || parsed };
  } catch {
    logger.warn('mcp.json not found or unreadable; saving token by flow name');
    await saveExternalMcpTokens({
      serverId: flow.serverName,
      serverUrl: flow.serverUrl,
      authServerBase: flow.authServerBase,
      clientInfo: flow.clientInfo,
      metadata: flow.metadata,
      tokens,
    });
    return;
  }

  let matchedServerName = flow.serverName;
  let configChanged = false;

  // Match by name first, then by URL fallback.
  for (const [name, server] of Object.entries(config.mcpServers)) {
    const isMatch =
      name === flow.serverName ||
      ('url' in server && server.url === flow.serverUrl);
    if (isMatch) {
      matchedServerName = name;
      if (
        typeof server.headers === 'object' &&
        server.headers !== null &&
        typeof (server.headers as Record<string, unknown>).Authorization ===
          'string'
      ) {
        delete (server.headers as Record<string, unknown>).Authorization;
        if (Object.keys(server.headers).length === 0) {
          delete server.headers;
        }
        configChanged = true;
      }
      server.oauth = {
        tokenStore: 'encrypted',
        updatedAt: new Date().toISOString(),
      };
      configChanged = true;
      break;
    }
  }

  await saveExternalMcpTokens({
    serverId: matchedServerName,
    serverUrl: flow.serverUrl,
    authServerBase: flow.authServerBase,
    clientInfo: flow.clientInfo,
    metadata: flow.metadata,
    tokens,
  });

  if (configChanged) {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }
  logger.info(`Saved encrypted OAuth token for "${matchedServerName}"`);
}
