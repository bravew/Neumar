import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import { ingestAsset, searchAssets } from '@/shared/mcp/assets-server';

let homeDir: string;
let workDir: string;

describe('assets agent MCP eval', () => {
  beforeEach(async () => {
    closeDatabase();
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-agent-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-agent-work-'));
    vi.stubEnv('HOME', homeDir);
    setSetting('workDir', workDir);
    setSetting('assets.catalog_enabled', 'true');
  });

  afterEach(async () => {
    closeDatabase();
    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('maps "Find me images tagged sunset" to assets_search and round-trips ingest', async () => {
    await fs.writeFile(path.join(workDir, 'lake-sunset.png'), 'png fixture');
    const ingest = await ingestAsset({
      source: 'local_fs',
      path: 'lake-sunset.png',
      client_request_id: 'assets-agent-eval-sunset',
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Lake sunset',
        tags: ['sunset'],
      },
    });

    const prompt = 'Find me images tagged sunset';
    const expectedAgentCall = {
      prompt,
      tool: 'assets_search',
      input: { tags: ['sunset'], modalities: ['image'] as const },
    };
    const result = await searchAssets({
      tags: expectedAgentCall.input.tags,
      modalities: [...expectedAgentCall.input.modalities],
      semantic: false,
    });

    expect(expectedAgentCall).toMatchObject({
      tool: 'assets_search',
      input: { tags: ['sunset'], modalities: ['image'] },
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        id: ingest.asset.id,
        title: 'Lake sunset',
        kind: 'image',
        tags: ['sunset'],
      }),
    ]);
  });
});
