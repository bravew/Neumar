import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
/**
 * Loopback HTTP bridge that exposes neuma's in-process MCP servers to
 * subprocess-shelled agents (Codex CLI, Gemini CLI, OpenCode, …) which
 * can't mount JS-defined MCP servers directly. Codex connects via
 * `[mcp_servers.google] url = "http://127.0.0.1:<api>/mcp/bridge/google"`
 * with a bearer token minted by the agent adapter for that run.
 *
 * Security:
 * - Loopback-only: rejects requests whose remote address isn't IPv4/IPv6
 *   loopback. Defense-in-depth — bearer auth is the real gate.
 * - Bearer token: minted per-run by `buildSubprocessMcpConfig`, stored in
 *   the in-process `BridgeTokenStore`, revoked when the run finishes.
 * - Connector binding: a token minted for `google` cannot reach `notion`.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  getGrantedScopes,
  getValidAccessToken,
} from '@/shared/auth/oauth-client';
import type { BinderRunContext } from '@/shared/connectors/binder';
import { buildAssetsBridgeServer } from '@/shared/mcp/subprocess-bridge/assets-bridge';
import { buildConnectorsBridgeServer } from '@/shared/mcp/subprocess-bridge/connectors-bridge';
import { buildGoogleBridgeServer } from '@/shared/mcp/subprocess-bridge/google-bridge';
import { lookupInProcessBridge } from '@/shared/mcp/subprocess-bridge/inprocess-bridge';
import {
  type BridgeConnector,
  type BridgeTokenEntry,
  lookupBridgeToken,
} from '@/shared/mcp/subprocess-bridge/token-store';
import { classifyIp } from '@/shared/network-policy/ip';
import { runWithSessionContext } from '@/shared/services/session-context';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('McpBridge');

const mcpBridgeRoutes = new Hono();

/** Resolve the underlying TCP remote address. `c.env.incoming` is the Node
 * `IncomingMessage` populated by `@hono/node-server`; absent under the test
 * runner (`app.request`) and some edge runtimes. */
function getRemoteAddress(c: Context): string | undefined {
  const incoming = (
    c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  )?.incoming;
  return incoming?.socket?.remoteAddress;
}

function isLoopbackRemote(remote: string | undefined): boolean {
  // Fall open when remote is undeterminable (test runner) — bearer auth is
  // the real gate. `classifyIp` recognises IPv6 loopback and all IPv4-
  // mapped-IPv6 forms (`::ffff:127.0.0.1`, `::ffff:7f00:1`, etc.).
  if (!remote) return true;
  return classifyIp(remote)?.classification === 'loopback';
}

function extractBearer(c: Context): string | undefined {
  const header = c.req.header('authorization') ?? c.req.header('Authorization');
  return header?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

function bridgeRunContextFromEntry(entry: BridgeTokenEntry): BinderRunContext {
  const policyContext = entry.policyContext ?? {};
  const platform = policyContext.platform ?? 'desktop';
  return {
    runId: entry.sessionId,
    surface: 'subprocess',
    platform,
    configId: policyContext.channelId,
    channelId: policyContext.channelId,
    accountId: policyContext.identityId ?? 'default',
    identityId: policyContext.identityId,
    permissionTier:
      policyContext.permissionTier ??
      (platform === 'desktop' ? 'admin' : undefined),
    automationOrigin: policyContext.automationOrigin,
    connectedAccountId: entry.connectorScope?.connectedAccountId,
    providerUserId: entry.connectorScope?.userId,
  };
}

// General case: a per-run, project-scoped in-process MCP server (e.g. Video
// Mode's `video-edit`/`media`/`ffmpeg`), keyed by a token bound to one server
// name. Runtime-agnostic — any subprocess CLI adapter (Codex, Cursor, Gemini,
// DeepSeek, …) consumes it the same way as the fixed connectors above.
mcpBridgeRoutes.all('/inproc/:name', async (c) => {
  const name = c.req.param('name');
  const remote = getRemoteAddress(c);

  if (!isLoopbackRemote(remote)) {
    logger.warn(
      `Rejecting non-loopback in-process bridge request from ${remote}`,
    );
    return c.json({ error: 'Forbidden' }, 403);
  }

  const token = extractBearer(c);
  const entry = lookupInProcessBridge(token, name);
  if (!entry) {
    logger.warn(
      `In-process bridge auth failed: name=${name} hasToken=${!!token}`,
    );
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  // Install the run's session context around the call so in-process tools that
  // read getSessionContext() (e.g. the media server's output dir) behave the
  // same as on the direct Claude path; without context they'd fall back to the
  // wrong dir. Plain passthrough when the caller didn't supply one.
  const ctx = entry.sessionContext;
  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    ctx ? runWithSessionContext(ctx, fn) : fn();
  try {
    return await run(async () => {
      const server = await entry.createServer();
      await server.connect(transport);
      const response = await transport.handleRequest(c.req.raw);
      // Generic post-request hook: subprocess runtimes have no lifecycle hooks,
      // so the caller (e.g. the video agent) reacts to tool output here — e.g.
      // ingesting generated media. Best-effort; never fails the request. Keeps
      // this route runtime- and feature-agnostic.
      if (entry.onResult) {
        try {
          await entry.onResult(await response.clone().text());
        } catch (hookErr) {
          logger.warn(
            `In-process bridge onResult failed for ${name}: ${hookErr}`,
          );
        }
      }
      return response;
    });
  } catch (err) {
    logger.error(`In-process bridge request failed for ${name}: ${err}`);
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  } finally {
    try {
      await transport.close();
    } catch {
      /* idempotent */
    }
  }
});

mcpBridgeRoutes.all('/:connector{google|connector|assets}', async (c) => {
  const connector = c.req.param('connector') as BridgeConnector;
  const remote = getRemoteAddress(c);

  if (!isLoopbackRemote(remote)) {
    logger.warn(`Rejecting non-loopback MCP bridge request from ${remote}`);
    return c.json({ error: 'Forbidden' }, 403);
  }

  const token = extractBearer(c);
  const entry = lookupBridgeToken(token);
  if (!entry || entry.connector !== connector) {
    logger.warn(
      `Bridge auth failed: hasToken=${!!token} connectorMatch=${entry?.connector === connector}`,
    );
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  let server: McpServer;
  try {
    if (connector === 'google') {
      // Forward the mint-time identity into Phase C's identity-aware
      // resolver. Today every minted token is admin-tier (the gate blocks
      // non-admins from receiving one) so this is a no-op, but once Phase
      // 3b lands per-identity Google OAuth a Codex run for identity X must
      // see X's token, not the global admin one. Cheap to wire now.
      const accessToken = await getValidAccessToken('google', {
        identityId: entry.policyContext?.identityId,
      });
      if (!accessToken) {
        logger.warn(
          'Google bridge: getValidAccessToken returned null — user not authenticated to this API instance',
        );
        return c.json({ error: 'Google not authenticated' }, 503);
      }
      const grantedScopes = await getGrantedScopes('google');
      server = buildGoogleBridgeServer(grantedScopes);
    } else if (connector === 'connector') {
      // Composio connector tools. The handler closes over the policy
      // context resolved from the mint-time token so every tool call runs
      // through the same tier/approval gate the in-process binder uses.
      server = buildConnectorsBridgeServer({
        buildContext: () => bridgeRunContextFromEntry(entry),
      });
    } else if (connector === 'assets') {
      server = buildAssetsBridgeServer();
    } else {
      return c.json({ error: 'Unsupported connector' }, 400);
    }

    await server.connect(transport);
    return await transport.handleRequest(c.req.raw);
  } catch (err) {
    logger.error(`Bridge request failed for ${connector}: ${err}`);
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  } finally {
    try {
      await transport.close();
    } catch {
      /* idempotent */
    }
  }
});

export { mcpBridgeRoutes };
