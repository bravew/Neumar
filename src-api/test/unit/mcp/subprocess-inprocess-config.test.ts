import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSubprocessMcpConfig } from '@/shared/mcp/subprocess-bridge';
import {
  __resetInProcessBridgeForTests,
  lookupInProcessBridge,
} from '@/shared/mcp/subprocess-bridge/inprocess-bridge';

function probe(name: string) {
  return {
    name,
    createServer: () => new McpServer({ name, version: '0.1.0' }),
  };
}

describe('buildSubprocessMcpConfig — in-process servers', () => {
  beforeEach(() => __resetInProcessBridgeForTests());
  afterEach(() => __resetInProcessBridgeForTests());

  it('mounts each in-process server with a name-bound token + url', async () => {
    const cfg = await buildSubprocessMcpConfig({
      sessionId: 'run-1',
      channelContext: { platform: 'desktop', permissionTier: 'admin' },
      connectors: [], // isolate the in-process path
      inProcessServers: [probe('video-edit'), probe('media')],
      apiBase: 'http://127.0.0.1:5126',
    });

    const servers = cfg.codexConfig.mcp_servers ?? {};
    expect(servers['video-edit']?.url).toBe(
      'http://127.0.0.1:5126/mcp/bridge/inproc/video-edit',
    );
    expect(servers['media']?.url).toBe(
      'http://127.0.0.1:5126/mcp/bridge/inproc/media',
    );

    // Token env var is derived from the name and present in env.
    const editEnv = servers['video-edit']!.bearer_token_env_var;
    expect(editEnv).toBe('NEUMA_MCP_BRIDGE_TOKEN_INPROC_VIDEO_EDIT');
    const token = cfg.env[editEnv];
    expect(token).toBeTruthy();

    // The minted token resolves to the right server and is name-bound.
    expect(lookupInProcessBridge(token, 'video-edit')).toBeDefined();
    expect(lookupInProcessBridge(token, 'media')).toBeUndefined();
  });

  it('connectors:[] excludes global bridges but keeps in-process servers', async () => {
    // Mirrors the video agent's disablePolicyServers path: scope the run to
    // its own tools, no google/composio/assets connector bridges.
    const cfg = await buildSubprocessMcpConfig({
      sessionId: 'run-scoped',
      channelContext: { platform: 'desktop', permissionTier: 'admin' },
      connectors: [],
      inProcessServers: [probe('video-edit'), probe('media')],
    });
    const servers = cfg.codexConfig.mcp_servers ?? {};
    expect(servers['google']).toBeUndefined();
    expect(servers['connector']).toBeUndefined();
    expect(servers['assets']).toBeUndefined();
    expect(servers['video-edit']).toBeDefined();
    expect(servers['media']).toBeDefined();
  });

  it('revoke() tears down the in-process tokens', async () => {
    const cfg = await buildSubprocessMcpConfig({
      sessionId: 'run-2',
      channelContext: { platform: 'desktop', permissionTier: 'admin' },
      connectors: [],
      inProcessServers: [probe('video-edit')],
    });
    const token = cfg.env['NEUMA_MCP_BRIDGE_TOKEN_INPROC_VIDEO_EDIT'];
    expect(lookupInProcessBridge(token, 'video-edit')).toBeDefined();
    cfg.revoke();
    expect(lookupInProcessBridge(token, 'video-edit')).toBeUndefined();
  });

  it('caps output_token_limit on the video-edit server for its heavy tools only', async () => {
    const cfg = await buildSubprocessMcpConfig({
      sessionId: 'run-3',
      channelContext: { platform: 'desktop', permissionTier: 'admin' },
      connectors: [],
      inProcessServers: [probe('video-edit'), probe('media')],
    });
    const servers = cfg.codexConfig.mcp_servers ?? {};

    // Heavy, payload-scaling video tools get a positive-integer token cap
    // (Codex CLI 0.152 `mcp_servers.<name>.tools.<tool>.output_token_limit`).
    expect(servers['video-edit']?.tools?.video_inspect_timeline_frames).toEqual(
      { output_token_limit: 4_000 },
    );
    expect(servers['video-edit']?.tools?.video_get_packed_transcript).toEqual({
      output_token_limit: 8_000,
    });

    // A small-payload tool on the same server is left uncapped.
    expect(
      servers['video-edit']?.tools?.video_get_project_summary,
    ).toBeUndefined();

    // A server with no configured heavy tools gets no `tools` entry at all.
    expect(servers['media']?.tools).toBeUndefined();
  });
});
