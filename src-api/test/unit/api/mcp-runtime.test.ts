import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { mcpRuntimeRoutes } from '@/app/api/mcp-runtime';

import { closeDatabase, getDatabase } from '@/shared/db';
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

  it('reads only a UI resource the invoked tool advertised', async () => {
    const tempHome = mkdtempSync(path.join(tmpdir(), 'neuma-mcp-ui-'));
    vi.stubEnv('HOME', tempHome);
    closeDatabase();
    const query = {
      mcpServerStatus: vi.fn(async () => [
        {
          name: 'widgets',
          tools: [
            {
              name: 'chart',
              _meta: { ui: { resourceUri: 'ui://widgets/chart' } },
            },
            { name: 'plain' },
          ],
        },
      ]),
      readMcpResource: vi.fn(async () => ({
        contents: [
          {
            uri: 'ui://widgets/chart',
            mimeType: 'text/html',
            text: '<p>chart</p>',
          },
        ],
      })),
    };
    activeQueryStore.register('task_mcp', query as never, 'session_mcp');
    const db = getDatabase();
    db.prepare('INSERT INTO tasks (id, prompt) VALUES (?, ?)').run(
      'task_mcp',
      'prompt',
    );
    db.prepare(
      `INSERT INTO messages (task_id, type, tool_name) VALUES (?, 'tool_use', ?)`,
    ).run('task_mcp', 'mcp__widgets__chart');

    const missing = await mcpRuntimeRoutes.request('/ui-resource', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'task_mcp',
        serverName: 'widgets',
        toolName: 'plain',
      }),
    });
    expect(missing.status).toBe(404);
    expect(query.readMcpResource).not.toHaveBeenCalled();

    const found = await mcpRuntimeRoutes.request('/ui-resource', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'task_mcp',
        serverName: 'widgets',
        toolName: 'chart',
      }),
    });
    expect(found.status).toBe(200);
    expect(query.readMcpResource).toHaveBeenCalledWith(
      'widgets',
      'ui://widgets/chart',
    );
    await expect(found.json()).resolves.toMatchObject({
      ok: true,
      uri: 'ui://widgets/chart',
      contents: [{ text: '<p>chart</p>' }],
    });
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(tempHome, { recursive: true, force: true });
  });
});
