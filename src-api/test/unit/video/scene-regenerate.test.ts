import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSetting } from '@/shared/db/operations';
import {
  materializeStoryboardSceneAsset,
  regenerateStoryboardSceneAsset,
} from '@/shared/video/pipeline';
import { createProject, writeProject } from '@/shared/video/store';
import type { MediaItem, Storyboard, VideoProject } from '@/shared/video/types';

const mocks = vi.hoisted(() => ({
  createVideoTask: vi.fn(),
  createLipsyncTask: vi.fn(),
  generateImage: vi.fn(),
  getVideoTaskStatus: vi.fn(),
  safeFetch: vi.fn(),
}));

vi.mock('@/shared/services/media-generation/router', () => ({
  createLipsyncTask: mocks.createLipsyncTask,
  createVideoTask: mocks.createVideoTask,
  generateImage: mocks.generateImage,
  getVideoTaskStatus: mocks.getVideoTaskStatus,
}));

vi.mock('@/shared/network-policy/fetch', () => ({
  safeFetch: mocks.safeFetch,
}));

vi.mock('@/shared/network-policy/schema', () => ({
  trustedLocalPolicy: vi.fn(() => ({ id: 'trusted-local' })),
}));

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let workDir: string;

describe('video scene regeneration', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-regen-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setSetting('workDir', workDir);
    vi.stubEnv('NEUMA_VIDEO_AI_CLIP_POLL_INTERVAL_MS', '0');
    mocks.createVideoTask.mockReset();
    mocks.createLipsyncTask.mockReset();
    mocks.generateImage.mockReset();
    mocks.getVideoTaskStatus.mockReset();
    mocks.safeFetch.mockReset();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('blocks reference-image regeneration without confirmation', async () => {
    const project = await writeSceneProject();

    await expect(
      regenerateStoryboardSceneAsset(project.id, 'scene-2', {
        prompt: 'new shot',
        refImageAssetId: 'ref-start',
      }),
    ).rejects.toThrow(/confirmed/i);

    expect(mocks.createVideoTask).not.toHaveBeenCalled();
  });

  it('regenerates only the requested scene with inline reference images', async () => {
    mocks.createVideoTask.mockResolvedValue({
      success: true,
      provider: 'BytePlus ModelArk',
      model: 'dreamina-seedance-2-0-fast-260128',
      taskId: 'task-1',
      seed: 456,
    });
    mocks.getVideoTaskStatus.mockResolvedValue({
      success: true,
      provider: 'BytePlus ModelArk',
      providerId: 'byteplus',
      taskId: 'task-1',
      status: 'succeeded',
      videoUrl: 'https://cdn.example/generated.mp4',
      duration: 5,
    });
    mocks.safeFetch.mockResolvedValue({
      status: 200,
      body: Buffer.from('video-bytes'),
      headers: {},
      finalUrl: 'https://cdn.example/generated.mp4',
      redirectChain: [],
    });
    const project = await writeSceneProject();

    const pending = regenerateStoryboardSceneAsset(project.id, 'scene-2', {
      prompt: 'new shot',
      provider: 'seedance-2-0-fast',
      durationMs: 5000,
      refImageAssetId: 'ref-start',
      refImageTailAssetId: 'ref-end',
      seed: 123,
      confirmReferenceUpload: true,
    });
    const result = await pending;

    expect(mocks.createVideoTask).toHaveBeenCalledOnce();
    const request = mocks.createVideoTask.mock.calls[0]![0] as {
      referenceImageUrl?: string;
      referenceImageTailUrl?: string;
      seed?: number;
      duration?: number;
    };
    expect(request.referenceImageUrl).toMatch(/^data:image\/png;base64,/);
    expect(request.referenceImageTailUrl).toMatch(/^data:image\/png;base64,/);
    expect(request.seed).toBe(123);
    expect(request.duration).toBe(5);

    const scene1 = result.project.storyboard?.scenes.find(
      (scene) => scene.id === 'scene-1',
    );
    const scene2 = result.project.storyboard?.scenes.find(
      (scene) => scene.id === 'scene-2',
    );
    expect(scene1?.assetPlan).toEqual({ kind: 'existing', assetId: 'clip-1' });
    expect(scene2?.assetPlan.kind).toBe('existing');
    expect(
      scene2?.assetPlan.kind === 'existing' && scene2.assetPlan.assetId,
    ).not.toBe('clip-2');
    expect(result.project.assets.some((asset) => asset.id === 'clip-2')).toBe(
      true,
    );
    expect(result.asset.source).toBe('ai-clip');
  });

  it('blocks lipsync materialization without reference upload confirmation', async () => {
    const project = await writeLipsyncProject(false);

    await expect(
      materializeStoryboardSceneAsset(project.id, 'scene-1'),
    ).rejects.toThrow(/confirmed/i);

    expect(mocks.createLipsyncTask).not.toHaveBeenCalled();
  });

  it('materializes a confirmed lipsync scene through the media router', async () => {
    mocks.createLipsyncTask.mockResolvedValue({
      success: true,
      provider: 'Hedra',
      model: 'hedra:character-3',
      taskId: 'lipsync-1',
    });
    mocks.getVideoTaskStatus.mockResolvedValue({
      success: true,
      provider: 'Hedra',
      providerId: 'hedra',
      taskId: 'lipsync-1',
      status: 'succeeded',
      videoUrl: 'https://cdn.example/lipsync.mp4',
      duration: 5,
    });
    mocks.safeFetch.mockResolvedValue({
      status: 200,
      body: Buffer.from('lipsync-bytes'),
      headers: {},
      finalUrl: 'https://cdn.example/lipsync.mp4',
      redirectChain: [],
    });
    const project = await writeLipsyncProject(true);

    const result = await materializeStoryboardSceneAsset(project.id, 'scene-1');

    expect(mocks.createLipsyncTask).toHaveBeenCalledOnce();
    const request = mocks.createLipsyncTask.mock.calls[0]![0] as {
      imageUrl?: string;
      audio?: { base64?: string };
      provider?: string;
      text?: string;
    };
    expect(request.imageUrl).toMatch(/^data:image\/png;base64,/);
    expect(request.audio?.base64).toEqual(expect.any(String));
    expect(request.provider).toBe('hedra');
    expect(request.text).toBe('Hello from the avatar');
    expect(result.asset.source).toBe('lipsync');
    expect(result.asset.provenance?.refImageId).toBe('ref-start');
    expect(result.project.storyboard?.scenes[0]?.assetPlan.kind).toBe(
      'existing',
    );
  });
});

async function writeSceneProject(): Promise<VideoProject> {
  const project = await createProject({
    name: 'Regenerate scene',
    template: 'slideshow',
  });
  const assetDir = path.join(workDir, 'videos', project.id, 'assets');
  await fs.mkdir(assetDir, { recursive: true });
  await fs.writeFile(path.join(assetDir, 'ref-start.png'), PNG_BYTES);
  await fs.writeFile(path.join(assetDir, 'ref-end.png'), PNG_BYTES);
  await fs.writeFile(path.join(assetDir, 'clip-1.mp4'), Buffer.from('clip-1'));
  await fs.writeFile(path.join(assetDir, 'clip-2.mp4'), Buffer.from('clip-2'));

  const assets: MediaItem[] = [
    imageAsset('ref-start', project.id, 'ref-start.png'),
    imageAsset('ref-end', project.id, 'ref-end.png'),
    videoAsset('clip-1', project.id, 'clip-1.mp4'),
    videoAsset('clip-2', project.id, 'clip-2.mp4'),
  ];
  const storyboard: Storyboard = {
    status: 'approved',
    intent: 'test',
    totalDurationMs: 10000,
    costEstimateUsd: { low: 0, high: 0 },
    scenes: [
      {
        id: 'scene-1',
        durationMs: 5000,
        intent: 'keep this scene',
        assetPlan: { kind: 'existing', assetId: 'clip-1' },
      },
      {
        id: 'scene-2',
        durationMs: 5000,
        intent: 'regenerate this scene',
        assetPlan: { kind: 'existing', assetId: 'clip-2' },
      },
    ],
  };
  const next: VideoProject = {
    ...project,
    assets,
    storyboard,
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return next;
}

function imageAsset(
  id: string,
  projectId: string,
  filename: string,
): MediaItem {
  return {
    id,
    kind: 'image',
    source: 'user',
    path: path.join('videos', projectId, 'assets', filename),
    metadata: { durationMs: 0, fileSize: PNG_BYTES.length },
  };
}

function videoAsset(
  id: string,
  projectId: string,
  filename: string,
): MediaItem {
  return {
    id,
    kind: 'video',
    source: 'ai-clip',
    path: path.join('videos', projectId, 'assets', filename),
    metadata: { durationMs: 5000, fileSize: 6 },
  };
}

async function writeLipsyncProject(
  egressConfirmed: boolean,
): Promise<VideoProject> {
  const project = await createProject({
    name: 'Lipsync scene',
    template: 'explainer',
  });
  const assetDir = path.join(workDir, 'videos', project.id, 'assets');
  await fs.mkdir(assetDir, { recursive: true });
  await fs.writeFile(path.join(assetDir, 'ref-start.png'), PNG_BYTES);

  const storyboard: Storyboard = {
    status: 'approved',
    intent: 'avatar',
    totalDurationMs: 5000,
    costEstimateUsd: { low: 0, high: 1 },
    scenes: [
      {
        id: 'scene-1',
        durationMs: 5000,
        intent: 'talking head',
        assetPlan: {
          kind: 'lipsync',
          text: 'Hello from the avatar',
          referenceImageAssetId: 'ref-start',
          lipsyncProvider: 'hedra',
          aspectRatio: '16:9',
          motionScale: 0.5,
          background: { kind: 'transparent' },
          egressConfirmed,
        },
      },
    ],
  };
  const next: VideoProject = {
    ...project,
    assets: [imageAsset('ref-start', project.id, 'ref-start.png')],
    storyboard,
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return next;
}
