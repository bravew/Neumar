/**
 * Integration test for the general-purpose in-process MCP bridge route
 * (`/mcp/bridge/inproc/:name`). Proves a per-run, project-scoped in-process
 * MCP server can be minted, reached over loopback by a subprocess agent, and
 * revoked — the foundation for running Video Mode (and other in-process tool
 * surfaces) on Codex/Cursor/Gemini/DeepSeek and any future CLI runtime.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mcpBridgeRoutes } from '@/app/api/mcp-bridge';

import {
  __resetInProcessBridgeForTests,
  mintInProcessBridgeToken,
  revokeInProcessBridgeToken,
} from '@/shared/mcp/subprocess-bridge/inprocess-bridge';

function makeApp(): Hono {
  const app = new Hono();
  app.route('/mcp/bridge', mcpBridgeRoutes);
  return app;
}

// A trivial stand-in for a real per-run server (video-edit, media, …).
function buildProbeServer(): McpServer {
  const server = new McpServer({ name: 'probe-edit', version: '0.1.0' });
  server.registerTool(
    'ping',
    { description: 'returns pong', inputSchema: {} },
    async () => ({ content: [{ type: 'text', text: 'pong' }] }),
  );
  return server;
}

function mintProbeToken(): string {
  return mintInProcessBridgeToken({
    name: 'probe-edit',
    sessionId: 'run-1',
    createServer: buildProbeServer,
  });
}

function rpc(token: string | undefined, name: string, body: unknown) {
  return makeApp().request(`/mcp/bridge/inproc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
};

describe('in-process MCP bridge route', () => {
  beforeEach(() => __resetInProcessBridgeForTests());
  afterEach(() => __resetInProcessBridgeForTests());

  it('rejects requests with no bearer token', async () => {
    const res = await rpc(undefined, 'probe-edit', INIT);
    expect(res.status).toBe(401);
  });

  it('completes an initialize handshake with a valid token', async () => {
    const res = await rpc(mintProbeToken(), 'probe-edit', INIT);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: expect.objectContaining({
        serverInfo: expect.objectContaining({ name: 'probe-edit' }),
      }),
    });
  });

  it('lists the per-run server tools', async () => {
    const token = mintProbeToken();
    await rpc(token, 'probe-edit', INIT);
    const res = await rpc(token, 'probe-edit', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    const body = await res.json();
    expect(body.result.tools.map((t: { name: string }) => t.name)).toContain(
      'ping',
    );
  });

  it('binds a token to its server name (no cross-name replay)', async () => {
    const res = await rpc(mintProbeToken(), 'media', INIT);
    expect(res.status).toBe(401);
  });

  it('rejects a revoked token', async () => {
    const token = mintProbeToken();
    revokeInProcessBridgeToken(token);
    const res = await rpc(token, 'probe-edit', INIT);
    expect(res.status).toBe(401);
  });

  it('invokes onResult with the response text after a tool call', async () => {
    let seen: string | undefined;
    const token = mintInProcessBridgeToken({
      name: 'probe-edit',
      sessionId: 'run-hook',
      createServer: buildProbeServer,
      onResult: (text) => {
        seen = text;
      },
    });
    await rpc(token, 'probe-edit', INIT);
    await rpc(token, 'probe-edit', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'ping', arguments: {} },
    });
    // The hook fires on every request; the tools/call response carries the
    // tool's text output ("pong"), which is what a media-ingest hook scans.
    expect(seen).toBeTruthy();
    expect(seen).toContain('pong');
  });
});
