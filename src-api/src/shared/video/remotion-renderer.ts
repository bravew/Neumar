import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { durationFramesToMs, msToFrame } from '@neumar/video-ir';

import { validatePath } from '@/shared/services/ffmpeg';

import { REMOTION_RENDER_COMPOSITION_ID } from './remotion-constants';
import {
  buildRemotionRenderInput,
  type RemotionRenderInput,
} from './remotion-render-input';
import { startRenderAssetServer } from './render-asset-server';
import {
  getRenderCacheEntry,
  recordRenderCacheEntry,
  renderCacheFramePath,
  renderTimelineFrameCacheKey,
} from './render-cache';
import { getVideoProjectCacheDirForRoot } from './store';
import type { AspectRatio, VideoProject } from './types';

export interface RenderProjectWithRemotionOptions {
  project: VideoProject;
  outputPath: string;
  aspectRatio: AspectRatio;
  mode: 'speed' | 'reproducible';
  includeCaptions: boolean;
  root: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface RenderTimelineFramesWithRemotionOptions {
  project: VideoProject;
  startMs: number;
  endMs: number;
  frameCount?: number;
  aspectRatio: AspectRatio;
  maxEdgePx?: number;
  root: string;
  signal?: AbortSignal;
}

export interface RenderTimelineFrameResult {
  atMs: number;
  imageBase64: string;
  w: number;
  h: number;
  cacheHit: boolean;
}

export interface RenderTimelineFramesResult {
  schema: 'neuma.video.timeline-frames.v1';
  projectId: string;
  startMs: number;
  endMs: number;
  aspectRatio: AspectRatio;
  maxEdgePx: number;
  frames: RenderTimelineFrameResult[];
  applied: {
    transforms: boolean;
    overlays: boolean;
    captions: boolean;
    keyframes: boolean;
  };
}

const DEFAULT_TIMELINE_FRAME_COUNT = 3;
const MAX_TIMELINE_FRAME_COUNT = 8;
const DEFAULT_TIMELINE_FRAME_MAX_EDGE_PX = 512;
const MAX_TIMELINE_FRAME_MAX_EDGE_PX = 1024;
const REMOTION_BUNDLE_PREVIOUS_CACHE_DIRS_TO_KEEP = 2;
const REMOTION_BUNDLE_FINGERPRINT_PATTERN = /^[a-f0-9]{16}$/;

export async function renderProjectWithRemotion({
  project,
  outputPath,
  aspectRatio,
  mode,
  includeCaptions,
  root,
  signal,
  onProgress,
}: RenderProjectWithRemotionOptions): Promise<RemotionRenderInput> {
  const inputProps = await buildRemotionRenderInput(project, {
    aspectRatio,
    includeCaptions,
    root,
  });
  // Resolve the Remotion toolchain first so a missing-module error surfaces
  // before the entry-point file lookup — a pkg snapshot miss is otherwise
  // masked by a less useful "Remotion render entry not found".
  const [{ bundle }, { makeCancelSignal, renderMedia, selectComposition }] =
    await Promise.all([
      import('@remotion/bundler'),
      import('@remotion/renderer'),
    ]);
  const entryPoint = await resolveRemotionEntryPoint();
  const bundleDir = await resolveRemotionBundleDir(root, project.id);
  await fs.mkdir(bundleDir, { recursive: true });
  const serveUrl = await bundle({
    entryPoint,
    outDir: bundleDir,
    enableCaching: true,
    onProgress: (progress) => onProgress?.(Math.round(progress * 15)),
  });
  const { cancelSignal, cancel } = makeCancelSignal();
  const abort = () => cancel();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const assetServer = await startRenderAssetServer(inputProps);

  try {
    const composition = await selectComposition({
      serveUrl,
      id: REMOTION_RENDER_COMPOSITION_ID,
      inputProps: assetServer.inputProps,
      logLevel: 'warn',
    });
    await renderMedia({
      serveUrl,
      composition,
      inputProps: assetServer.inputProps,
      outputLocation: outputPath,
      codec: 'h264',
      crf: mode === 'reproducible' ? 20 : 23,
      x264Preset: mode === 'speed' ? 'veryfast' : 'medium',
      overwrite: true,
      cancelSignal,
      logLevel: 'warn',
      onProgress: (progress) => {
        onProgress?.(15 + Math.round(progress.progress * 85));
      },
    });
    return inputProps;
  } finally {
    signal?.removeEventListener('abort', abort);
    await assetServer.close();
  }
}

export async function renderTimelineFramesWithRemotion({
  project,
  startMs,
  endMs,
  frameCount,
  aspectRatio,
  maxEdgePx,
  root,
  signal,
}: RenderTimelineFramesWithRemotionOptions): Promise<RenderTimelineFramesResult> {
  if (endMs <= startMs) {
    throw new Error('Timeline frame inspection endMs must be after startMs');
  }
  const requestedFrameCount = Math.min(
    Math.max(frameCount ?? DEFAULT_TIMELINE_FRAME_COUNT, 1),
    MAX_TIMELINE_FRAME_COUNT,
  );
  const resolvedMaxEdgePx = Math.min(
    Math.max(maxEdgePx ?? DEFAULT_TIMELINE_FRAME_MAX_EDGE_PX, 64),
    MAX_TIMELINE_FRAME_MAX_EDGE_PX,
  );
  const inputProps = await buildRemotionRenderInput(project, {
    aspectRatio,
    includeCaptions: true,
    root,
  });
  const dimensions = scaledDimensions({
    width: inputProps.compositionWidth,
    height: inputProps.compositionHeight,
    maxEdgePx: resolvedMaxEdgePx,
  });
  const stillInputProps: RemotionRenderInput = {
    ...inputProps,
    compositionWidth: dimensions.width,
    compositionHeight: dimensions.height,
  };
  const timelineHash = createHash('sha256')
    .update(stableJson(stillInputProps))
    .digest('hex');
  const frameTimes = sampleFrameTimes({
    startMs,
    endMs,
    count: requestedFrameCount,
    durationMs: framesToMs(
      stillInputProps.durationInFrames,
      stillInputProps.fps,
    ),
  });
  const frames: RenderTimelineFrameResult[] = [];
  const misses: Array<{
    atMs: number;
    frame: number;
    hash: string;
    outputPath: string;
  }> = [];

  for (const atMs of frameTimes) {
    const hash = renderTimelineFrameCacheKey({
      timelineHash,
      atMs,
      aspectRatio,
      maxEdgePx: resolvedMaxEdgePx,
    });
    const cached = await getRenderCacheEntry({
      root,
      projectId: project.id,
      hash,
    });
    if (cached) {
      const data = await fs.readFile(cached.absolutePath);
      frames.push({
        atMs,
        imageBase64: data.toString('base64'),
        w: dimensions.width,
        h: dimensions.height,
        cacheHit: true,
      });
      continue;
    }
    misses.push({
      atMs,
      frame: msToFrame(atMs, stillInputProps.fps),
      hash,
      outputPath: renderCacheFramePath(root, project.id, hash),
    });
  }

  if (misses.length > 0) {
    const [{ bundle }, { makeCancelSignal, renderStill, selectComposition }] =
      await Promise.all([
        import('@remotion/bundler'),
        import('@remotion/renderer'),
      ]);
    const entryPoint = await resolveRemotionEntryPoint();
    const bundleDir = await resolveRemotionBundleDir(root, project.id);
    await fs.mkdir(bundleDir, { recursive: true });
    const serveUrl = await bundle({
      entryPoint,
      outDir: bundleDir,
      enableCaching: true,
    });
    const { cancelSignal, cancel } = makeCancelSignal();
    const abort = () => cancel();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    const assetServer = await startRenderAssetServer(stillInputProps);

    try {
      const composition = await selectComposition({
        serveUrl,
        id: REMOTION_RENDER_COMPOSITION_ID,
        inputProps: assetServer.inputProps,
        logLevel: 'warn',
      });
      for (const miss of misses) {
        await fs.mkdir(path.dirname(miss.outputPath), { recursive: true });
        await renderStill({
          serveUrl,
          composition,
          inputProps: assetServer.inputProps,
          output: miss.outputPath,
          frame: miss.frame,
          imageFormat: 'png',
          overwrite: true,
          cancelSignal,
          logLevel: 'warn',
        });
        await recordRenderCacheEntry({
          root,
          projectId: project.id,
          hash: miss.hash,
          absolutePath: miss.outputPath,
          metadata: {
            scope: 'timeline-frame',
            atMs: miss.atMs,
            aspectRatio,
            maxEdgePx: resolvedMaxEdgePx,
            timelineHash,
            width: dimensions.width,
            height: dimensions.height,
          },
        });
        const data = await fs.readFile(miss.outputPath);
        frames.push({
          atMs: miss.atMs,
          imageBase64: data.toString('base64'),
          w: dimensions.width,
          h: dimensions.height,
          cacheHit: false,
        });
      }
    } finally {
      signal?.removeEventListener('abort', abort);
      await assetServer.close();
    }
  }

  return {
    schema: 'neuma.video.timeline-frames.v1',
    projectId: project.id,
    startMs,
    endMs,
    aspectRatio,
    maxEdgePx: resolvedMaxEdgePx,
    frames: frames.sort((a, b) => a.atMs - b.atMs),
    applied: {
      transforms: stillInputProps.visualClips.some((clip) =>
        Boolean(
          clip.transforms || clip.filters || clip.reframe || clip.imagePan,
        ),
      ),
      overlays: stillInputProps.visualClips.some(
        (clip) => clip.trackKind === 'overlay' || clip.trackKind === 'broll',
      ),
      captions: stillInputProps.captions.length > 0,
      keyframes: false,
    },
  };
}

export async function resolveRemotionEntryPoint(): Promise<string> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(currentDir, 'remotion-render-entry.ts'),
    path.join(currentDir, 'remotion-render-entry.js'),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next compiled/source extension.
    }
  }
  throw new Error('Remotion render entry not found');
}

export async function resolveRemotionBundleDir(
  root: string,
  projectId: string,
): Promise<string> {
  const bundleRoot = validatePath(
    path.join(
      getVideoProjectCacheDirForRoot(root, projectId),
      'remotion-bundle',
    ),
    root,
    'write',
  );
  const fingerprint = await remotionSourceFingerprint();
  await pruneRemotionBundleDirs(bundleRoot, fingerprint);
  return validatePath(path.join(bundleRoot, fingerprint), root, 'write');
}

async function remotionSourceFingerprint(): Promise<string> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const hash = createHash('sha256');

  for (const entry of entries
    .filter(
      (item) => item.isFile() && /^remotion-.*\.(?:ts|js)$/.test(item.name),
    )
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const filePath = path.join(currentDir, entry.name);
    const contents = await fs.readFile(filePath);
    hash.update(entry.name);
    hash.update('\0');
    hash.update(contents);
    hash.update('\0');
  }

  return hash.digest('hex').slice(0, 16);
}

async function pruneRemotionBundleDirs(
  bundleRoot: string,
  activeFingerprint: string,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(bundleRoot, { withFileTypes: true });
  } catch {
    return;
  }

  const staleDirs: Array<{ path: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === activeFingerprint) continue;
    if (!REMOTION_BUNDLE_FINGERPRINT_PATTERN.test(entry.name)) continue;

    const dirPath = path.join(bundleRoot, entry.name);
    const stats = await fs.stat(dirPath).catch(() => null);
    if (stats?.isDirectory()) {
      staleDirs.push({ path: dirPath, mtimeMs: stats.mtimeMs });
    }
  }

  const dirsToDelete = staleDirs
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(REMOTION_BUNDLE_PREVIOUS_CACHE_DIRS_TO_KEEP);
  await Promise.all(
    dirsToDelete.map((entry) =>
      fs
        .rm(entry.path, { recursive: true, force: true })
        .catch(() => undefined),
    ),
  );
}

function scaledDimensions(input: {
  width: number;
  height: number;
  maxEdgePx: number;
}): { width: number; height: number } {
  const edge = Math.max(input.width, input.height);
  if (edge <= input.maxEdgePx) {
    return { width: input.width, height: input.height };
  }
  const scale = input.maxEdgePx / edge;
  return {
    width: Math.max(1, Math.round(input.width * scale)),
    height: Math.max(1, Math.round(input.height * scale)),
  };
}

function sampleFrameTimes(input: {
  startMs: number;
  endMs: number;
  count: number;
  durationMs: number;
}): number[] {
  const start = Math.max(0, Math.min(input.startMs, input.durationMs - 1));
  const end = Math.max(start + 1, Math.min(input.endMs, input.durationMs));
  if (input.count === 1) return [Math.floor((start + end - 1) / 2)];
  const span = Math.max(1, end - start - 1);
  const times = new Set<number>();
  for (let index = 0; index < input.count; index += 1) {
    times.add(Math.round(start + (span * index) / (input.count - 1)));
  }
  return [...times].sort((a, b) => a - b);
}

function framesToMs(frames: number, fps: number): number {
  return Math.max(1, Math.round(durationFramesToMs(frames, fps)));
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}
