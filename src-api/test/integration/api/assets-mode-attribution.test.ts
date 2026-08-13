import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetRegistry } from '@/shared/assets';
import { attachCatalogAssetToDesign } from '@/shared/services/design-mode/catalog-assets';
import { writeProjectTextFile } from '@/shared/services/design-mode/fs';
import { createDesignProject } from '@/shared/services/design-mode/projects';
import { attachCatalogAssetToProject } from '@/shared/video/catalog-assets';
import { buildRenderPlan } from '@/shared/video/render-plan';
import { createProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe('catalog asset attribution across modes', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-assets-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-assets-work-'));
    vi.stubEnv('HOME', tempHome);
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    const { saveSetting } = await import('@/shared/db/operations');
    saveSetting('workDir', workDir);
    saveSetting('assets.catalog_enabled', 'true');
  });

  afterEach(async () => {
    const { __resetAssetMaterializerForTests } =
      await import('@/shared/assets');
    __resetAssetMaterializerForTests();
    const { closeDatabase } = await import('@/shared/db');
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('keeps catalog attribution enforceable in Video and visible in Design exports', async () => {
    await fs.writeFile(
      path.join(workDir, 'campaign-credit.png'),
      Buffer.concat([PNG_HEADER, Buffer.from('credited image')]),
    );
    const registry = new AssetRegistry();
    const { asset } = await registry.ingest({
      source: 'local_fs',
      storagePath: 'campaign-credit.png',
      clientRequestId: 'cross-mode-attribution',
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Campaign credit',
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

    const videoProject = await createProject({
      name: 'Attribution video',
      template: 'custom',
    });
    const videoAttach = await attachCatalogAssetToProject(
      videoProject.id,
      asset.id,
      { role: 'b-roll', hydrate: 'proxy' },
    );
    const videoWithoutCredits = withStoryboard(videoAttach.project, [
      {
        id: 'scene-existing',
        durationMs: 3000,
        intent: 'Use credited image',
        assetPlan: { kind: 'existing', assetId: videoAttach.asset.id },
      },
    ]);
    expect(() => buildRenderPlan(videoWithoutCredits)).toThrow(
      'ATTRIBUTION_MISSING: Campaign credit',
    );

    const videoWithCredits = withStoryboard(videoAttach.project, [
      ...videoWithoutCredits.storyboard!.scenes,
      {
        id: 'scene-credits',
        durationMs: 2000,
        intent: 'Credits: Photo by Ada on Pexels',
        assetPlan: { kind: 'existing', assetId: videoAttach.asset.id },
      },
    ]);
    expect(() => buildRenderPlan(videoWithCredits)).not.toThrow();

    const designProject = await createDesignProject({
      title: 'Attribution design',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      designProject.id,
      'artifacts/index.html',
      '<!doctype html><html><body><main><h1>Campaign</h1></main></body></html>',
    );
    await attachCatalogAssetToDesign(designProject.id, asset.id, {
      clientRequestId: 'cross-mode-attribution-design',
    });
    const { designRoutes } = await import('@/app/api/design');
    const exportResponse = await designRoutes.request(
      `/projects/${designProject.id}/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'html' }),
      },
    );

    expect(exportResponse.status).toBe(201);
    const data = (await exportResponse.json()) as {
      export: { path: string };
    };
    const exported = await fs.readFile(
      path.join(workDir, 'design-projects', designProject.id, data.export.path),
      'utf-8',
    );
    expect(exported).toContain('data-neuma-export-attribution="true"');
    expect(exported).toContain('Photo by Ada on Pexels');
  });
});

function withStoryboard(
  project: VideoProject,
  scenes: NonNullable<VideoProject['storyboard']>['scenes'],
): VideoProject {
  return {
    ...project,
    storyboard: {
      status: 'approved',
      intent: 'Cross-mode attribution',
      totalDurationMs: scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
      costEstimateUsd: { low: 0, high: 0 },
      scenes,
    },
  };
}
