import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import { closeDatabase } from '@/shared/db';
import { createProject, writeProject } from '@/shared/video/store';

describe('video output routes', () => {
  let firstWorkDir: string;
  let secondWorkDir: string;

  beforeEach(async () => {
    closeDatabase();
    firstWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-output-a-'));
    secondWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-output-b-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', firstWorkDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(firstWorkDir, { recursive: true, force: true });
    await fs.rm(secondWorkDir, { recursive: true, force: true });
  });

  it('resolves output and poster files from the project workspace after the current workspace changes', async () => {
    const project = await createProject({
      name: 'Output route root',
      template: 'slideshow',
    });
    const outputPath = `videos/${project.id}/output/out.mp4`;
    const posterPath = `videos/${project.id}/output/out.poster.jpg`;
    await fs.mkdir(path.join(firstWorkDir, `videos/${project.id}/output`), {
      recursive: true,
    });
    await fs.writeFile(path.join(firstWorkDir, outputPath), 'mp4 bytes');
    await fs.writeFile(path.join(firstWorkDir, posterPath), 'poster bytes');
    await writeProject({
      ...project,
      render: {
        status: 'done',
        outputPath,
        progress: 100,
        updatedAt: '2026-06-15T02:23:13.707Z',
      },
      outputs: [
        {
          aspectRatio: '16:9',
          path: outputPath,
          posterPath,
          durationSec: 1,
          fileSize: 9,
          codec: 'h264',
        },
      ],
    });

    vi.stubEnv('NEUMA_VIDEO_WORKDIR', secondWorkDir);

    const output = await videoRoutes.request(
      `/projects/${project.id}/output?aspectRatio=16%3A9`,
    );
    expect(output.status).toBe(307);
    expect(decodeURIComponent(output.headers.get('location') ?? '')).toContain(
      path.join(firstWorkDir, outputPath),
    );

    const poster = await videoRoutes.request(
      `/projects/${project.id}/poster?aspectRatio=16%3A9`,
    );
    expect(poster.status).toBe(307);
    expect(decodeURIComponent(poster.headers.get('location') ?? '')).toContain(
      path.join(firstWorkDir, posterPath),
    );
  });
});
