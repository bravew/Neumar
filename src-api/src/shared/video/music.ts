import fs from 'node:fs/promises';
import path from 'node:path';

import { logUsage } from '@/shared/services/usage-logger';

import {
  generateMusicWithProvider,
  type MusicProviderId,
} from './music-providers';
import {
  getProject,
  getVideoAssetsDir,
  getVideoProjectRoot,
  writeProject,
} from './store';
import { rebuildTimelineFromStoryboard } from './timeline';
import type { MediaItem, VideoProject } from './types';

export interface MusicRequest {
  prompt: string;
  durationMs: number;
  tempoBpm?: number;
  mood?: string;
  aspectDurationMs?: number;
  provider?: MusicProviderId;
  model?: string;
  seed?: number;
}

export async function generateBackgroundMusic(
  projectId: string,
  request: MusicRequest,
): Promise<{ project: VideoProject; asset: MediaItem; costCents: number }> {
  const project = await getProject(projectId);
  const provider = request.provider ?? project.settings?.musicProviderId;
  const projectRoot = getVideoProjectRoot(projectId);
  const assetDir = getVideoAssetsDir(projectId);
  const generated = await generateMusicWithProvider({
    ...request,
    provider,
    model: request.model ?? project.settings?.musicProviderModel,
    outputDir: assetDir,
  });
  const stat = await fs.stat(generated.filePath);
  const asset: MediaItem = {
    id: crypto.randomUUID(),
    kind: 'audio',
    source: 'music',
    path: path.relative(projectRoot, generated.filePath),
    metadata: {
      durationMs: request.durationMs,
      sampleRate: generated.sampleRate,
      channels: generated.channels,
      fileSize: stat.size,
    },
    provenance: {
      provider: generated.provider,
      model: generated.model,
      requestedProvider: provider ?? generated.provider,
      requestedModel: request.model ?? project.settings?.musicProviderModel,
      fallbackReason: generated.fallbackReason,
      prompt: request.prompt,
      seed: request.seed,
      cost: generated.costCents / 100,
      license: generated.license,
      commercialUse: generated.commercialUse,
    },
  };
  const next = rebuildTimelineFromStoryboard({
    ...project,
    assets: [...project.assets, asset],
    storyboard: project.storyboard
      ? {
          ...project.storyboard,
          music: {
            prompt: request.prompt,
            durationMs: request.durationMs,
            provider: generated.provider,
            model: generated.model,
            tempoBpm: request.tempoBpm,
            mood: request.mood,
            seed: request.seed,
            assetId: asset.id,
          },
        }
      : project.storyboard,
    budget: {
      ...(project.budget ?? { capUsd: 5, spentUsd: 0 }),
      spentUsd: (project.budget?.spentUsd ?? 0) + generated.costCents / 100,
    },
    updatedAt: new Date().toISOString(),
  });
  await writeProject(next);
  logUsage({
    callType: 'other',
    provider: generated.provider,
    model: generated.model,
    totalCostUsd: generated.costCents / 100,
    unitType: 'audio_second',
    unitCount: Math.ceil(request.durationMs / 1000),
    status: generated.fallbackReason ? 'error' : 'success',
    errorMessage: generated.fallbackReason,
    metadata: {
      project_id: projectId,
      caller: 'video-mode',
      media_kind: 'music',
      requested_provider: provider ?? generated.provider,
    },
  });
  return { project: next, asset, costCents: generated.costCents };
}
