import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postJson } from '../helpers/http-client';
import {
  spawnApiInstance,
  stopApiInstance,
  type ApiInstance,
} from '../helpers/spawn-api';
import {
  assertStdoutIsJsonRpc,
  encodeRpc,
  initializeMcp,
  packagedSidecarPath,
  spawnMcpStdio,
  stopMcpStdio,
  waitForRpc,
  type McpStdioChild,
} from '../helpers/spawn-mcp-stdio';

function toolNames(listed: unknown): string[] {
  const tools = (listed as { tools?: Array<{ name: string }> } | undefined)
    ?.tools;
  return tools?.map((tool) => tool.name) ?? [];
}

function errorCode(frame: { result?: unknown }): string | undefined {
  const result = frame.result as
    | { isError?: boolean; content?: Array<{ text?: string }> }
    | undefined;
  if (!result?.isError) return undefined;
  try {
    return (JSON.parse(result.content?.[0]?.text ?? '{}') as { code?: string })
      .code;
  } catch {
    return undefined;
  }
}

describe.sequential('external MCP stdio child', () => {
  let api: ApiInstance;

  beforeAll(async () => {
    api = await spawnApiInstance('external-mcp', {
      env: { NEUMA_DISABLE_CHANNELS: '1' },
    });
    await postJson(api.baseUrl, '/db/settings/externalMcpEnabled', {
      value: 'true',
    });
    await postJson(api.baseUrl, '/db/settings/externalMcpWritesEnabled', {
      value: 'false',
    });
  }, 60_000);

  afterAll(async () => {
    await stopApiInstance(api);
  });

  async function withChild(
    run: (session: McpStdioChild) => Promise<void>,
    options?: Parameters<typeof spawnMcpStdio>[0],
  ): Promise<McpStdioChild> {
    const session = spawnMcpStdio({
      homeDir: api.homeDir,
      daemonUrl: api.baseUrl,
      ...options,
    });
    try {
      await run(session);
    } finally {
      await stopMcpStdio(session);
    }
    return session;
  }

  it('speaks JSON-RPC over stdio, lists health, and keeps stdout clean', async () => {
    const session = await withChild(async (child) => {
      const init = (await initializeMcp(child)) as {
        serverInfo?: { name?: string };
        instructions?: string;
      };
      expect(init.serverInfo?.name).toBe('neumar');
      expect(init.instructions).toContain('DAEMON_UNREACHABLE');

      child.child.stdin?.write(
        encodeRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      );
      const listed = await waitForRpc(child, 2);
      const names = toolNames(listed.result);
      expect(names).toContain('neumar_health');
      expect(names).not.toContain('neumar_create_project');
      expect(names).not.toContain('neumar_start_agent_run');

      child.child.stdin?.write(
        encodeRpc({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'neumar_health', arguments: {} },
        }),
      );
      const health = await waitForRpc(child, 3);
      expect(health.error).toBeUndefined();
      expect(JSON.stringify(health.result)).toContain('"ready"');
    });
    assertStdoutIsJsonRpc(session.stdout);
    expect(session.label === 'tsx' || session.label.length > 0).toBe(true);
  });

  it('returns FEATURE_DISABLED when the inbound flag is off', async () => {
    await postJson(api.baseUrl, '/db/settings/externalMcpEnabled', {
      value: 'false',
    });
    try {
      await withChild(async (child) => {
        await initializeMcp(child);
        child.child.stdin?.write(
          encodeRpc({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'neumar_list_projects', arguments: {} },
          }),
        );
        const listed = await waitForRpc(child, 2);
        expect(errorCode(listed)).toBe('FEATURE_DISABLED');
      });
    } finally {
      await postJson(api.baseUrl, '/db/settings/externalMcpEnabled', {
        value: 'true',
      });
    }
  });

  it('returns DAEMON_UNREACHABLE when Neumar is not listening', async () => {
    const emptyHome = await mkdtemp(join(tmpdir(), 'neumar-mcp-nodemon-'));
    const session = spawnMcpStdio({
      homeDir: emptyHome,
      daemonUrl: 'http://127.0.0.1:1',
    });
    try {
      await initializeMcp(session);
      session.child.stdin?.write(
        encodeRpc({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'neumar_health', arguments: {} },
        }),
      );
      const health = await waitForRpc(session, 2);
      expect(errorCode(health)).toBe('DAEMON_UNREACHABLE');
    } finally {
      await stopMcpStdio(session);
      await rm(emptyHome, { recursive: true, force: true });
    }
  });

  it('rejects a non-loopback --daemon-url without writing JSON-RPC noise as logs', async () => {
    const session = spawnMcpStdio({
      homeDir: api.homeDir,
      daemonUrl: 'http://example.com:80',
    });
    const code = await new Promise<number | null>((resolve) => {
      session.child.once('exit', (exitCode) => resolve(exitCode));
      setTimeout(() => resolve(-1), 15_000);
    });
    await stopMcpStdio(session);
    expect(code).toBeGreaterThan(0);
    expect(session.stdout.trim()).toBe('');
    expect(session.stderr).toMatch(/loopback/i);
  });

  it('exits on stdin EOF', async () => {
    const session = spawnMcpStdio({
      homeDir: api.homeDir,
      daemonUrl: api.baseUrl,
    });
    await initializeMcp(session);
    session.child.stdin?.end();
    const code = await new Promise<number | null>((resolve) => {
      session.child.once('exit', (exitCode) => resolve(exitCode));
      setTimeout(() => resolve(null), 15_000);
    });
    await stopMcpStdio(session);
    expect(code).toBe(0);
  });

  it('exits after the idle timeout when stdin is quiet', async () => {
    const session = spawnMcpStdio({
      homeDir: api.homeDir,
      daemonUrl: api.baseUrl,
      env: { NEUMAR_MCP_IDLE_MS: '800' },
    });
    const code = await new Promise<number | null>((resolve) => {
      session.child.once('exit', (exitCode) => resolve(exitCode));
      setTimeout(() => resolve(null), 20_000);
    });
    await stopMcpStdio(session);
    expect(code).toBe(0);
  });

  it('returns UNAUTHORIZED when the secret file is missing', async () => {
    const emptyHome = await mkdtemp(join(tmpdir(), 'neumar-mcp-nosecret-'));
    const session = spawnMcpStdio({
      homeDir: emptyHome,
      daemonUrl: api.baseUrl,
    });
    try {
      await initializeMcp(session);
      session.child.stdin?.write(
        encodeRpc({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'neumar_list_projects', arguments: {} },
        }),
      );
      const listed = await waitForRpc(session, 2);
      expect(errorCode(listed)).toBe('UNAUTHORIZED');
    } finally {
      await stopMcpStdio(session);
      await rm(emptyHome, { recursive: true, force: true });
    }
  });

  it('ignores malformed stdin and still answers a later health call', async () => {
    await withChild(async (child) => {
      await initializeMcp(child);
      child.child.stdin?.write('this is not json-rpc\n');
      child.child.stdin?.write(
        encodeRpc({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'neumar_health', arguments: {} },
        }),
      );
      const health = await waitForRpc(child, 2);
      expect(health.error).toBeUndefined();
    });
  });

  const sidecar =
    process.env.NEUMAR_MCP_SIDECAR_SMOKE === '1' ? packagedSidecarPath() : null;
  it.skipIf(!sidecar)(
    'packaged sidecar speaks the same health handshake',
    async () => {
      if (!sidecar) return;
      const session = spawnMcpStdio({
        homeDir: api.homeDir,
        daemonUrl: api.baseUrl,
        commandOverride: {
          command: sidecar,
          args: ['mcp', 'server'],
          label: 'sidecar',
        },
      });
      try {
        await initializeMcp(session);
        session.child.stdin?.write(
          encodeRpc({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'neumar_health', arguments: {} },
          }),
        );
        const health = await waitForRpc(session, 2, 20_000);
        expect(health.error).toBeUndefined();
        assertStdoutIsJsonRpc(session.stdout);
      } finally {
        await stopMcpStdio(session);
      }
    },
  );
});
