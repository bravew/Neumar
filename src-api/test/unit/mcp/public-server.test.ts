import { describe, expect, it } from 'vitest';

import { createDaemonClient } from '@/shared/mcp/public-server/daemon-client';
import {
  defaultDaemonUrl,
  isLoopbackDaemonUrl,
  resolveDaemonUrl,
} from '@/shared/mcp/public-server/discover';
import { createPublicMcpServer } from '@/shared/mcp/public-server/server';

describe('public MCP stdio adapter', () => {
  it('accepts only loopback daemon URLs', () => {
    expect(isLoopbackDaemonUrl('http://127.0.0.1:5126')).toBe(true);
    expect(isLoopbackDaemonUrl('http://localhost:2620')).toBe(true);
    expect(isLoopbackDaemonUrl('http://[::1]:5126')).toBe(true);
    expect(isLoopbackDaemonUrl('http://example.com:5126')).toBe(false);
    expect(isLoopbackDaemonUrl('http://192.168.1.5:5126')).toBe(false);
    expect(isLoopbackDaemonUrl('http://user:pass@127.0.0.1:5126')).toBe(false);
  });

  it('resolves --daemon-url over the default', () => {
    expect(resolveDaemonUrl('http://127.0.0.1:2620')).toBe(
      'http://127.0.0.1:2620',
    );
    expect(() => resolveDaemonUrl('http://8.8.8.8:80')).toThrow(/loopback/);
    expect(defaultDaemonUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('retries a failed read once', async () => {
    let reads = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/projects')) {
        reads += 1;
        if (reads === 1) throw new Error('connect ECONNREFUSED');
        return new Response(
          JSON.stringify({
            items: [],
            nextCursor: null,
            truncated: false,
            byteLength: 2,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      throw new Error(`unexpected ${url}`);
    };

    const client = createDaemonClient({
      initialUrl: 'http://127.0.0.1:5126',
      fetchImpl,
      readSecret: () => 'secret',
    });
    const listed = (await client.call('neumar_list_projects', {})) as {
      items: unknown[];
    };
    expect(reads).toBe(2);
    expect(listed.items).toEqual([]);
  });

  it('maps fetch failures to DAEMON_UNREACHABLE', async () => {
    const client = createDaemonClient({
      initialUrl: 'http://127.0.0.1:1',
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      readSecret: () => 'secret',
    });
    await expect(client.health()).rejects.toMatchObject({
      code: 'DAEMON_UNREACHABLE',
    });
  });

  it('registers the read catalog on the public server', () => {
    const client = createDaemonClient({
      initialUrl: 'http://127.0.0.1:5126',
      fetchImpl: async () => new Response('{}'),
      readSecret: () => 'secret',
    });
    const server = createPublicMcpServer(client);
    expect(server).toBeTruthy();
  });
});
