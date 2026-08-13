import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import {
  generateVideoAudio,
  transformVideoAudio,
} from '@/shared/video/audio-generation';
import { getProject, writeProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

let workDir: string;

describe('video audio generation', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-audio-gen-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    vi.stubEnv('STABILITY_API_KEY', '');
    vi.stubEnv('STABILITY_AI_API_KEY', '');
    vi.stubEnv('STABLE_AUDIO_API_KEY', '');
    vi.stubEnv('MINIMAX_API_KEY', '');
    setSetting('providers', '[]');
    await writeProject(projectFixture());
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    closeDatabase();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('generates prompt audio, records provenance, and inserts a timeline clip', async () => {
    const result = await generateVideoAudio('project-1', {
      durationMs: 2000,
      kind: 'music',
      prompt: 'Warm optimistic synth bed',
      startMs: 1000,
    });

    expect(result.asset).toMatchObject({
      kind: 'audio',
      source: 'music',
      provenance: {
        fallbackReason: 'missing-credentials',
        generatedFor: {
          clipId: result.clip.id,
          rangeMs: [1000, 3000],
        },
        prompt: 'Warm optimistic synth bed',
        provider: 'elevenlabs-music',
      },
    });
    expect(result.clip).toMatchObject({
      kind: 'audio',
      durationMs: 2000,
      startMs: 1000,
      sourceRef: { kind: 'asset', assetId: result.asset.id },
    });

    const stored = await getProject('project-1');
    const musicTrack = stored.timeline?.tracks.find(
      (track) => track.kind === 'audio-music',
    );
    expect(musicTrack?.clips).toEqual([
      expect.objectContaining({
        id: result.clip.id,
        sourceRef: { kind: 'asset', assetId: result.asset.id },
      }),
    ]);
    expect(stored.history?.entries[0]).toMatchObject({
      id: result.entryId,
      source: 'agent',
      summary: expect.stringContaining('Generated music audio'),
    });
  });

  it('generates voiceover audio with transcript text on a voiceover track', async () => {
    const result = await generateVideoAudio('project-1', {
      kind: 'voiceover',
      prompt: 'Meet the new launch.',
      sceneId: 'scene-1',
    });

    const stored = await getProject('project-1');
    const voiceTrack = stored.timeline?.tracks.find(
      (track) => track.kind === 'audio-vo',
    );
    expect(result.asset).toMatchObject({
      kind: 'audio',
      source: 'tts',
      provenance: {
        generatedFor: {
          clipId: result.clip.id,
          sceneId: 'scene-1',
        },
        prompt: 'Meet the new launch.',
        provider: 'kokoro',
      },
    });
    expect(voiceTrack?.clips[0]).toMatchObject({
      id: result.clip.id,
      sceneId: 'scene-1',
      transcriptText: 'Meet the new launch.',
    });
  });

  it('transforms an existing audio clip by replacing its source asset', async () => {
    const result = await transformVideoAudio('project-1', {
      mode: 'replace',
      prompt: 'Bright button click',
      sourceClipId: 'clip-sfx-1',
    });

    const stored = await getProject('project-1');
    const sfxTrack = stored.timeline?.tracks.find(
      (track) => track.kind === 'audio-sfx',
    );
    expect(result.clip).toMatchObject({
      id: 'clip-sfx-1',
      sourceRef: { kind: 'asset', assetId: result.asset.id },
    });
    expect(sfxTrack?.clips).toHaveLength(1);
    expect(sfxTrack?.clips[0]).toMatchObject({
      id: 'clip-sfx-1',
      sourceRef: { kind: 'asset', assetId: result.asset.id },
    });
    expect(result.asset.provenance).toMatchObject({
      generatedFor: { clipId: 'clip-sfx-1', rangeMs: [500, 1500] },
      prompt: 'Bright button click',
    });
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Audio generation',
    template: 'explainer',
    prompt: 'Explain the launch',
    assets: [
      {
        id: 'asset-original-sfx',
        kind: 'audio',
        source: 'user',
        path: 'videos/project-1/assets/original.wav',
        metadata: { durationMs: 1000 },
      },
    ],
    storyboard: {
      costEstimateUsd: { high: 0, low: 0 },
      intent: 'Launch video',
      scenes: [
        {
          id: 'scene-1',
          assetPlan: { kind: 'ai-image', prompt: 'Launch' },
          durationMs: 3000,
          intent: 'Launch',
        },
      ],
      status: 'approved',
      totalDurationMs: 3000,
    },
    timeline: {
      durationMs: 3000,
      fps: 30,
      schema: 'neuma.video.timeline.v1',
      tracks: [
        {
          id: 'track-video-main',
          kind: 'video',
          name: 'Video',
          muted: false,
          locked: false,
          hidden: false,
          order: 0,
          clips: [
            {
              id: 'clip-video-1',
              kind: 'image',
              sourceRef: { kind: 'scene', sceneId: 'scene-1' },
              sceneId: 'scene-1',
              startMs: 0,
              durationMs: 3000,
              trimStartMs: 0,
              trimEndMs: 3000,
            },
          ],
        },
        {
          id: 'track-audio-sfx',
          kind: 'audio-sfx',
          name: 'SFX',
          muted: false,
          locked: false,
          order: 10,
          clips: [
            {
              id: 'clip-sfx-1',
              kind: 'audio',
              sourceRef: { kind: 'asset', assetId: 'asset-original-sfx' },
              sceneId: 'scene-1',
              startMs: 500,
              durationMs: 1000,
              trimStartMs: 0,
              trimEndMs: 1000,
              sourceDurationMs: 1000,
            },
          ],
        },
      ],
    },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    render: { status: 'idle', updatedAt: '2026-06-22T00:00:00.000Z' },
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  };
}
