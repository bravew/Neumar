import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { patchCaption } from '@/shared/video/captions';
import { writeProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

let workDir: string;

describe('video captions', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-captions-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('snaps caption timing patches to word boundaries', async () => {
    await writeProject(projectFixture());

    const { subtitle } = await patchCaption('project-1', 'caption-1', {
      startMs: 140,
      endMs: 930,
    });

    expect(subtitle).toMatchObject({
      id: 'caption-1',
      startMs: 100,
      endMs: 1000,
      manuallyEdited: true,
    });
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Caption snapping',
    template: 'explainer',
    prompt: 'Caption snapping',
    assets: [],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    storyboard: undefined,
    scenes: [
      {
        id: 'scene-1',
        durationMs: 2000,
        clips: [],
        subtitles: [
          {
            id: 'caption-1',
            text: 'Hello world',
            startMs: 0,
            endMs: 1200,
            words: [
              { text: 'Hello', startMs: 100, endMs: 500 },
              { text: 'world', startMs: 600, endMs: 1000 },
            ],
          },
        ],
      },
    ],
    render: { status: 'idle', updatedAt: '2026-05-20T00:00:00.000Z' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  };
}
