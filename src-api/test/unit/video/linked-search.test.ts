import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import {
  addLinkedSource,
  listFavoriteLinkedAssets,
  listLinkedFolderChildren,
  listRecentLinkedAssets,
  markLinkedAssetOpened,
  searchLinkedAssets,
  setLinkedAssetFavorite,
} from '@/shared/video/linked-sources';
import { createLocalFolderGrant } from '@/shared/video/linked-sources/local-grants';
import {
  createProject,
  generateStoryboardDraft,
  getProject,
  writeProject,
} from '@/shared/video/store';

let workDir: string;
let homeDir: string;

describe('video linked asset search', () => {
  beforeEach(async () => {
    closeDatabase();
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-linked-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-linked-search-'));
    process.env.HOME = homeDir;
    process.env.NEUMA_VIDEO_WORKDIR = workDir;
    setSetting('workDir', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    delete process.env.NEUMA_VIDEO_WORKDIR;
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('falls back to filename and metadata search when sqlite-vec is unavailable', async () => {
    const { projectId, sourceId } = await projectWithSource('Metadata source');
    insertAsset({
      projectId,
      sourceId,
      id: 'sunset-photo',
      name: 'sunset-over-water.jpg',
      kind: 'image',
      description: 'Warm orange light over a lake at dusk.',
    });
    insertAsset({
      projectId,
      sourceId,
      id: 'city-video',
      name: 'city-broll.mp4',
      kind: 'video',
      description: 'Downtown traffic and tall buildings.',
    });

    const result = await searchLinkedAssets(projectId, {
      query: 'sunset water',
      limit: 5,
    });

    expect(result.capability.degraded).toBe(true);
    expect(result.results[0]?.asset.id).toBe('sunset-photo');
    expect(result.results[0]?.matchedOn).toBe('metadata');
  });

  it('keeps exact filename matches visible even when metadata differs', async () => {
    const { projectId, sourceId } = await projectWithSource('Filename source');
    insertAsset({
      projectId,
      sourceId,
      id: 'pitch-deck',
      name: 'launch-product-broll.mp4',
      kind: 'video',
      description: 'Abstract office footage.',
    });
    insertAsset({
      projectId,
      sourceId,
      id: 'other',
      name: 'office.mp4',
      kind: 'video',
      description: 'Product launch crowd and stage presentation.',
    });

    const result = await searchLinkedAssets(projectId, {
      query: 'launch-product-broll',
      limit: 5,
    });

    expect(result.results[0]?.asset.id).toBe('pitch-deck');
    expect(result.results[0]?.matchedOn).toBe('filename');
  });

  it('applies kind, source, duration, and aspect filters after retrieval', async () => {
    const first = await projectWithSource('Primary source');
    const second = await addSource(first.projectId, 'Secondary source');
    insertAsset({
      projectId: first.projectId,
      sourceId: first.sourceId,
      id: 'vertical-video',
      name: 'stadium-vertical.mp4',
      kind: 'video',
      description: 'Soccer stadium crowd.',
      durationMs: 9000,
      width: 1080,
      height: 1920,
    });
    insertAsset({
      projectId: first.projectId,
      sourceId: second.sourceId,
      id: 'wide-video',
      name: 'stadium-wide.mp4',
      kind: 'video',
      description: 'Soccer stadium wide shot.',
      durationMs: 9000,
      width: 1920,
      height: 1080,
    });
    insertAsset({
      projectId: first.projectId,
      sourceId: first.sourceId,
      id: 'short-image',
      name: 'stadium.jpg',
      kind: 'image',
      description: 'Soccer stadium still.',
      width: 1920,
      height: 1080,
    });

    const result = await searchLinkedAssets(first.projectId, {
      query: 'stadium',
      kind: 'video',
      sourceIds: [first.sourceId],
      durationMs: { min: 8000 },
      aspectRatio: '9:16',
      limit: 5,
    });

    expect(result.results.map((hit) => hit.asset.id)).toEqual([
      'vertical-video',
    ]);
  });

  it('returns recent linked assets for an empty query', async () => {
    const { projectId, sourceId } = await projectWithSource('Recent source');
    insertAsset({
      projectId,
      sourceId,
      id: 'older',
      name: 'older.jpg',
      kind: 'image',
      indexedAt: '2026-01-01T00:00:00.000Z',
    });
    insertAsset({
      projectId,
      sourceId,
      id: 'newer',
      name: 'newer.jpg',
      kind: 'image',
      indexedAt: '2026-01-02T00:00:00.000Z',
    });

    const result = await searchLinkedAssets(projectId, { query: '', limit: 2 });

    expect(result.results.map((hit) => hit.asset.id)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('persists linked asset favorites and opened recents', async () => {
    const { projectId, sourceId } = await projectWithSource('Rail source');
    insertAsset({
      projectId,
      sourceId,
      id: 'favorite-clip',
      name: 'favorite.mp4',
      kind: 'video',
    });

    setLinkedAssetFavorite(projectId, 'favorite-clip', true);
    markLinkedAssetOpened(projectId, 'favorite-clip');

    expect(
      listFavoriteLinkedAssets(projectId).map((asset) => asset.id),
    ).toEqual(['favorite-clip']);
    expect(listRecentLinkedAssets(projectId).map((asset) => asset.id)).toEqual([
      'favorite-clip',
    ]);
  });

  it('filters linked folder children by media kind and decorates indexed assets', async () => {
    const { projectId, sourceId, root } = await addSource(
      (
        await createProject({
          name: 'Folder tree',
          template: 'slideshow',
          prompt: 'Folder tree',
        })
      ).id,
      'Folder tree',
    );
    const clipPath = path.join(root, 'clip.mp4');
    const notePath = path.join(root, 'notes.txt');
    await fs.writeFile(clipPath, Buffer.from('video'));
    await fs.writeFile(notePath, Buffer.from('notes'));
    insertAsset({
      projectId,
      sourceId,
      id: 'clip-asset',
      externalId: await fs.realpath(clipPath),
      name: 'clip.mp4',
      kind: 'video',
    });

    const result = await listLinkedFolderChildren(projectId, {
      sourceId,
      kinds: ['video'],
    });

    expect(result.entries).toEqual([
      expect.objectContaining({
        name: 'clip.mp4',
        kind: 'video',
        assetId: 'clip-asset',
      }),
    ]);
  });

  it('routes storyboard cutaways to linked b-roll sources when available', async () => {
    const { projectId, sourceId } = await projectWithSource('Brand footage');
    const project = await getProject(projectId);
    await writeProject({
      ...project,
      prompt: 'Opening product shot',
      linkedSources: (project.linkedSources ?? []).map((source) =>
        source.id === sourceId
          ? {
              ...source,
              role: 'b-roll',
              index: { ...source.index, state: 'fresh', fileCount: 51 },
            }
          : source,
      ),
    });

    const result = await generateStoryboardDraft(projectId);

    expect(result.storyboard.scenes[0]?.assetPlan).toMatchObject({
      kind: 'broll-search',
      provider: 'linked',
      sourceIds: [sourceId],
    });
  });
});

async function projectWithSource(displayName: string) {
  const project = await createProject({
    name: displayName,
    template: 'slideshow',
    prompt: displayName,
  });
  return {
    projectId: project.id,
    ...(await addSource(project.id, displayName)),
  };
}

async function addSource(projectId: string, displayName: string) {
  const root = path.join(workDir, projectId, displayName);
  await fs.mkdir(root, { recursive: true });
  const grant = await createLocalFolderGrant(root);
  const added = await addLinkedSource(projectId, {
    provider: 'local-fs',
    rootPath: grant.rootPath,
    localGrantToken: grant.token,
    displayName,
    filters: { types: ['image', 'video'] },
  });
  return { projectId, sourceId: added.source.id, root };
}

function insertAsset(input: {
  projectId: string;
  sourceId: string;
  id: string;
  externalId?: string;
  name: string;
  kind: 'image' | 'video' | 'audio';
  description?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  indexedAt?: string;
}) {
  getDatabase()
    .prepare(
      `INSERT INTO linked_assets
        (id, project_id, source_id, external_id, name, mime, kind, size_bytes,
         duration_ms, width, height, thumbnail_cache_path, description,
         caption_provider, caption_model, embedding_model, embedding_dim,
         embedded_at, modified_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.projectId,
      input.sourceId,
      input.externalId ?? input.id,
      input.name,
      input.kind === 'image' ? 'image/jpeg' : 'video/mp4',
      input.kind,
      1024,
      input.durationMs ?? null,
      input.width ?? null,
      input.height ?? null,
      null,
      input.description ?? '',
      'local-filename',
      'filename-v1',
      null,
      null,
      null,
      null,
      input.indexedAt ?? new Date().toISOString(),
    );
}
