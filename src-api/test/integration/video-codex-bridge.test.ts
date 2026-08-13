/**
 * End-to-end plumbing check for Codex-on-Video (CP7): the actual `video-edit`
 * MCP server — built with the Anthropic SDK's createSdkMcpServer — is reachable
 * through the loopback in-process bridge via its `.instance`, exactly as the
 * video agent wires it for a Codex (subprocess) run. A live Codex LLM turn is
 * non-deterministic and out of scope here; this locks the deterministic
 * substrate: the video tools really do list over the bridge URL Codex connects
 * to.
 */
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mcpBridgeRoutes } from '@/app/api/mcp-bridge';

import {
  __resetInProcessBridgeForTests,
  mintInProcessBridgeToken,
} from '@/shared/mcp/subprocess-bridge/inprocess-bridge';
import { createVideoEditServer } from '@/shared/mcp/video-edit-server';

function app(): Hono {
  const a = new Hono();
  a.route('/mcp/bridge', mcpBridgeRoutes);
  return a;
}

function rpc(token: string, body: unknown) {
  return app().request('/mcp/bridge/inproc/video-edit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe('Codex-on-Video bridge (CP7 plumbing)', () => {
  beforeEach(() => __resetInProcessBridgeForTests());
  afterEach(() => __resetInProcessBridgeForTests());

  it('lists video-edit tools through the loopback bridge via .instance', async () => {
    const token = mintInProcessBridgeToken({
      name: 'video-edit',
      sessionId: 'codex-run',
      // Exactly how the video agent bridges it for Codex.
      createServer: () =>
        createVideoEditServer({
          projectId: 'p-codex',
          aspectRatio: '16:9',
          clientKind: 'first-party',
        }).instance,
    });

    await rpc(token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'codex', version: '1.0.0' },
      },
    });

    const res = await rpc(token, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const toolNames: string[] = body.result.tools.map(
      (t: { name: string }) => t.name,
    );
    // The core video editing tools the Codex agent needs must be present.
    expect(toolNames).toContain('video_get_project_summary');
    expect(toolNames).toContain('video_analyze_assets');
    expect(toolNames.length).toBeGreaterThan(5);
  });
});
