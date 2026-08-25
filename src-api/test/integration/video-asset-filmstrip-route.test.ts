import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/video/asset-thumbs', () => ({
  getFilmstrip: vi.fn(async () => ({
    stripPath: '/tmp/strip.png',
    frameWidth: 160,
    frameHeight: 90,
    frameCount: 4,
  })),
}));

import { videoRoutes } from '@/app/api/video';

import { closeDatabase } from '@/shared/db';
import { getFilmstrip } from '@/shared/video/asset-thumbs';
import { writeProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

const projectId = 'project-1';
const masterPath = `videos/${projectId}/assets/clip.mp4`;
const proxyPath = `videos/${projectId}/derivatives/video-1/proxy.mp4`;

let workDir: string;

async function writeFile(relativePath: string): Promise<void> {
  const absolute = path.join(workDir, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, 'bytes');
}

beforeEach(async () => {
  closeDatabase();
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-filmstrip-route-'));
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  vi.mocked(getFilmstrip).mockClear();
});

afterEach(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('video asset filmstrip route', () => {
  // Sampling N evenly-spaced frames means decoding the whole file. On a 4K HEVC
  // master that measured 22s against 0.76s for its 720p proxy — slow enough
  // that a timeline of clips never finished drawing, and held every connection
  // the browser allows while it tried.
  it('samples frames from the proxy when the asset has one', async () => {
    await writeProject(projectFixture(true));
    await writeFile(masterPath);
    await writeFile(proxyPath);

    const response = await videoRoutes.request(
      `/projects/${projectId}/assets/video-1/filmstrip?count=4`,
    );

    expect(response.status).toBe(307);
    expect(vi.mocked(getFilmstrip)).toHaveBeenCalledWith(
      path.join(workDir, proxyPath),
      4,
      workDir,
      expect.objectContaining({ resolvedPath: path.join(workDir, proxyPath) }),
    );
  });

  it('falls back to the master when no proxy exists', async () => {
    await writeProject(projectFixture(false));
    await writeFile(masterPath);

    const response = await videoRoutes.request(
      `/projects/${projectId}/assets/video-1/filmstrip?count=4`,
    );

    expect(response.status).toBe(307);
    expect(vi.mocked(getFilmstrip)).toHaveBeenCalledWith(
      path.join(workDir, masterPath),
      4,
      workDir,
      expect.anything(),
    );
  });
});

function projectFixture(withProxy: boolean): VideoProject {
  return {
    id: projectId,
    name: 'Filmstrip route',
    template: 'slideshow',
    prompt: '',
    assets: [
      {
        id: 'video-1',
        kind: 'video',
        source: 'user',
        path: masterPath,
        ...(withProxy
          ? {
              proxy: {
                path: proxyPath,
                widthPx: 1280,
                heightPx: 720,
                createdAt: '2026-06-22T00:00:00.000Z',
              },
            }
          : {}),
        metadata: { durationMs: 5000, width: 3840, height: 2160 },
      },
    ],
    render: { status: 'idle' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  } as VideoProject;
}
