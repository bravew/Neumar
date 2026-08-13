import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSetting } from '@/shared/db/operations';
import {
  addLinkedSource,
  attachLinkedAsset,
  listLinkedAssets,
  removeLinkedSource,
  runLinkedSourceSyncJob,
} from '@/shared/video/linked-sources';
import { createLocalFolderGrant } from '@/shared/video/linked-sources/local-grants';
import { createProject } from '@/shared/video/store';
import type { VideoJob } from '@/shared/video/types';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('video linked sources', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-linked-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setSetting('workDir', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('requires a local folder grant before adding a local source', async () => {
    const project = await createProject({
      name: 'Linked folders',
      template: 'slideshow',
    });
    const mediaDir = path.join(workDir, 'media');
    await fs.mkdir(mediaDir, { recursive: true });

    await expect(
      addLinkedSource(project.id, {
        provider: 'local-fs',
        rootPath: mediaDir,
      }),
    ).rejects.toThrow(/grant token/i);
  });

  it('indexes local image metadata and attaches on demand', async () => {
    const project = await createProject({
      name: 'Local source',
      template: 'slideshow',
    });
    const mediaDir = path.join(workDir, 'media');
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(path.join(mediaDir, 'photo.png'), PNG_BYTES);
    await fs.writeFile(
      path.join(mediaDir, 'clip.mp4'),
      Buffer.from('fake mp4'),
    );

    const grant = await createLocalFolderGrant(mediaDir);
    const added = await addLinkedSource(project.id, {
      provider: 'local-fs',
      rootPath: grant.rootPath,
      localGrantToken: grant.token,
      filters: { types: ['image'] },
    });

    await runLinkedSourceSyncJob(jobFor(project.id, added.source.id));

    const assets = listLinkedAssets(project.id, { sourceId: added.source.id });
    expect(assets.map((asset) => asset.name)).toEqual(['photo.png']);
    expect(assets[0]?.kind).toBe('image');

    const attached = await attachLinkedAsset(project.id, assets[0]!.id);
    expect(attached.asset.kind).toBe('image');
    expect(attached.asset.source).toBe('downloaded');
    expect(attached.project.assets).toHaveLength(1);
  });

  it('attaching the same linked asset twice does not duplicate it', async () => {
    const project = await createProject({
      name: 'Dedup source',
      template: 'slideshow',
    });
    const mediaDir = path.join(workDir, 'dedup');
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(path.join(mediaDir, 'photo.png'), PNG_BYTES);

    const grant = await createLocalFolderGrant(mediaDir);
    const added = await addLinkedSource(project.id, {
      provider: 'local-fs',
      rootPath: grant.rootPath,
      localGrantToken: grant.token,
      filters: { types: ['image'] },
    });
    await runLinkedSourceSyncJob(jobFor(project.id, added.source.id));
    const [asset] = listLinkedAssets(project.id, { sourceId: added.source.id });

    const first = await attachLinkedAsset(project.id, asset!.id);
    const second = await attachLinkedAsset(project.id, asset!.id);

    expect(second.project.assets).toHaveLength(1);
    // The second attach reuses the existing project asset rather than adding one.
    expect(second.asset.id).toBe(first.asset.id);
  });

  it('marks sync partial when the file budget is reached', async () => {
    const project = await createProject({
      name: 'Budgeted source',
      template: 'slideshow',
    });
    const mediaDir = path.join(workDir, 'budget');
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(path.join(mediaDir, 'one.png'), PNG_BYTES);
    await fs.writeFile(path.join(mediaDir, 'two.png'), PNG_BYTES);

    const grant = await createLocalFolderGrant(mediaDir);
    const added = await addLinkedSource(project.id, {
      provider: 'local-fs',
      rootPath: grant.rootPath,
      localGrantToken: grant.token,
      filters: { types: ['image'] },
      budget: { maxFiles: 1 },
    });

    const result = await runLinkedSourceSyncJob(
      jobFor(project.id, added.source.id),
    );

    expect(result.state).toBe('partial');
    expect(result.fileCount).toBe(1);
  });

  it('purges linked asset rows when removing a source', async () => {
    const project = await createProject({
      name: 'Remove source',
      template: 'slideshow',
    });
    const mediaDir = path.join(workDir, 'remove');
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(path.join(mediaDir, 'photo.png'), PNG_BYTES);
    const grant = await createLocalFolderGrant(mediaDir);
    const added = await addLinkedSource(project.id, {
      provider: 'local-fs',
      rootPath: grant.rootPath,
      localGrantToken: grant.token,
      filters: { types: ['image'] },
    });
    await runLinkedSourceSyncJob(jobFor(project.id, added.source.id));

    expect(
      listLinkedAssets(project.id, { sourceId: added.source.id }),
    ).toHaveLength(1);

    await removeLinkedSource(project.id, added.source.id);

    expect(
      listLinkedAssets(project.id, { sourceId: added.source.id }),
    ).toHaveLength(0);
  });
});

function jobFor(projectId: string, sourceId: string): VideoJob {
  return {
    id: `job-${sourceId}`,
    projectId,
    kind: 'linked-source.sync',
    status: 'queued',
    payload: { sourceId },
    caller: 'in-app',
  };
}
