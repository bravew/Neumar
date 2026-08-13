import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSetting } from '@/shared/db/operations';
import { createProject, writeProject } from '@/shared/video/store';
import { synthesizeStoryboardNarration } from '@/shared/video/tts';
import type { Storyboard, VideoProject } from '@/shared/video/types';

let workDir: string;

describe('storyboard narration tracks', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-narration-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setSetting('workDir', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('materializes a project-level narration asset with stable segments', async () => {
    const project = await writeNarrationProject();

    const result = await synthesizeStoryboardNarration(project.id, {
      segments: [
        {
          id: 'segment-1',
          sceneId: 'scene-1',
          text: 'Opening voiceover',
          voiceId: 'voice-a',
        },
        {
          sceneId: 'scene-2',
          text: 'Second voiceover',
          voiceId: 'voice-a',
        },
      ],
      voiceId: 'voice-a',
      provider: 'kokoro',
    });

    expect(result.asset.kind).toBe('audio');
    expect(result.asset.source).toBe('tts');
    expect(result.costCents).toBe(0);
    expect(result.segments[0]?.id).toBe('segment-1');
    expect(result.segments[1]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(result.project.storyboard?.narration?.assetId).toBe(result.asset.id);
    expect(
      result.project.assets.some((asset) => asset.id === result.asset.id),
    ).toBe(true);
  });
});

async function writeNarrationProject(): Promise<VideoProject> {
  const project = await createProject({
    name: 'Narration track',
    template: 'slideshow',
  });
  const storyboard: Storyboard = {
    status: 'approved',
    intent: 'test',
    totalDurationMs: 6000,
    costEstimateUsd: { low: 0, high: 0 },
    scenes: [
      {
        id: 'scene-1',
        durationMs: 3000,
        intent: 'Opening',
        caption: { text: 'Opening caption' },
        assetPlan: { kind: 'ai-image', prompt: 'Opening image' },
      },
      {
        id: 'scene-2',
        durationMs: 3000,
        intent: 'Second',
        caption: { text: 'Second caption' },
        assetPlan: { kind: 'ai-image', prompt: 'Second image' },
      },
    ],
  };
  const next: VideoProject = {
    ...project,
    storyboard,
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return next;
}
