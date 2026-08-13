import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import {
  createProject,
  getProject,
  getVideoSourceAnalysisCacheDirForRoot,
} from '@/shared/video/store';

describe('video project storage roots', () => {
  let firstWorkDir: string;
  let secondWorkDir: string;

  beforeEach(async () => {
    closeDatabase();
    firstWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-root-a-'));
    secondWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-root-b-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', firstWorkDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(firstWorkDir, { recursive: true, force: true });
    await fs.rm(secondWorkDir, { recursive: true, force: true });
  });

  it('loads a project from its creation workspace after the global workspace changes', async () => {
    const project = await createProject({
      name: 'Pinned workspace',
      template: 'slideshow',
    });

    vi.stubEnv('NEUMA_VIDEO_WORKDIR', secondWorkDir);

    await expect(getProject(project.id)).resolves.toMatchObject({
      id: project.id,
      name: 'Pinned workspace',
    });
  });

  it('resolves source analysis cache paths by project and content hash', () => {
    expect(
      getVideoSourceAnalysisCacheDirForRoot(
        firstWorkDir,
        'project-1',
        'abc123',
      ),
    ).toBe(
      path.join(
        firstWorkDir,
        '.cache',
        'videos',
        'project-1',
        'analysis',
        'abc123',
      ),
    );
    expect(() =>
      getVideoSourceAnalysisCacheDirForRoot(
        firstWorkDir,
        'project-1',
        '../bad',
      ),
    ).toThrow('Invalid video cache contentHash');
  });
});
