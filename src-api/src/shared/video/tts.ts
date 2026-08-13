import fs from 'node:fs/promises';
import path from 'node:path';

import { logUsage } from '@/shared/services/usage-logger';

import {
  getProject,
  getVideoAssetsDir,
  getVideoProjectRoot,
  writeProject,
} from './store';
import { rebuildTimelineFromStoryboard } from './timeline';
import type {
  MediaItem,
  NarrationSegment,
  ProviderId,
  VideoProject,
} from './types';

export interface TtsRequest {
  text: string;
  voiceId?: string;
  speedRate?: number;
  aspectDurationMs?: number;
  lang?: string;
  provider?: Extract<
    ProviderId,
    | 'kokoro'
    | 'elevenlabs'
    | 'cartesia'
    | 'openai-tts'
    | 'gemini-tts'
    | 'hume-octave'
    | 'indextts'
  >;
}

export interface TtsResult {
  audioPath: string;
  durationMs: number;
  provider: string;
  voiceId: string;
  costCents: number;
  asset: MediaItem;
  project: VideoProject;
}

export interface StoryboardNarrationRequest {
  segments?: Array<{
    id?: string;
    sceneId: string;
    text: string;
    voiceId?: string;
    provider?: TtsRequest['provider'];
  }>;
  voiceId?: string;
  provider?: TtsRequest['provider'];
}

export interface StoryboardNarrationResult {
  project: VideoProject;
  asset: MediaItem;
  costCents: number;
  segments: NarrationSegment[];
}

export async function synthesizeTtsPreview(
  projectId: string,
  request: TtsRequest,
): Promise<TtsResult> {
  const project = await getProject(projectId);
  const provider = request.provider ?? 'kokoro';
  const projectRoot = getVideoProjectRoot(projectId);
  const durationMs =
    request.aspectDurationMs ??
    Math.max(
      800,
      Math.ceil(request.text.trim().split(/\s+/).length / 2.6) * 1000,
    );
  const assetDir = getVideoAssetsDir(projectId);
  await fs.mkdir(assetDir, { recursive: true });
  const outPath = path.join(assetDir, `tts-${crypto.randomUUID()}.wav`);
  await fs.writeFile(outPath, createSilentWav(durationMs));
  const costCents = estimateTtsCostCents(request.text, provider);
  const asset: MediaItem = {
    id: crypto.randomUUID(),
    kind: 'audio',
    source: 'tts',
    path: path.relative(projectRoot, outPath),
    metadata: {
      durationMs,
      sampleRate: 48000,
      channels: 1,
      fileSize: (await fs.stat(outPath)).size,
    },
    provenance: {
      provider,
      model: request.voiceId,
      prompt: request.text,
      cost: costCents / 100,
      commercialUse: provider === 'kokoro',
    },
  };
  const next = {
    ...project,
    assets: [...project.assets, asset],
    budget: {
      ...(project.budget ?? { capUsd: 5, spentUsd: 0 }),
      spentUsd: (project.budget?.spentUsd ?? 0) + costCents / 100,
    },
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  if (costCents > 0) {
    logUsage({
      callType: 'speech',
      provider,
      model: request.voiceId ?? 'default',
      totalCostUsd: costCents / 100,
      unitType: 'character',
      unitCount: request.text.length,
      metadata: {
        project_id: projectId,
        caller: 'video-mode',
        media_kind: 'tts',
      },
    });
  }
  return {
    audioPath: asset.path,
    durationMs,
    provider,
    voiceId: request.voiceId ?? 'default',
    costCents,
    asset,
    project: next,
  };
}

export async function synthesizeStoryboardNarration(
  projectId: string,
  request: StoryboardNarrationRequest = {},
): Promise<StoryboardNarrationResult> {
  const project = await getProject(projectId);
  const storyboard = project.storyboard;
  if (!storyboard) throw new Error('Storyboard not found');
  const provider = request.provider ?? 'kokoro';
  const existingSegments = new Map(
    (storyboard.narration?.segments ?? []).map((segment) => [
      segment.sceneId,
      segment,
    ]),
  );
  const segments = (
    request.segments?.length
      ? request.segments
      : storyboard.scenes.map((scene) => {
          const existing = existingSegments.get(scene.id);
          return {
            id: existing?.id,
            sceneId: scene.id,
            text: existing?.text ?? scene.caption?.text ?? scene.intent,
            voiceId: existing?.voiceId ?? request.voiceId,
            provider: existing?.provider ?? provider,
          };
        })
  ).map<NarrationSegment>((segment) => ({
    id: segment.id ?? crypto.randomUUID(),
    sceneId: segment.sceneId,
    text: segment.text,
    voiceId: segment.voiceId ?? request.voiceId,
    provider: segment.provider ?? provider,
  }));

  if (segments.length === 0)
    throw new Error('Narration requires at least one segment');

  const durationMs = Math.max(
    1000,
    storyboard.totalDurationMs ||
      storyboard.scenes.reduce((total, scene) => total + scene.durationMs, 0),
  );
  const projectRoot = getVideoProjectRoot(projectId);
  const assetDir = getVideoAssetsDir(projectId);
  await fs.mkdir(assetDir, { recursive: true });
  const outPath = path.join(assetDir, `narration-${crypto.randomUUID()}.wav`);
  await fs.writeFile(outPath, createSilentWav(durationMs));
  const text = segments.map((segment) => segment.text).join('\n');
  const costCents = estimateTtsCostCents(text, provider);
  const asset: MediaItem = {
    id: crypto.randomUUID(),
    kind: 'audio',
    source: 'tts',
    path: path.relative(projectRoot, outPath),
    metadata: {
      durationMs,
      sampleRate: 48000,
      channels: 1,
      fileSize: (await fs.stat(outPath)).size,
    },
    provenance: {
      provider,
      model: request.voiceId,
      prompt: text,
      cost: costCents / 100,
      commercialUse: provider === 'kokoro',
    },
  };
  const next: VideoProject = rebuildTimelineFromStoryboard({
    ...project,
    assets: [...project.assets, asset],
    storyboard: {
      ...storyboard,
      narration: {
        segments,
        voiceId: request.voiceId,
        provider,
        assetId: asset.id,
      },
    },
    budget: {
      ...(project.budget ?? { capUsd: 5, spentUsd: 0 }),
      spentUsd: (project.budget?.spentUsd ?? 0) + costCents / 100,
    },
    updatedAt: new Date().toISOString(),
  });
  await writeProject(next);
  if (costCents > 0) {
    logUsage({
      callType: 'speech',
      provider,
      model: request.voiceId ?? 'default',
      totalCostUsd: costCents / 100,
      unitType: 'character',
      unitCount: text.length,
      metadata: {
        project_id: projectId,
        caller: 'video-mode',
        media_kind: 'tts',
      },
    });
  }
  return { project: next, asset, costCents, segments };
}

function estimateTtsCostCents(text: string, provider: string): number {
  if (provider === 'kokoro') return 0;
  return Math.ceil(text.length * 0.002);
}

function createSilentWav(durationMs: number): Buffer {
  const sampleRate = 48000;
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = Math.max(1, Math.ceil((durationMs / 1000) * sampleRate));
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
