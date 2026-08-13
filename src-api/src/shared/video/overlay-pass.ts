import fs from 'node:fs/promises';
import path from 'node:path';

import { runFFmpeg, validatePath } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';

import { getVideoFeatureFlag } from './flags';
import { buildVividOverlayRenderEntriesWithPlugins } from './overlays/server-resolve';
import { REMOTION_OVERLAY_PASS_COMPOSITION_ID } from './remotion-constants';
import {
  buildRemotionRenderInput,
  type RemotionRenderInput,
} from './remotion-render-input';
import {
  resolveRemotionBundleDir,
  resolveRemotionEntryPoint,
} from './remotion-renderer';
import type { AspectRatio, VideoProject } from './types';

const logger = createLogger('VideoOverlayPass');

// Alpha overlay pass for final renderers that cannot draw vivid overlays
// natively (ffmpeg, webcodecs — the Remotion renderer draws them
// in-composition, below captions). The pass renders the overlay-only Remotion
// composition to ProRes 4444 (yuva444p10le — real alpha, unlike Chrome's
// WebCodecs encoder) and burns it onto the finished base video with ffmpeg's
// alpha-aware `overlay` filter.
//
// Known limitation, logged per render: on these forced paths captions are
// already part of the base video, so burned vivid overlays composite above
// captions. The default renderer selection prefers Remotion whenever vivid
// overlays are present, which keeps captions last.

export interface ApplyVividOverlayPassOptions {
  project: VideoProject;
  root: string;
  aspectRatio: AspectRatio;
  /** Finished base render; replaced in place when the pass applies. */
  outputPath: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface VividOverlayPassResult {
  applied: boolean;
  entryCount: number;
  passPath?: string;
}

export function vividOverlayEntryCount(project: VideoProject): number {
  if (!getVideoFeatureFlag('video.vividOverlays')) return 0;
  const timeline = project.timeline;
  if (!timeline) return 0;
  return buildVividOverlayRenderEntriesWithPlugins(timeline, timeline.fps || 30)
    .length;
}

export async function applyVividOverlayPass(
  options: ApplyVividOverlayPassOptions,
): Promise<VividOverlayPassResult> {
  const { project, root, aspectRatio, outputPath, signal, onProgress } =
    options;
  const entryCount = vividOverlayEntryCount(project);
  if (entryCount === 0) return { applied: false, entryCount: 0 };

  const passPath = validatePath(
    path.join(path.dirname(outputPath), 'vivid-overlay-pass.mov'),
    root,
    'write',
  );
  const inputProps = await buildRemotionRenderInput(project, {
    aspectRatio,
    includeCaptions: false,
    root,
  });
  await renderVividOverlayPassWithRemotion({
    inputProps,
    projectId: project.id,
    root,
    outputPath: passPath,
    signal,
    onProgress: (progress) => onProgress?.(Math.round(progress * 0.8)),
  });

  const burnedPath = validatePath(`${outputPath}.vivid.mp4`, root, 'write');
  await runFFmpeg(buildOverlayBurnArgs(outputPath, passPath, burnedPath), {
    abortSignal: signal,
  });
  await fs.rename(burnedPath, outputPath);
  await fs.rm(passPath, { force: true });
  onProgress?.(100);
  logger.info('video.render.vivid_overlay_pass_applied', {
    project_id: project.id,
    entry_count: entryCount,
  });
  return { applied: true, entryCount, passPath };
}

/**
 * ffmpeg args burning a transparent ProRes 4444 overlay onto a finished base
 * video. Exported for unit tests — argument shape is behavior.
 */
export function buildOverlayBurnArgs(
  basePath: string,
  overlayPath: string,
  outputPath: string,
): string[] {
  return [
    '-y',
    '-i',
    basePath,
    '-i',
    overlayPath,
    '-filter_complex',
    '[0:v][1:v]overlay=0:0:eof_action=pass:format=auto[vout]',
    '-map',
    '[vout]',
    '-map',
    '0:a?',
    '-c:a',
    'copy',
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

async function renderVividOverlayPassWithRemotion({
  inputProps,
  projectId,
  root,
  outputPath,
  signal,
  onProgress,
}: {
  inputProps: RemotionRenderInput;
  projectId: string;
  root: string;
  outputPath: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}): Promise<void> {
  const [{ bundle }, { makeCancelSignal, renderMedia, selectComposition }] =
    await Promise.all([
      import('@remotion/bundler'),
      import('@remotion/renderer'),
    ]);
  const entryPoint = await resolveRemotionEntryPoint();
  const bundleDir = await resolveRemotionBundleDir(root, projectId);
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
  try {
    const composition = await selectComposition({
      serveUrl,
      id: REMOTION_OVERLAY_PASS_COMPOSITION_ID,
      inputProps,
      logLevel: 'warn',
    });
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      outputLocation: outputPath,
      // ProRes 4444 carries real alpha; imageFormat png keeps the alpha
      // channel through frame capture (the html-video repo's missing piece).
      codec: 'prores',
      proResProfile: '4444',
      imageFormat: 'png',
      pixelFormat: 'yuva444p10le',
      overwrite: true,
      cancelSignal,
      logLevel: 'warn',
      onProgress: (progress) => onProgress?.(progress.progress),
    });
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
