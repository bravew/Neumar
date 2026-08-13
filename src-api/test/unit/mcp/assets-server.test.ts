import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetAssetMaterializerForTests,
  __resetAssetRegistryForTests,
} from '@/shared/assets';
import { closeDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import {
  ASSETS_TOOL_NAMES,
  assetAttribution,
  attachAsset,
  ingestAsset,
  materializeStatus,
  recentAssets,
  requestBudgetIncrease,
  searchAssets,
  tagAsset,
} from '@/shared/mcp/assets-server';
import { buildSubprocessMcpConfig } from '@/shared/mcp/subprocess-bridge';
import { createDesignProject } from '@/shared/services/design-mode/projects';

let homeDir: string;
let workDir: string;

describe('assets MCP server', () => {
  beforeEach(async () => {
    __resetAssetMaterializerForTests();
    __resetAssetRegistryForTests();
    closeDatabase();
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-mcp-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-mcp-work-'));
    vi.stubEnv('HOME', homeDir);
    setSetting('workDir', workDir);
    setSetting('assets.catalog_enabled', 'true');
  });

  afterEach(async () => {
    __resetAssetMaterializerForTests();
    __resetAssetRegistryForTests();
    closeDatabase();
    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('exports the safe common tool surface', () => {
    expect(ASSETS_TOOL_NAMES).toEqual([
      'assets_search',
      'assets_get',
      'assets_similar',
      'assets_ingest',
      'assets_attach',
      'assets_tag',
      'assets_sync',
      'assets_recent',
      'assets_materialize_status',
      'assets_attribution',
      'assets_request_budget_increase',
    ]);
  });

  it('ingests, searches, tags, and attaches catalog assets', async () => {
    await fs.writeFile(path.join(workDir, 'sunset.png'), 'fake image bytes');

    const first = await ingestAsset({
      source: 'local_fs',
      path: 'sunset.png',
      client_request_id: 'asset-mcp-sunset',
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Sunset ridge',
        description: 'Warm orange light over the mountain ridge',
        tags: ['sunset'],
      },
    });
    const duplicate = await ingestAsset({
      source: 'local_fs',
      path: 'sunset.png',
      client_request_id: 'asset-mcp-sunset',
    });

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.asset.id).toBe(first.asset.id);

    await tagAsset({ asset_id: first.asset.id, tags: ['hero'] });
    await attachAsset({
      asset_id: first.asset.id,
      scope: 'task',
      scope_id: 'task-1',
      role: 'b-roll',
    });

    const results = await searchAssets({
      tags: ['sunset', 'hero'],
      modalities: ['image'],
      semantic: false,
    });

    expect(results.items).toHaveLength(1);
    expect(results.items[0]).toMatchObject({
      id: first.asset.id,
      title: 'Sunset ridge',
      kind: 'image',
      tags: ['hero', 'sunset'],
      attachments: [
        {
          scope: 'task',
          scope_id: 'task-1',
          role: 'b-roll',
          attached_at: expect.any(Number),
        },
      ],
    });
  });

  it('materializes design project attachments through the MCP attach helper', async () => {
    await fs.writeFile(path.join(workDir, 'reference.png'), 'design bytes');
    const project = await createDesignProject({
      surface: 'document',
      intent: 'landing-page',
      title: 'Design asset bridge',
    });
    const asset = await ingestAsset({
      source: 'local_fs',
      path: 'reference.png',
      client_request_id: 'asset-mcp-design-reference',
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Reference image',
        provenance: {
          licenseInfo: {
            provider: 'Pexels',
            license: 'Pexels',
            requiresAttribution: true,
            attributionText: 'Photo by Ada on Pexels',
          },
        },
      },
    });

    const attached = await attachAsset({
      asset_id: asset.asset.id,
      scope: 'design_project',
      scope_id: project.id,
      role: 'inline',
      client_request_id: 'design-attach-1',
    });

    expect(attached).toMatchObject({
      design_output_id: asset.asset.id,
      materialization_id: expect.any(String),
      urls: {
        raw: `/assets/${asset.asset.id}/raw`,
        preview: `/assets/${asset.asset.id}/preview`,
      },
    });
    await expect(
      fs.readFile(
        path.join(
          workDir,
          'design-projects',
          project.id,
          'assets',
          'imports',
          `${asset.asset.id}.png`,
        ),
        'utf8',
      ),
    ).resolves.toBe('design bytes');

    const retry = await attachAsset({
      asset_id: asset.asset.id,
      scope: 'design_project',
      scope_id: project.id,
      role: 'inline',
      client_request_id: 'design-attach-1',
    });
    expect(retry.materialization_id).toBe(attached.materialization_id);
    await expect(
      fs.readFile(
        path.join(
          workDir,
          'design-projects',
          project.id,
          'assets',
          'imports',
          `${asset.asset.id}.png`,
        ),
        'utf8',
      ),
    ).resolves.toBe('design bytes');

    await expect(
      materializeStatus({
        asset_id: asset.asset.id,
        scope: 'design_project',
        scope_id: project.id,
      }),
    ).resolves.toMatchObject({
      asset_id: asset.asset.id,
      materializations: [
        expect.objectContaining({
          id: attached.materialization_id,
          scope: 'design_project',
          scope_id: project.id,
        }),
      ],
    });
    await expect(
      assetAttribution({
        scope: 'design_project',
        scope_id: project.id,
        format: 'text',
      }),
    ).resolves.toEqual({
      attribution: expect.stringContaining('Photo by Ada on Pexels'),
    });
    await expect(
      recentAssets({
        scope: 'design_project',
        scope_id: project.id,
      }),
    ).resolves.toMatchObject({
      project_recent: [expect.objectContaining({ id: asset.asset.id })],
    });
  });

  it('exposes the assets bridge to subprocess agents only when enabled', async () => {
    setSetting('assets.catalog_enabled', 'false');
    const disabled = await buildSubprocessMcpConfig({
      sessionId: 'session-assets-disabled',
      channelContext: undefined,
      connectors: ['assets'],
    });
    expect(disabled.codexConfig.mcp_servers?.assets).toBeUndefined();

    setSetting('assets.catalog_enabled', 'true');
    const enabled = await buildSubprocessMcpConfig({
      sessionId: 'session-assets-enabled',
      channelContext: undefined,
      connectors: ['assets'],
    });
    expect(enabled.codexConfig.mcp_servers?.assets).toMatchObject({
      url: expect.stringContaining('/mcp/bridge/assets'),
      bearer_token_env_var: 'NEUMA_MCP_BRIDGE_TOKEN_ASSETS',
      default_tools_approval_mode: 'approve',
    });

    enabled.revoke();
  });

  it('requests materialization budget increases through settings', async () => {
    const first = await requestBudgetIncrease({
      budget: 'session',
      requested_bytes: 8 * 1024 * 1024 * 1024,
      reason: 'Need to attach a large Drive video to the active project',
      session_id: 'session-budget-tool',
      scope: 'video_project',
      scope_id: 'video-budget-project',
    });

    expect(first).toMatchObject({
      budget: 'session',
      key: 'assets.materialize_session_budget_bytes',
      previous_bytes: 5 * 1024 * 1024 * 1024,
      new_bytes: 8 * 1024 * 1024 * 1024,
      changed: true,
    });
    expect(first.reason).toContain('Drive video');

    const noOp = await requestBudgetIncrease({
      budget: 'session',
      requested_bytes: 6 * 1024 * 1024 * 1024,
      reason: 'Existing materialization budget is already enough',
      session_id: 'session-budget-tool',
    });
    expect(noOp).toMatchObject({
      previous_bytes: 8 * 1024 * 1024 * 1024,
      new_bytes: 8 * 1024 * 1024 * 1024,
      changed: false,
    });

    await expect(
      requestBudgetIncrease({
        budget: 'session',
        requested_bytes: 9 * 1024 * 1024 * 1024,
        reason: 'Second larger request in the same session should be gated',
        session_id: 'session-budget-tool',
      }),
    ).rejects.toThrow(/already requested/);
  });
});
