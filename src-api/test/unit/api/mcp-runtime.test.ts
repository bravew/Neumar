import { afterEach, describe, expect, it, vi } from 'vitest';

import { mcpRuntimeRoutes } from '@/app/api/mcp-runtime';

import { activeQueryStore } from '@/shared/services/active-query-store';

describe('mcp runtime routes', () => {
  afterEach(() => {
    activeQueryStore.unregister('task_mcp');
    vi.restoreAllMocks();
  });

  it('normalizes bare MCP stdio configs and preserves env', async () => {
    const query = {
      setMcpServers: vi.fn(async () => ({ applied: true })),
    };
    activeQueryStore.register('task_mcp', query as never, 'session_mcp');

    const res = await mcpRuntimeRoutes.request('/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'task_mcp',
        serverName: 'kimi',
        config: {
          command: 'kimi-mcp',
          args: ['--stdio'],
          env: { KIMI_API_KEY: 'test-key' },
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      result: { applied: true },
    });
    expect(query.setMcpServers).toHaveBeenCalledWith({
      kimi: {
        type: 'stdio',
        command: 'kimi-mcp',
        args: ['--stdio'],
        env: { KIMI_API_KEY: 'test-key' },
      },
    });
  });

  it('keeps explicit stdio configs compatible', async () => {
    const query = {
      setMcpServers: vi.fn(async () => ({ applied: true })),
    };
    activeQueryStore.register('task_mcp', query as never, 'session_mcp');

    const res = await mcpRuntimeRoutes.request('/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'task_mcp',
        serverName: 'hermes',
        config: {
          type: 'stdio',
          command: 'hermes',
          args: ['mcp'],
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(query.setMcpServers).toHaveBeenCalledWith({
      hermes: {
        type: 'stdio',
        command: 'hermes',
        args: ['mcp'],
      },
    });
  });
});
