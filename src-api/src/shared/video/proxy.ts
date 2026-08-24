import fs from 'node:fs/promises';
import path from 'node:path';

import { probeFile, runFFmpeg, validatePath } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';

import { resolveProjectAssetPath } from './asset-files';
import {
  getProject,
  getVideoAssetDerivativesDir,
  getVideoProjectRoot,
  writeProject,
} from './store';
import type { MediaItem, MediaProxy, VideoProject } from './types';

const logger = createLogger('VideoProxy');

export const VIDEO_PROXY_SIZE_THRESHOLD_BYTES = 50 * 1024 * 1024;
export const VIDEO_PROXY_MAX_SOURCE_PIXELS = 1920 * 1080;
export const VIDEO_PROXY_TARGET_HEIGHT_PX = 720;
// CRF 30 at `veryfast` looked visibly blocky on detailed footage (busy
// night scenes, on-screen text) once actually played back at preview size —
// `veryfast` needs a lower CRF than a slower preset to hit the same visual
// quality, since it skips motion-estimation work that would otherwise spend
// bits more efficiently. `fast` + CRF 23 is a well-worn "good enough to
// judge a shot by" preview quality; proxy generation already runs as a
// background job, so the extra encode time is not on any interactive path.
export const VIDEO_PROXY_CRF = 23;
export const VIDEO_PROXY_PRESET = 'fast';
export const VIDEO_PROXY_ESTIMATED_BITRATE_BPS = 3_000_000;

const activeProxyJobs = new Set<string>();

export interface VideoProxyGenerationResult {
  project: VideoProject;
  asset: MediaItem;
  generated: boolean;
  skippedReason?: 'not-video' | 'below-threshold' | 'already-ready';
}

export function shouldGenerateVideoProxy(asset: MediaItem): boolean {
  if (asset.kind !== 'video') return false;
  const fileSize = asset.metadata.fileSize ?? 0;
  const sourcePixels =
    (asset.metadata.width ?? 0) * (asset.metadata.height ?? 0);
  return (
    fileSize > VIDEO_PROXY_SIZE_THRESHOLD_BYTES ||
    sourcePixels > VIDEO_PROXY_MAX_SOURCE_PIXELS
  );
}

/**
 * Where a newly generated proxy is written: inside the project's derivatives
 * dir, never beside the master. The master may be an external file the user
 * only lent us read access to.
 *
 * Existing assets keep whatever `asset.proxy.path` already records, so proxies
 * written beside older masters stay valid.
 */
export function proxyPathForAsset(projectId: string, asset: MediaItem): string {
  return path.join(
    getVideoAssetDerivativesDir(projectId, asset.id),
    'proxy.mp4',
  );
}

export const VIDEO_PROXY_AUDIO_BITRATE_BPS = 128_000;

export function buildVideoProxyArgs(
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    // `?` makes the audio map optional, so a source with no audio stream
    // (a screen recording, a silent b-roll clip) still produces a proxy
    // instead of failing. The preview and its audio engine both stream from
    // this same file, so a proxy without an audio track means silent
    // playback for anything large/high-res enough to get one.
    '-map',
    '0:a:0?',
    '-vf',
    `scale=-2:${VIDEO_PROXY_TARGET_HEIGHT_PX}`,
    '-c:v',
    'libx264',
    '-preset',
    VIDEO_PROXY_PRESET,
    '-crf',
    String(VIDEO_PROXY_CRF),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    `${VIDEO_PROXY_AUDIO_BITRATE_BPS}`,
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

export function scheduleVideoProxyGeneration(
  projectId: string,
  assetId: string,
): void {
  const key = `${projectId}:${assetId}`;
  if (activeProxyJobs.has(key)) return;
  activeProxyJobs.add(key);
  void generateVideoProxyForAsset(projectId, assetId)
    .catch((error: unknown) => {
      logger.warn('video.proxy.generation_failed', {
        project_id: projectId,
        asset_id: assetId,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      activeProxyJobs.delete(key);
    });
}

export async function generateVideoProxyForAsset(
  projectId: string,
  assetId: string,
  options: { force?: boolean } = {},
): Promise<VideoProxyGenerationResult> {
  const project = await getProject(projectId);
  const asset = findAsset(project, assetId);
  if (asset.kind !== 'video') {
    return skipped(project, asset, 'not-video');
  }
  if (!options.force && asset.proxy) {
    return skipped(project, asset, 'already-ready');
  }
  if (!options.force && !shouldGenerateVideoProxy(asset)) {
    return skipped(project, asset, 'below-threshold');
  }

  const root = getVideoProjectRoot(projectId);
  const inputPath = resolveProjectAssetPath(asset, root);
  const outputPath = validatePath(proxyPathForAsset(projectId, asset), root);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const result = await runFFmpeg(buildVideoProxyArgs(inputPath, outputPath), {
    inputDuration:
      asset.metadata.durationMs > 0
        ? asset.metadata.durationMs / 1000
        : undefined,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Proxy generation failed: ${result.stderr.slice(0, 500)}`);
  }

  const proxy = await proxyMetadataFromFile(outputPath, root);
  const latest = await getProject(projectId);
  const now = new Date().toISOString();
  const next: VideoProject = {
    ...latest,
    assets: latest.assets.map((candidate) =>
      candidate.id === assetId ? { ...candidate, proxy } : candidate,
    ),
    updatedAt: now,
  };
  await writeProject(next);
  const updatedAsset = findAsset(next, assetId);
  logger.info('video.proxy.generated', {
    project_id: projectId,
    asset_id: assetId,
    proxy_path: proxy.path,
  });
  return { project: next, asset: updatedAsset, generated: true };
}

export async function clearVideoProxyForAsset(
  projectId: string,
  assetId: string,
): Promise<{ project: VideoProject; asset: MediaItem }> {
  const project = await getProject(projectId);
  const asset = findAsset(project, assetId);
  if (asset.proxy && asset.proxy.source !== 'asset_catalog') {
    const root = getVideoProjectRoot(projectId);
    try {
      await fs.rm(validatePath(asset.proxy.path, root), {
        force: true,
      });
    } catch (error) {
      logger.warn('video.proxy.delete_failed', {
        project_id: projectId,
        asset_id: assetId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const now = new Date().toISOString();
  const next: VideoProject = {
    ...project,
    assets: project.assets.map((candidate) => {
      if (candidate.id !== assetId) return candidate;
      const { proxy: _proxy, ...withoutProxy } = candidate;
      return withoutProxy;
    }),
    updatedAt: now,
  };
  await writeProject(next);
  return { project: next, asset: findAsset(next, assetId) };
}

async function proxyMetadataFromFile(
  outputPath: string,
  root: string,
): Promise<MediaProxy> {
  const probe = await probeFile(outputPath, root);
  const video = probe.streams.find((stream) => stream.codecType === 'video');
  return {
    path: path.relative(root, outputPath),
    widthPx: video?.width ?? 0,
    heightPx: video?.height ?? VIDEO_PROXY_TARGET_HEIGHT_PX,
    bitrateBps: probe.bitRate || VIDEO_PROXY_ESTIMATED_BITRATE_BPS,
    createdAt: new Date().toISOString(),
  };
}

function findAsset(project: VideoProject, assetId: string): MediaItem {
  const asset = project.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error('Asset not found');
  return asset;
}

function skipped(
  project: VideoProject,
  asset: MediaItem,
  skippedReason: NonNullable<VideoProxyGenerationResult['skippedReason']>,
): VideoProxyGenerationResult {
  return { project, asset, generated: false, skippedReason };
}
