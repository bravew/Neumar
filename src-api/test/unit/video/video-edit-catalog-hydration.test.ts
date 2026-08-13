import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AssetRegistry,
  __resetAssetMaterializerForTests,
} from '@/shared/assets';
import { closeDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import { createVideoEditTools } from '@/shared/mcp/video-edit-server';
import { attachCatalogAssetToProject } from '@/shared/video/catalog-assets';
import { createProject, getProject, writeProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

describe('video-edit MCP catalog hydration', () => {
  let homeDir: string;
  let workDir: string;
  let registry: AssetRegistry;
  let assetIds: string[];

  beforeEach(async () => {
    closeDatabase();
    __resetAssetMaterializerForTests();
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-edit-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-edit-work-'));
    vi.stubEnv('HOME', homeDir);
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setSetting('workDir', workDir);
    registry = new AssetRegistry();
    assetIds = [];
  });

  afterEach(async () => {
    for (const assetId of assetIds) {
      try {
        registry.softDelete(assetId);
      } catch {
        // Best-effort cleanup; temp dirs are removed below.
      }
    }
    __resetAssetMaterializerForTests();
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('hydrates a referenced project asset before attaching it to a scene', async () => {
    const project = await createSceneProject();
    const sharp = (await import('sharp')).default;
    const sourceBytes = await sharp({
      create: {
        width: 32,
        height: 18,
        channels: 3,
        background: '#16a34a',
      },
    })
      .png()
      .toBuffer();
    await fs.mkdir(path.join(workDir, 'library'), { recursive: true });
    await fs.writeFile(path.join(workDir, 'library', 'scene.png'), sourceBytes);
    const ingested = await registry.ingest({
      source: 'local_fs',
      storagePath: 'library/scene.png',
      clientRequestId: randomUUID(),
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Scene Image',
      },
    });
    assetIds.push(ingested.asset.id);
    const referenced = await attachCatalogAssetToProject(
      project.id,
      ingested.asset.id,
      { role: 'b-roll', hydrate: 'none' },
    );

    const tool = findTool(project.id, 'video_attach_asset');
    const result = await tool.handler(
      { assetId: referenced.asset.id, sceneId: 'scene-1' },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload.asset).toMatchObject({
      id: referenced.asset.id,
      materializationState: 'ready',
      renderable: true,
    });
    const stored = await getProject(project.id);
    const asset = stored.assets.find((item) => item.id === referenced.asset.id);
    expect(asset).toMatchObject({
      id: referenced.asset.id,
      materializationState: 'ready',
      provenance: { catalogAssetId: ingested.asset.id },
    });
    expect(asset?.path).not.toBe(`catalog:${ingested.asset.id}`);
    expect(stored.storyboard?.scenes[0]?.assetPlan).toEqual({
      kind: 'existing',
      assetId: referenced.asset.id,
    });
    expect(stored.timeline?.tracks[0]?.clips[0]?.sourceRef).toEqual({
      kind: 'asset',
      assetId: referenced.asset.id,
    });
    await expect(fs.readFile(path.join(workDir, asset!.path))).resolves.toEqual(
      sourceBytes,
    );
  });

  it('hydrates a referenced project asset without placing it on a scene', async () => {
    const project = await createSceneProject();
    const sharp = (await import('sharp')).default;
    const sourceBytes = await sharp({
      create: {
        width: 32,
        height: 18,
        channels: 3,
        background: '#f97316',
      },
    })
      .png()
      .toBuffer();
    await fs.mkdir(path.join(workDir, 'library'), { recursive: true });
    await fs.writeFile(
      path.join(workDir, 'library', 'crop-source.png'),
      sourceBytes,
    );
    const ingested = await registry.ingest({
      source: 'local_fs',
      storagePath: 'library/crop-source.png',
      clientRequestId: randomUUID(),
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Crop Source Image',
      },
    });
    assetIds.push(ingested.asset.id);
    const referenced = await attachCatalogAssetToProject(
      project.id,
      ingested.asset.id,
      { role: 'b-roll', hydrate: 'none' },
    );

    const tool = findTool(project.id, 'video_attach_asset');
    const result = await tool.handler({ assetId: referenced.asset.id }, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload.asset).toMatchObject({
      id: referenced.asset.id,
      materializationState: 'ready',
      renderable: true,
    });
    expect(payload.asset.path).toEqual(expect.stringMatching(/\.png$/));
    expect(payload.asset.path).not.toBe(`catalog:${ingested.asset.id}`);
    expect(payload.asset.filePath).toBe(path.join(workDir, payload.asset.path));

    const stored = await getProject(project.id);
    expect(stored.storyboard?.scenes[0]?.assetPlan).toEqual({
      kind: 'ai-image',
      prompt: 'placeholder',
    });
    const asset = stored.assets.find((item) => item.id === referenced.asset.id);
    expect(asset?.path).toBe(payload.asset.path);
    await expect(fs.readFile(payload.asset.filePath)).resolves.toEqual(
      sourceBytes,
    );
  });

  it('uses and hydrates selected source video when adding a footage scene', async () => {
    const project = await createSceneProject();
    const sourceBytes = Buffer.from(`video-bytes-${randomUUID()}`);
    await fs.mkdir(path.join(workDir, 'library'), { recursive: true });
    await fs.writeFile(
      path.join(workDir, 'library', 'recording.mp4'),
      sourceBytes,
    );
    const ingested = await registry.ingest({
      source: 'local_fs',
      storagePath: 'library/recording.mp4',
      clientRequestId: randomUUID(),
      hint: {
        kind: 'video',
        mime: 'video/mp4',
        width: 1920,
        height: 1080,
        durationMs: 90_000,
        title: 'Weekly Business Review Recording',
      },
    });
    assetIds.push(ingested.asset.id);
    const referenced = await attachCatalogAssetToProject(
      project.id,
      ingested.asset.id,
      { role: 'b-roll', hydrate: 'none' },
    );

    const tool = findTool(project.id, 'video_add_scene');
    const result = await tool.handler(
      {
        intent:
          'Key metrics segment sourced from the WBR recording. Pull clips from the recording where the presenter walks through dashboards.',
        durationMs: 30_000,
        captionText: 'Key Metrics',
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      projectId: project.id,
      tool: 'addScene',
    });
    const stored = await getProject(project.id);
    const added = stored.storyboard?.scenes.at(-1);
    expect(added?.assetPlan).toEqual({
      kind: 'existing',
      assetId: referenced.asset.id,
      trimMs: [0, 30_000],
    });
    const asset = stored.assets.find((item) => item.id === referenced.asset.id);
    expect(asset).toMatchObject({
      id: referenced.asset.id,
      materializationState: 'ready',
      provenance: { catalogAssetId: ingested.asset.id },
    });
    expect(asset?.path).not.toBe(`catalog:${ingested.asset.id}`);
    expect(stored.timeline?.tracks[0]?.clips.at(-1)).toMatchObject({
      kind: 'video',
      sourceRef: { kind: 'asset', assetId: referenced.asset.id },
      trimStartMs: 0,
      trimEndMs: 30_000,
    });
    await expect(fs.readFile(path.join(workDir, asset!.path))).resolves.toEqual(
      sourceBytes,
    );
  });

  it('marks referenced assets as non-renderable in list output', async () => {
    const project = await createSceneProject();
    const sharp = (await import('sharp')).default;
    const sourceBytes = await sharp({
      create: {
        width: 32,
        height: 18,
        channels: 3,
        background: '#9333ea',
      },
    })
      .png()
      .toBuffer();
    await fs.mkdir(path.join(workDir, 'library'), { recursive: true });
    await fs.writeFile(
      path.join(workDir, 'library', 'referenced.png'),
      sourceBytes,
    );
    const ingested = await registry.ingest({
      source: 'local_fs',
      storagePath: 'library/referenced.png',
      clientRequestId: randomUUID(),
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Referenced Image',
      },
    });
    assetIds.push(ingested.asset.id);
    const referenced = await attachCatalogAssetToProject(
      project.id,
      ingested.asset.id,
      { role: 'b-roll', hydrate: 'none' },
    );

    const tool = findTool(project.id, 'video_list_assets');
    const result = await tool.handler({ kind: 'image' }, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload.assets).toEqual([
      expect.objectContaining({
        id: referenced.asset.id,
        materializationState: 'referenced',
        renderable: false,
        catalogAssetId: ingested.asset.id,
        sourceDisplayName: 'Referenced Image',
      }),
    ]);
  });
});

async function createSceneProject(): Promise<VideoProject> {
  const project = await createProject({
    name: 'Catalog scene attach',
    template: 'slideshow',
  });
  const now = new Date().toISOString();
  const next: VideoProject = {
    ...project,
    storyboard: {
      status: 'draft',
      intent: 'Use selected media',
      totalDurationMs: 4000,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 4000,
          intent: 'Selected media',
          caption: { text: 'Selected media' },
          assetPlan: { kind: 'ai-image', prompt: 'placeholder' },
        },
      ],
    },
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 4000,
      fps: 24,
      tracks: [],
    },
    scenes: [{ id: 'scene-1', durationMs: 4000, clips: [] }],
    updatedAt: now,
  };
  await writeProject(next);
  return next;
}

function findTool(projectId: string, name: string) {
  const found = createVideoEditTools({ projectId }).find(
    (candidate) => candidate.name === name,
  );
  if (!found) throw new Error(`Tool ${name} not found`);
  return found;
}
