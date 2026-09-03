import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';

import {
  StdioServerTransport,
  serveStdio,
} from '@modelcontextprotocol/server/stdio';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mcpServerRoutes } from '@/app/api/mcp-server';

import { saveSetting } from '@/shared/db/operations';
import { createDaemonClient } from '@/shared/mcp/public-server/daemon-client';
import { ensureBridgeSecret } from '@/shared/mcp/public-server/secret';
import { createPublicMcpServer } from '@/shared/mcp/public-server/server';

function encodeRpc(message: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
}

class RpcCollector {
  private buffer = '';
  private readonly frames: unknown[] = [];

  constructor(stream: PassThrough) {
    stream.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let newline = this.buffer.indexOf('\n');
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line.length > 0) this.frames.push(JSON.parse(line) as unknown);
        newline = this.buffer.indexOf('\n');
      }
    });
  }

  async next(timeoutMs = 5_000): Promise<unknown> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const frame = this.frames.shift();
      if (frame !== undefined) return frame;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for a JSON-RPC frame');
  }

  async nextId(
    id: number,
    timeoutMs = 5_000,
  ): Promise<{ result?: unknown; error?: unknown }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.frames.findIndex(
        (frame) => (frame as { id?: number }).id === id,
      );
      if (index !== -1) {
        return this.frames.splice(index, 1)[0] as {
          result?: unknown;
          error?: unknown;
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for JSON-RPC id ${id}`);
  }
}

function startStdio(client: ReturnType<typeof createDaemonClient>) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const rpc = new RpcCollector(stdout);
  const handle = serveStdio(() => createPublicMcpServer(client), {
    transport: new StdioServerTransport(stdin, stdout),
    legacy: 'serve',
  });
  return { stdin, rpc, handle };
}

function writeInitialize(stdin: PassThrough) {
  stdin.write(
    encodeRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'stdio-test', version: '0.0.0' },
      },
    }),
  );
}

describe('public MCP stdio against the daemon facade', () => {
  const app = new Hono();
  app.route('/mcp/server', mcpServerRoutes);

  beforeEach(() => {
    saveSetting('externalMcpEnabled', 'true');
    saveSetting('externalMcpWritesEnabled', 'false');
    ensureBridgeSecret();
  });

  afterEach(() => {
    saveSetting('externalMcpEnabled', 'false');
    saveSetting('externalMcpWritesEnabled', 'false');
  });

  it('lists read tools and calls health plus list_projects', async () => {
    const client = createDaemonClient({
      initialUrl: 'http://127.0.0.1:5126',
      readSecret: ensureBridgeSecret,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        return app.request(url.pathname + url.search, {
          method: init?.method,
          headers: init?.headers as Record<string, string> | undefined,
          body: init?.body as string | undefined,
        });
      },
    });

    const { stdin, rpc, handle } = startStdio(client);
    writeInitialize(stdin);
    await rpc.nextId(1);
    stdin.write(
      encodeRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );
    stdin.write(
      encodeRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    );
    const listed = await rpc.nextId(2);
    expect(
      (listed.result as { tools?: Array<{ name: string }> })?.tools?.map(
        (tool) => tool.name,
      ),
    ).toEqual([
      'neumar_health',
      'neumar_list_projects',
      'neumar_get_project',
      'neumar_list_tasks',
      'neumar_search_tasks',
      'neumar_get_task',
      'neumar_get_run_tree',
    ]);

    stdin.write(
      encodeRpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'neumar_health', arguments: {} },
      }),
    );
    const health = await rpc.nextId(3);
    expect(
      (
        health.result as {
          structuredContent?: { flags?: { enabled?: boolean } };
        }
      )?.structuredContent?.flags?.enabled,
    ).toBe(true);

    stdin.write(
      encodeRpc({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'neumar_list_projects', arguments: { limit: 10 } },
      }),
    );
    const projects = await rpc.nextId(4);
    expect(
      Array.isArray(
        (projects.result as { structuredContent?: { items?: unknown[] } })
          ?.structuredContent?.items,
      ),
    ).toBe(true);

    await handle.close();
  });

  it('omits write tools until writes are enabled, then creates a project', async () => {
    saveSetting('externalMcpWritesEnabled', 'true');
    const client = createDaemonClient({
      initialUrl: 'http://127.0.0.1:5126',
      readSecret: ensureBridgeSecret,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        return app.request(url.pathname + url.search, {
          method: init?.method,
          headers: init?.headers as Record<string, string> | undefined,
          body: init?.body as string | undefined,
        });
      },
    });
    const { stdin, rpc, handle } = startStdio(client);
    writeInitialize(stdin);
    await rpc.nextId(1);
    stdin.write(
      encodeRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );
    stdin.write(
      encodeRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    );
    const listed = await rpc.nextId(2);
    const names = (
      listed.result as { tools?: Array<{ name: string }> }
    )?.tools?.map((tool) => tool.name);
    expect(names).toContain('neumar_create_project');
    expect(names).toContain('neumar_create_task');
    expect(names).toContain('neumar_update_task');
    expect(names).toContain('neumar_add_task_comment');
    expect(names).not.toContain('neumar_start_agent_run');

    const requestId = randomUUID();
    stdin.write(
      encodeRpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'neumar_create_project',
          arguments: { requestId, name: `Stdio ${requestId.slice(0, 8)}` },
        },
      }),
    );
    const created = await rpc.nextId(3);
    expect(
      (created.result as { structuredContent?: { name?: string } })
        ?.structuredContent?.name,
    ).toContain('Stdio');
    await handle.close();
  });

  it('returns DAEMON_UNREACHABLE when the daemon is down', async () => {
    const client = createDaemonClient({
      initialUrl: 'http://127.0.0.1:1',
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      readSecret: () => 'secret',
    });
    const { stdin, rpc, handle } = startStdio(client);
    writeInitialize(stdin);
    await rpc.nextId(1);
    stdin.write(
      encodeRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );
    stdin.write(
      encodeRpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'neumar_health', arguments: {} },
      }),
    );
    const called = await rpc.nextId(2);
    expect((called.result as { isError?: boolean })?.isError).toBe(true);
    expect(
      (called.result as { content?: Array<{ text: string }> })?.content?.[0]
        ?.text,
    ).toContain('DAEMON_UNREACHABLE');
    await handle.close();
  });
});
