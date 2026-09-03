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

async function readNdjson(
  stream: PassThrough,
  count: number,
  timeoutMs = 5_000,
): Promise<unknown[]> {
  const frames: unknown[] = [];
  let buffer = '';
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for ${count} JSON-RPC frames; got ${frames.length}: ${buffer}`,
        ),
      );
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline !== -1 && frames.length < count) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) frames.push(JSON.parse(line) as unknown);
        newline = buffer.indexOf('\n');
      }
      if (frames.length >= count) {
        clearTimeout(timer);
        stream.off('data', onData);
        resolve(frames);
      }
    };
    stream.on('data', onData);
  });
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

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const handle = serveStdio(() => createPublicMcpServer(client), {
      transport: new StdioServerTransport(stdin, stdout),
      legacy: 'serve',
    });

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
    await readNdjson(stdout, 1);
    stdin.write(
      encodeRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );
    stdin.write(
      encodeRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    );
    const [listed] = (await readNdjson(stdout, 1)) as Array<{
      result?: { tools?: Array<{ name: string }> };
    }>;
    expect(listed?.result?.tools?.map((tool) => tool.name)).toEqual([
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
    const [health] = (await readNdjson(stdout, 1)) as Array<{
      result?: { structuredContent?: { flags?: { enabled?: boolean } } };
    }>;
    expect(health?.result?.structuredContent?.flags?.enabled).toBe(true);

    stdin.write(
      encodeRpc({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'neumar_list_projects', arguments: { limit: 10 } },
      }),
    );
    const [projects] = (await readNdjson(stdout, 1)) as Array<{
      result?: { structuredContent?: { items?: unknown[] } };
    }>;
    expect(Array.isArray(projects?.result?.structuredContent?.items)).toBe(
      true,
    );

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
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const handle = serveStdio(() => createPublicMcpServer(client), {
      transport: new StdioServerTransport(stdin, stdout),
      legacy: 'serve',
    });
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
    await readNdjson(stdout, 1);
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
    const [called] = (await readNdjson(stdout, 1)) as Array<{
      result?: { isError?: boolean; content?: Array<{ text: string }> };
    }>;
    expect(called?.result?.isError).toBe(true);
    expect(called?.result?.content?.[0]?.text).toContain('DAEMON_UNREACHABLE');
    await handle.close();
  });
});
