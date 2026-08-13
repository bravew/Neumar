import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeCursorWorkspaceMcpConfig } from '@/extensions/agent/cursor-agent/mcp-config';

import type { SubprocessMcpConfig } from '@/shared/mcp/subprocess-bridge';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

describe('writeCursorWorkspaceMcpConfig', () => {
  it('preserves user-owned top-level config while temporarily adding bridge servers', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'cursor-mcp-'));
    tempDirs.push(cwd);
    const mcpPath = join(cwd, '.cursor', 'mcp.json');
    const original = {
      inputs: [{ id: 'github-token', type: 'promptString' }],
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
        },
      },
    };
    await mkdir(join(cwd, '.cursor'), { recursive: true });
    await writeFile(mcpPath, `${JSON.stringify(original, null, 2)}\n`, 'utf8');

    const restore = await writeCursorWorkspaceMcpConfig(cwd, bridgeFixture());
    const duringRun = JSON.parse(
      await readFile(mcpPath, 'utf8'),
    ) as typeof original & {
      mcpServers: Record<string, unknown>;
    };

    expect(duringRun.inputs).toEqual(original.inputs);
    expect(duringRun.mcpServers.github).toEqual(original.mcpServers.github);
    expect(duringRun.mcpServers['video-edit']).toEqual({
      url: 'http://127.0.0.1:5126/mcp/bridge/inproc/video-edit',
      headers: { Authorization: 'Bearer bridge-token' },
    });

    await restore();

    expect(await readFile(mcpPath, 'utf8')).toBe(
      `${JSON.stringify(original, null, 2)}\n`,
    );
  });

  it('removes the temporary config when there was no previous file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'cursor-mcp-'));
    tempDirs.push(cwd);
    const mcpPath = join(cwd, '.cursor', 'mcp.json');

    const restore = await writeCursorWorkspaceMcpConfig(cwd, bridgeFixture());
    expect(JSON.parse(await readFile(mcpPath, 'utf8'))).toMatchObject({
      mcpServers: {
        'video-edit': {
          url: 'http://127.0.0.1:5126/mcp/bridge/inproc/video-edit',
        },
      },
    });

    await restore();

    await expect(readFile(mcpPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

function bridgeFixture(): SubprocessMcpConfig {
  return {
    codexConfig: {
      mcp_servers: {
        'video-edit': {
          url: 'http://127.0.0.1:5126/mcp/bridge/inproc/video-edit',
          bearer_token_env_var: 'NEUMA_BRIDGE_TOKEN_VIDEO_EDIT',
          default_tools_approval_mode: 'never',
        },
      },
    },
    env: { NEUMA_BRIDGE_TOKEN_VIDEO_EDIT: 'bridge-token' },
    denialHints: [],
    revoke: () => {},
  };
}
