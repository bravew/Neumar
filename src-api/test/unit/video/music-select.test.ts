import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSetting } from '@/shared/db/operations';
import {
  inferMusicSelectionPlan,
  selectBackgroundMusic,
} from '@/shared/video/plugins/atoms/music-select';
import { createProject, getProject, writeProject } from '@/shared/video/store';
import type { MediaItem, Storyboard, VideoProject } from '@/shared/video/types';

describe('video music selection atom', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-music-select-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setSetting('workDir', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('infers mood, tempo, duration, and ducking from storyboard context', () => {
    const plan = inferMusicSelectionPlan({
      name: 'SaaS onboarding',
      prompt: 'Build a concise product tutorial',
      storyboard: storyboardFixture(),
    });

    expect(plan).toEqual({
      prompt: 'Instrumental focused modern synth for SaaS onboarding',
      mood: 'focused modern synth',
      tempoBpm: 104,
      durationMs: 8000,
      ducking: {
        underTrackKind: 'audio-vo',
        attenuationDb: -10,
        fadeMs: 250,
      },
    });
  });

  it('uses an explicit mood to choose tempo before generic project keywords', () => {
    const plan = inferMusicSelectionPlan(
      {
        name: 'SaaS onboarding',
        prompt: 'Build a concise product tutorial',
        storyboard: storyboardFixture(),
      },
      { mood: 'calm ambient bed' },
    );

    expect(plan).toMatchObject({
      mood: 'calm ambient bed',
      tempoBpm: 78,
    });
  });

  it('reuses matching project music and rebuilds the music timeline track', async () => {
    const project = await writeMusicProject([
      musicAsset({
        id: 'music-focused',
        durationMs: 12_000,
        prompt: 'focused modern synth product tutorial music',
      }),
    ]);

    const result = await selectBackgroundMusic(project.id, {
      prompt: 'product tutorial music',
      generateIfMissing: false,
    });

    expect(result).toMatchObject({
      reused: true,
      generated: false,
      costCents: 0,
      asset: { id: 'music-focused' },
      plan: {
        prompt: 'product tutorial music',
        mood: 'focused modern synth',
        tempoBpm: 104,
        durationMs: 8000,
      },
    });
    expect(result.project.storyboard?.music).toMatchObject({
      prompt: 'product tutorial music',
      mood: 'focused modern synth',
      tempoBpm: 104,
      durationMs: 8000,
      assetId: 'music-focused',
    });
    expect(
      result.project.timeline?.tracks.find(
        (track) => track.kind === 'audio-music',
      ),
    ).toMatchObject({
      id: 'track-audio-music',
      kind: 'audio-music',
      volumeDb: -10,
      clips: [
        expect.objectContaining({
          id: 'clip-music-main',
          sourceRef: { kind: 'asset', assetId: 'music-focused' },
          durationMs: 8000,
          gainDb: -10,
        }),
      ],
    });

    await expect(getProject(project.id)).resolves.toMatchObject({
      storyboard: {
        music: {
          assetId: 'music-focused',
          mood: 'focused modern synth',
        },
      },
      timeline: {
        tracks: expect.arrayContaining([
          expect.objectContaining({
            id: 'track-audio-music',
            kind: 'audio-music',
          }),
        ]),
      },
    });
  });

  it('returns an actionable plan without mutating the project when generation is disabled', async () => {
    const project = await writeMusicProject([], {
      prompt: 'Make a calm nature scene',
      storyboard: neutralStoryboardFixture(),
    });

    const result = await selectBackgroundMusic(project.id, {
      prompt: 'calm nature bed',
      generateIfMissing: false,
    });

    expect(result).toMatchObject({
      reused: false,
      generated: false,
      costCents: 0,
      plan: {
        prompt: 'calm nature bed',
        mood: 'calm ambient bed',
        tempoBpm: 78,
        durationMs: 8000,
      },
    });
    expect(result.asset).toBeUndefined();

    const stored = await getProject(project.id);
    expect(stored.storyboard?.music).toBeUndefined();
  });
});

async function writeMusicProject(
  assets: MediaItem[],
  options: { prompt?: string; storyboard?: Storyboard } = {},
): Promise<VideoProject> {
  const project = await createProject({
    name: 'Music select',
    template: 'slideshow',
  });
  const next: VideoProject = {
    ...project,
    prompt: options.prompt ?? 'Make a concise product tutorial',
    assets: assets.map((asset) => ({
      ...asset,
      path: path.posix.join(
        'videos',
        project.id,
        'assets',
        path.basename(asset.path),
      ),
    })),
    storyboard: options.storyboard ?? storyboardFixture(),
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return next;
}

function storyboardFixture(): Storyboard {
  return {
    status: 'draft',
    intent: 'Product tutorial for a dashboard workflow',
    totalDurationMs: 8000,
    costEstimateUsd: { low: 0, high: 0 },
    scenes: [
      {
        id: 'scene-1',
        durationMs: 4000,
        intent: 'Show the product dashboard',
        caption: { text: 'Plan the work in one place' },
        assetPlan: { kind: 'ai-image', prompt: 'dashboard overview' },
      },
      {
        id: 'scene-2',
        durationMs: 4000,
        intent: 'Show the tutorial workflow',
        caption: { text: 'Ship with less manual coordination' },
        assetPlan: { kind: 'ai-image', prompt: 'workflow automation' },
      },
    ],
  };
}

function neutralStoryboardFixture(): Storyboard {
  return {
    status: 'draft',
    intent: 'Quiet nature loop',
    totalDurationMs: 8000,
    costEstimateUsd: { low: 0, high: 0 },
    scenes: [
      {
        id: 'scene-1',
        durationMs: 4000,
        intent: 'Calm forest opening',
        caption: { text: 'A quiet start' },
        assetPlan: { kind: 'ai-image', prompt: 'quiet forest' },
      },
      {
        id: 'scene-2',
        durationMs: 4000,
        intent: 'Slow water movement',
        caption: { text: 'Let the moment breathe' },
        assetPlan: { kind: 'ai-image', prompt: 'slow moving water' },
      },
    ],
  };
}

function musicAsset(input: {
  id: string;
  durationMs: number;
  prompt: string;
}): MediaItem {
  return {
    id: input.id,
    kind: 'audio',
    source: 'music',
    path: `videos/project-1/assets/${input.id}.mp3`,
    metadata: {
      durationMs: input.durationMs,
      sampleRate: 44_100,
    },
    provenance: {
      provider: 'stable-audio',
      prompt: input.prompt,
    },
  };
}
