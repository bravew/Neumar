/**
 * Integration test for the loopback MCP bridge. Spawns the Hono app in-
 * process and round-trips an MCP `initialize` + `tools/list` against
 * `/mcp/bridge/google` using a freshly minted bridge token.
 *
 * What this catches: response-shape regressions. Codex's RMCP transport
 * fails closed on any body that doesn't deserialize as JsonRpcMessage —
 * if `WebStandardStreamableHTTPServerTransport.handleRequest` ever stops
 * returning a proper JSON-RPC envelope, the model silently loses the
 * Gmail tools (and we observed this exact symptom in the wild).
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { mcpBridgeRoutes } from '@/app/api/mcp-bridge';

import { mintBridgeToken } from '@/shared/mcp/subprocess-bridge/token-store';

// Stub the OAuth client so the route doesn't try to refresh real tokens.
vi.mock('@/shared/auth/oauth-client', () => ({
  getValidAccessToken: vi.fn(async () => 'fake-google-access-token'),
  getGrantedScopes: vi.fn(async () => [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
  ]),
}));

function makeApp(): Hono {
  const app = new Hono();
  app.route('/mcp/bridge', mcpBridgeRoutes);
  return app;
}

describe('mcp-bridge HTTP route', () => {
  it('rejects requests without a bearer token', async () => {
    const app = makeApp();
    const res = await app.request('/mcp/bridge/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    });
    expect(res.status).toBe(401);
  });

  it('completes an MCP initialize handshake with a valid token', async () => {
    const app = makeApp();
    const token = mintBridgeToken({
      connector: 'google',
      policyContext: { platform: 'desktop', permissionTier: 'admin' },
      sessionId: 'test-session',
    });

    const res = await app.request('/mcp/bridge/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Codex's RMCP requires the body parse as a JsonRpcMessage.
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: expect.objectContaining({
        protocolVersion: expect.any(String),
        serverInfo: expect.objectContaining({ name: 'google' }),
      }),
    });
  });

  it('lists Gmail tools after handshake', async () => {
    const app = makeApp();
    const token = mintBridgeToken({
      connector: 'google',
      policyContext: { platform: 'desktop', permissionTier: 'admin' },
      sessionId: 'test-session',
    });

    // Stateless transport — initialize + tools/list each open their own
    // server, so a single `tools/list` works on its own. We still send
    // initialize first to mirror the real client flow.
    await app.request('/mcp/bridge/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    });

    const listRes = await app.request('/mcp/bridge/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });

    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as {
      result?: { tools?: Array<{ name: string }> };
    };
    const toolNames = (body.result?.tools ?? []).map((t) => t.name);
    expect(toolNames).toContain('google_gmail_list_messages');
  });

  it('lists asset catalog tools for the assets bridge', async () => {
    const app = makeApp();
    const token = mintBridgeToken({
      connector: 'assets',
      policyContext: { platform: 'desktop', permissionTier: 'admin' },
      sessionId: 'test-session',
    });

    const listRes = await app.request('/mcp/bridge/assets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        params: {},
      }),
    });

    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as {
      result?: { tools?: Array<{ name: string }> };
    };
    const toolNames = (body.result?.tools ?? []).map((t) => t.name);
    expect(toolNames).toContain('assets_search');
    expect(toolNames).toContain('assets_ingest');
  });
});
