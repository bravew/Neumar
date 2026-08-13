import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  listVideoProjectStorageTree,
  parseVideoStorageRoot,
} from '@/shared/video/storage-tree';

describe('video project storage tree', () => {
  let workspaceRoot: string;
  let previousWorkDir: string | undefined;

  beforeEach(async () => {
    previousWorkDir = process.env.NEUMA_VIDEO_WORKDIR;
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-video-'));
    process.env.NEUMA_VIDEO_WORKDIR = workspaceRoot;
  });

  afterEach(async () => {
    if (previousWorkDir === undefined) {
      delete process.env.NEUMA_VIDEO_WORKDIR;
    } else {
      process.env.NEUMA_VIDEO_WORKDIR = previousWorkDir;
    }
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('lists project files by relative path with directories first', async () => {
    const projectDir = path.join(workspaceRoot, 'videos', 'project-1');
    await fs.mkdir(path.join(projectDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'project.json'), '{}\n');
    await fs.writeFile(path.join(projectDir, 'assets', 'clip.mp4'), 'video');
    await fs.writeFile(path.join(projectDir, 'assets', 'audio.wav'), 'audio');

    const rootTree = await listVideoProjectStorageTree('project-1');
    const assetsTree = await listVideoProjectStorageTree('project-1', {
      path: 'assets',
    });

    expect(rootTree).toMatchObject({
      projectId: 'project-1',
      root: 'project',
      path: '',
      entries: [
        { name: 'assets', kind: 'directory', path: 'assets' },
        { name: 'project.json', kind: 'file', path: 'project.json' },
      ],
    });
    expect(assetsTree.entries.map((entry) => entry.path)).toEqual([
      'assets/audio.wav',
      'assets/clip.mp4',
    ]);
    expect(assetsTree.totalSizeBytes).toBe(10);
  });

  it('lists cache files separately and treats a missing cache as empty', async () => {
    const emptyCacheTree = await listVideoProjectStorageTree('project-1', {
      root: 'cache',
    });

    expect(emptyCacheTree).toMatchObject({
      root: 'cache',
      path: '',
      entries: [],
      totalSizeBytes: 0,
    });

    const cacheDir = path.join(
      workspaceRoot,
      '.cache',
      'videos',
      'project-1',
      'scenes',
    );
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, 'scene-1.mp4'), 'render');

    const cacheTree = await listVideoProjectStorageTree('project-1', {
      root: 'cache',
      path: 'scenes',
    });

    expect(cacheTree.entries).toMatchObject([
      {
        name: 'scene-1.mp4',
        kind: 'file',
        path: 'scenes/scene-1.mp4',
      },
    ]);
  });

  it('rejects traversal and invalid roots', async () => {
    await fs.mkdir(path.join(workspaceRoot, 'videos', 'project-1'), {
      recursive: true,
    });

    await expect(
      listVideoProjectStorageTree('project-1', { path: '..' }),
    ).rejects.toThrow('outside');
    expect(() => parseVideoStorageRoot('workspace')).toThrow(
      'Invalid video storage root',
    );
  });
});
