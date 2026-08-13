import {
  createVideoTask,
  generateImage,
} from '@/shared/services/media-generation/router';
import type {
  ImageGenerationResult,
  VideoTaskCreatedResult,
} from '@/shared/services/media-generation/types';

import type {
  AspectRatio,
  MediaItem,
  ProviderId,
  StoryboardScene,
  VideoProject,
} from '../types';

export interface GenContext {
  project: VideoProject;
  scene: StoryboardScene;
  signal?: AbortSignal;
}

export interface ImageGenRequest {
  kind: 'image';
  prompt: string;
  refImagePaths?: string[];
  aspectRatio: AspectRatio;
  size?: '2K' | '4K' | `${number}x${number}`;
  seed?: number;
  budgetCapCents?: number;
  provider?: ProviderId;
}

export interface VideoGenRequest {
  kind: 't2v' | 'i2v';
  prompt: string;
  refImagePath?: string;
  lastFramePath?: string;
  referencePaths?: string[];
  durationMs: number;
  aspectRatio: AspectRatio;
  resolution?: '480p' | '720p' | '1080p';
  generateAudio?: boolean;
  seed?: number;
  budgetCapCents?: number;
  provider?: ProviderId;
}

export type GenRequest = ImageGenRequest | VideoGenRequest;

export interface ImageGenResult {
  outputPath?: string;
  provider: string;
  model: string;
  costCents: number;
  width?: number;
  height?: number;
  raw: ImageGenerationResult;
}

export interface VideoTaskResult {
  provider: string;
  model: string;
  taskId: string;
  costCents: number;
  raw: VideoTaskCreatedResult;
}

export interface VisualGenProvider {
  id: ProviderId;
  generateImage?(
    req: ImageGenRequest,
    ctx: GenContext,
  ): Promise<ImageGenResult>;
  createVideoTask?(
    req: VideoGenRequest,
    ctx: GenContext,
  ): Promise<VideoTaskResult>;
  estimateCost(req: GenRequest): {
    cents: number;
    confidence: 'low' | 'medium' | 'high';
  };
}

export async function generateStoryboardImage(
  request: ImageGenRequest,
): Promise<ImageGenResult> {
  const result = await generateImage({
    prompt: request.prompt,
    aspectRatio: request.aspectRatio,
    size: request.size,
    count: 1,
    provider: request.provider,
    seed: request.seed,
  });
  if (!result.success) {
    throw new Error(result.error ?? 'Image generation failed');
  }
  return {
    outputPath: result.images[0]?.localPath,
    provider: result.provider,
    model: result.model,
    costCents: estimateGenCost(request).cents,
    raw: result,
  };
}

export async function createStoryboardVideoTask(
  request: VideoGenRequest,
): Promise<VideoTaskResult> {
  const result = await createVideoTask({
    prompt: request.prompt,
    aspectRatio: request.aspectRatio,
    duration: Math.ceil(request.durationMs / 1000),
    resolution: request.resolution ?? '720p',
    provider: request.provider,
    seed: request.seed,
    generateAudio: request.generateAudio,
  });
  if (!result.success || !result.taskId) {
    throw new Error(result.error ?? 'Video task creation failed');
  }
  return {
    provider: result.provider,
    model: result.model,
    taskId: result.taskId,
    costCents: estimateGenCost(request).cents,
    raw: result,
  };
}

export function estimateGenCost(request: GenRequest): {
  cents: number;
  confidence: 'low' | 'medium' | 'high';
} {
  if (request.kind === 'image') {
    return {
      cents: request.provider?.startsWith('seedream') ? 10 : 20,
      confidence: 'low',
    };
  }
  const seconds = Math.ceil(request.durationMs / 1000);
  const rate = request.provider === 'seedance-2-0-fast' ? 8 : 12;
  return { cents: seconds * rate, confidence: 'low' };
}

export function mediaItemFromGeneratedImage(
  outputPath: string,
  result: ImageGenResult,
): MediaItem {
  return {
    id: crypto.randomUUID(),
    kind: 'image',
    source: 'ai-clip',
    path: outputPath,
    metadata: { durationMs: 0, width: result.width, height: result.height },
    provenance: {
      provider: result.provider,
      model: result.model,
      cost: result.costCents / 100,
    },
  };
}
