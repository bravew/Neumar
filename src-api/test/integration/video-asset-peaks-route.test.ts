import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/video/asset-thumbs', () => ({
  getPeaks: vi.fn(async () => ({
    bins: 16,
    durationMs: 3000,
    peaks: [],
  })),
}));

import { videoRoutes } from '@/app/api/video';

import { closeDatabase } from '@/shared/db';
import { getPeaks } from '@/shared/video/asset-thumbs';
import { writeProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

const projectId = 'project-1';
const assetPath = `videos/${projectId}/assets/audio.wav`;

let workDir: string;

beforeEach(async () => {
  closeDatabase();
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-peaks-route-'));
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  vi.mocked(getPeaks).mockClear();
});

afterEach(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('video asset peaks route', () => {
  it('uses the remaining asset duration when a range start omits duration', async () => {
    await writeProject(projectFixture());
    await fs.mkdir(path.dirname(path.join(workDir, assetPath)), {
      recursive: true,
    });
    await fs.writeFile(path.join(workDir, assetPath), 'audio bytes');

    const response = await videoRoutes.request(
      `/projects/${projectId}/assets/audio-1/peaks?bins=16&startMs=2000`,
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(getPeaks)).toHaveBeenCalledWith(
      path.join(workDir, assetPath),
      16,
      workDir,
      {
        startMs: 2000,
        durationMs: 3000,
        reverse: false,
      },
      // Waveform caches belong to the project, not to the master's directory.
      expect.objectContaining({
        cacheDir: expect.stringContaining(path.join('derivatives', 'audio-1')),
      }),
    );
  });
});

function projectFixture(): VideoProject {
  return {
    id: projectId,
    name: 'Peaks route',
    template: 'podcast',
    prompt: '',
    assets: [
      {
        id: 'audio-1',
        kind: 'audio',
        source: 'user',
        path: assetPath,
        metadata: {
          durationMs: 5000,
          sampleRate: 48000,
          channels: 2,
        },
      },
    ],
    render: { status: 'idle' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  };
}
