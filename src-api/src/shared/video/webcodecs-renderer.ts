import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  findKeyframeTrack,
  mapAudioFadeCurveToFfmpeg,
  normalizeClipPlayback,
  normalizeKeyframeTrack,
  type ClipPlayback,
  type KeyframeTrack,
} from '@neumar/video-ir';

import { probeFile, runFFmpeg } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';

import { acquireBrowser } from './engines/html/browser';
import {
  buildRemotionRenderInput,
  type RemotionRenderAudioClip,
  type RemotionRenderInput,
  type RemotionRenderVisualClip,
} from './remotion-render-input';
import { startRenderAssetServer } from './render-asset-server';
import type { AspectRatio, VideoProject } from './types';

interface RenderProjectWithWebCodecsOptions {
  project: VideoProject;
  outputPath: string;
  aspectRatio: AspectRatio;
  mode: 'speed' | 'reproducible';
  includeCaptions: boolean;
  root: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

interface WebCodecsExportResponse {
  bytesWritten?: number;
  chunkCount?: number;
  // Stable failure code classified by the render host (shared vocabulary in
  // src/shared/utils/export-error.ts) — lets logs group encoder/network/input
  // failures without parsing messages.
  code?: string;
  error?: string;
  frames?: number;
  ok: boolean;
}

interface RenderHostExportRequest {
  data: unknown;
  endpoint: string;
  quality: 'high' | 'very_high';
}

export interface WebCodecsRenderHostAvailability {
  available: boolean;
  reason?: string;
  source: 'configured' | 'dev-default';
  url: string;
}

interface BrowserContextLike {
  close(): Promise<void>;
  newPage(): Promise<PageLike>;
}

interface PageLike {
  evaluate<T>(fn: (arg: unknown) => T | Promise<T>, arg?: unknown): Promise<T>;
  goto(url: string, options?: unknown): Promise<unknown>;
  route(
    url: string,
    handler: (route: RouteLike) => Promise<void> | void,
  ): Promise<void>;
  waitForFunction(
    fn: () => boolean,
    arg?: unknown,
    options?: unknown,
  ): Promise<unknown>;
}

interface RouteLike {
  fulfill(options: { body?: string; status: number }): Promise<void>;
  request(): { postDataBuffer(): Buffer | null };
}

type WebCodecsAudioClip =
  | {
      kind: 'audio';
      clip: RemotionRenderAudioClip;
    }
  | {
      kind: 'visual';
      clip: RemotionRenderVisualClip;
    };

const logger = createLogger('VideoWebCodecsRenderer');
const DEFAULT_RENDER_HOST_URL = 'http://127.0.0.1:3420/video-render-host';
const CHUNK_ENDPOINT = '/__neuma_video_chunk__';
const PROGRESS_POLL_MS = 750;
const RENDER_HOST_AVAILABILITY_TIMEOUT_MS = 2500;

export async function renderProjectWithWebCodecs({
  project,
  outputPath,
  aspectRatio,
  mode,
  includeCaptions,
  root,
  signal,
  onProgress,
}: RenderProjectWithWebCodecsOptions): Promise<RemotionRenderInput> {
  const renderHost = resolveRenderHost();
  if (isImplicitDevRenderHostDisabled(renderHost)) {
    throw new Error(
      'WebCodecs render host is not configured for production. Set NEUMA_VIDEO_RENDER_HOST_URL to enable browser compositor rendering.',
    );
  }
  const inputProps = await buildRemotionRenderInput(project, {
    aspectRatio,
    includeCaptions,
    root,
  });
  const assetServer = await startRenderAssetServer(inputProps);
  const videoOnlyPath = path.join(
    path.dirname(outputPath),
    `.webcodecs-${randomUUID()}.mp4`,
  );
  const file = await fs.open(videoOnlyPath, 'w');
  let fileClosed = false;
  let bytesWritten = 0;
  const browser = await acquireBrowser({ signal });
  let context: BrowserContextLike | undefined;
  let progressTimer: NodeJS.Timeout | undefined;

  try {
    context = (await browser.browser.newContext({
      deviceScaleFactor: 1,
      viewport: {
        height: assetServer.inputProps.compositionHeight,
        width: assetServer.inputProps.compositionWidth,
      },
    })) as BrowserContextLike;
    const page = await context.newPage();
    await page.route(`**${CHUNK_ENDPOINT}`, async (route) => {
      const chunk = route.request().postDataBuffer();
      if (!chunk) {
        await route.fulfill({ status: 400 });
        return;
      }
      await file.write(chunk);
      bytesWritten += chunk.byteLength;
      await route.fulfill({ status: 204 });
    });

    const renderHostUrl = renderHost.url;
    try {
      await page.goto(renderHostUrl, {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      });
    } catch (error) {
      throw new Error(
        `WebCodecs render host is unavailable at ${renderHostUrl}. Start pnpm dev:web or set NEUMA_VIDEO_RENDER_HOST_URL.`,
        { cause: error },
      );
    }
    await page.waitForFunction(
      () =>
        (globalThis as { neumaVideoRenderReady?: boolean })
          .neumaVideoRenderReady === true,
      undefined,
      { timeout: 30_000 },
    );
    progressTimer = startProgressPolling(page, onProgress);
    onProgress?.(5);

    const result = await page.evaluate<WebCodecsExportResponse>(
      async (rawRequest) => {
        const request = rawRequest as RenderHostExportRequest;
        const host = globalThis as {
          neumaVideoExport?: (
            request: RenderHostExportRequest,
          ) => Promise<unknown>;
        };
        if (!host.neumaVideoExport) {
          return {
            error: 'WebCodecs render host did not register an exporter',
            ok: false,
          };
        }
        return (await host.neumaVideoExport(
          request,
        )) as WebCodecsExportResponse;
      },
      {
        data: assetServer.inputProps,
        endpoint: CHUNK_ENDPOINT,
        quality: mode === 'reproducible' ? 'very_high' : 'high',
      },
    );
    if (!result.ok) {
      throw Object.assign(
        new Error(result.error ?? 'WebCodecs export failed'),
        {
          code: result.code ?? 'unknown',
        },
      );
    }
    if (bytesWritten <= 0) {
      throw new Error('WebCodecs export did not write any video bytes');
    }

    await file.close();
    fileClosed = true;
    await muxWebCodecsAudio({
      inputProps,
      outputPath,
      root,
      signal,
      videoOnlyPath,
    });
    onProgress?.(100);
    return inputProps;
  } catch (error) {
    logger.warn('video.webcodecs.render_failed', {
      project_id: project.id,
      error: error instanceof Error ? error.message : String(error),
      error_code:
        typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : 'unknown',
    });
    throw error;
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    if (!fileClosed) await file.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser.close();
    await assetServer.close();
    await fs.rm(videoOnlyPath, { force: true }).catch(() => {});
  }
}

export function resolveWebCodecsRenderHostUrl(): string {
  return resolveRenderHost().url;
}

export async function checkWebCodecsRenderHostAvailability({
  signal,
  timeoutMs = RENDER_HOST_AVAILABILITY_TIMEOUT_MS,
}: {
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<WebCodecsRenderHostAvailability> {
  const renderHost = resolveRenderHost();
  if (isImplicitDevRenderHostDisabled(renderHost)) {
    return {
      ...renderHost,
      available: false,
      reason:
        'implicit dev render host is disabled when NODE_ENV=production; set NEUMA_VIDEO_RENDER_HOST_URL to enable WebCodecs rendering',
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timeout.unref?.();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();

  try {
    const response = await probeRenderHost(renderHost.url, controller.signal);
    if (!response.ok) {
      return {
        ...renderHost,
        available: false,
        reason: `render host responded with HTTP ${response.status}`,
      };
    }
    return { ...renderHost, available: true };
  } catch (error) {
    const reason = timedOut
      ? `render host probe timed out after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error);
    return { ...renderHost, available: false, reason };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function probeRenderHost(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  const headResponse = await fetch(url, { method: 'HEAD', signal });
  if (headResponse.status !== 405) return headResponse;
  const getResponse = await fetch(url, {
    headers: { Accept: 'text/html' },
    method: 'GET',
    signal,
  });
  try {
    await getResponse.body?.cancel();
  } catch {
    // The route answered; a body cancellation failure should not mark it down.
  }
  return getResponse;
}

function isImplicitDevRenderHostDisabled(
  renderHost: Omit<WebCodecsRenderHostAvailability, 'available' | 'reason'>,
): boolean {
  return (
    renderHost.source === 'dev-default' && process.env.NODE_ENV === 'production'
  );
}

function resolveRenderHost(): Omit<
  WebCodecsRenderHostAvailability,
  'available' | 'reason'
> {
  const configured =
    process.env.NEUMA_VIDEO_RENDER_HOST_URL?.trim() ||
    process.env.NEUMA_WEB_RENDER_HOST_URL?.trim();
  if (!configured) {
    return { source: 'dev-default', url: DEFAULT_RENDER_HOST_URL };
  }
  if (/\/video-render-host(?:[?#]|$)/.test(configured)) {
    return { source: 'configured', url: configured };
  }
  try {
    return {
      source: 'configured',
      url: new URL('/video-render-host', configured).toString(),
    };
  } catch {
    return { source: 'configured', url: configured };
  }
}

function startProgressPolling(
  page: PageLike,
  onProgress?: (progress: number) => void,
): NodeJS.Timeout | undefined {
  if (!onProgress) return undefined;
  const timer = setInterval(() => {
    void page
      .evaluate<number>(() =>
        typeof (globalThis as { neumaVideoExportProgress?: number })
          .neumaVideoExportProgress === 'number'
          ? (globalThis as { neumaVideoExportProgress?: number })
              .neumaVideoExportProgress!
          : 0,
      )
      .then((progress) => {
        onProgress(5 + Math.round(Math.max(0, Math.min(1, progress)) * 85));
      })
      .catch(() => {});
  }, PROGRESS_POLL_MS);
  timer.unref?.();
  return timer;
}

async function muxWebCodecsAudio({
  inputProps,
  outputPath,
  root,
  signal,
  videoOnlyPath,
}: {
  inputProps: RemotionRenderInput;
  outputPath: string;
  root: string;
  signal?: AbortSignal;
  videoOnlyPath: string;
}): Promise<void> {
  const totalDurationSec = inputProps.durationInFrames / inputProps.fps;
  const audioClips = await collectRenderableAudioClips(inputProps, root);
  await fs.rm(outputPath, { force: true });
  if (audioClips.length === 0) {
    await fs.rename(videoOnlyPath, outputPath);
    return;
  }

  const inputArgs = ['-i', videoOnlyPath];
  const filters: string[] = [];
  const labels: string[] = [];
  for (const [index, audioClip] of audioClips.entries()) {
    inputArgs.push('-i', audioSourcePath(audioClip));
    const label = `a${index}`;
    labels.push(`[${label}]`);
    filters.push(
      `[${index + 1}:a]${audioClipFilters(audioClip, inputProps.fps, totalDurationSec)}[${label}]`,
    );
  }
  const mixedLabel = 'aout';
  filters.push(
    `${mixAudioLabels(labels, totalDurationSec, inputProps)}[${mixedLabel}]`,
  );

  const result = await runFFmpeg(
    [
      ...inputArgs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '0:v:0',
      '-map',
      `[${mixedLabel}]`,
      '-c:v',
      'copy',
      ...audioCodecArgs(),
      '-shortest',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    {
      abortSignal: signal,
      inputDuration: totalDurationSec,
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `WebCodecs audio mux failed: ${result.stderr.slice(0, 500)}`,
    );
  }
}

async function collectRenderableAudioClips(
  inputProps: RemotionRenderInput,
  root: string,
): Promise<WebCodecsAudioClip[]> {
  const audioClips: WebCodecsAudioClip[] = inputProps.audioClips
    .filter(
      (clip) =>
        !clip.muted &&
        !clip.trackMuted &&
        !normalizeClipPlayback(clip.playback).reverse,
    )
    .map((clip) => ({ clip, kind: 'audio' }));

  const probeCache = new Map<string, Awaited<ReturnType<typeof probeFile>>>();
  for (const clip of inputProps.visualClips) {
    if (
      clip.mediaKind !== 'video' ||
      clip.muted ||
      normalizeClipPlayback(clip.playback).reverse
    ) {
      continue;
    }
    let probe = probeCache.get(clip.sourcePath);
    if (!probe) {
      probe = await probeFile(clip.sourcePath, root, {
        allowExternalMedia: clip.sourceIsExternal,
      });
      probeCache.set(clip.sourcePath, probe);
    }
    if ((probe.audioStreamCount ?? 0) > 0) {
      audioClips.push({ clip, kind: 'visual' });
    }
  }

  return audioClips.sort((left, right) => {
    const leftFrame = audioFromFrame(left);
    const rightFrame = audioFromFrame(right);
    return (
      leftFrame - rightFrame ||
      audioSourcePath(left).localeCompare(audioSourcePath(right))
    );
  });
}

function audioClipFilters(
  audioClip: WebCodecsAudioClip,
  fps: number,
  totalDurationSec: number,
): string {
  const clip = audioClip.clip;
  const playback = normalizeClipPlayback(clip.playback);
  const outputDurationSec = Math.max(0.001, clip.durationInFrames / fps);
  const timelineStartMs = Math.max(
    0,
    Math.round((clip.fromFrame / fps) * 1000),
  );
  const sourceStartSec = Math.max(0, clip.sourceStartFrame / fps);
  const sourceDuration = Math.min(
    Math.max(0.001, (clip.sourceEndFrame - clip.sourceStartFrame) / fps),
    Math.max(0.001, outputDurationSec * playback.speed),
  );
  const filters = [
    `atrim=start=${formatSeconds(sourceStartSec)}:duration=${formatSeconds(sourceDuration)}`,
    ...audioPlaybackFilters(clip.playback),
    audioFormatFilter(),
    audioVolumeFilter(audioClip),
  ];
  const fadeInSec = clampedFadeSec(
    framesToMs(
      audioClip.kind === 'audio' ? audioClip.clip.fadeInFrames : undefined,
      fps,
    ),
    outputDurationSec,
  );
  const fadeOutSec = clampedFadeSec(
    framesToMs(
      audioClip.kind === 'audio' ? audioClip.clip.fadeOutFrames : undefined,
      fps,
    ),
    outputDurationSec,
  );
  if (fadeInSec > 0) {
    filters.push(
      `afade=t=in:st=0:d=${formatSeconds(fadeInSec)}:curve=${mapAudioFadeCurveToFfmpeg(
        audioClip.kind === 'audio' ? audioClip.clip.fadeInCurve : undefined,
        'in',
      )}`,
    );
  }
  if (fadeOutSec > 0) {
    filters.push(
      `afade=t=out:st=${formatSeconds(Math.max(0, outputDurationSec - fadeOutSec))}:d=${formatSeconds(
        fadeOutSec,
      )}:curve=${mapAudioFadeCurveToFfmpeg(
        audioClip.kind === 'audio' ? audioClip.clip.fadeOutCurve : undefined,
        'out',
      )}`,
    );
  }
  filters.push(
    'asetpts=PTS-STARTPTS',
    `adelay=${timelineStartMs}|${timelineStartMs}`,
    `apad=whole_dur=${formatSeconds(totalDurationSec)}`,
    `atrim=duration=${formatSeconds(totalDurationSec)}`,
  );
  return filters.join(',');
}

function mixAudioLabels(
  labels: string[],
  totalDurationSec: number,
  inputProps: RemotionRenderInput,
): string {
  const postFilters = [
    bookendAudioFilters(
      totalDurationSec,
      inputProps.introFrames,
      inputProps.outroFrames,
      inputProps.fps,
    ),
    audioFormatFilter(),
    `atrim=duration=${formatSeconds(totalDurationSec)}`,
    'asetpts=PTS-STARTPTS',
  ].filter(Boolean);
  if (labels.length === 1) {
    return `${labels[0]!}${postFilters.join(',')}`;
  }
  const mix = `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,alimiter=limit=0.95`;
  return `${mix},${postFilters.join(',')}`;
}

function audioSourcePath(audioClip: WebCodecsAudioClip): string {
  return audioClip.clip.sourcePath;
}

function audioFromFrame(audioClip: WebCodecsAudioClip): number {
  return audioClip.clip.fromFrame;
}

function audioVolumeFilter(audioClip: WebCodecsAudioClip): string {
  if (audioClip.kind === 'visual') return 'volume=1';

  const clip = audioClip.clip;
  const legacyVolume =
    clip.gainDb === undefined &&
    clip.trackVolumeDb === undefined &&
    !clip.keyframes
      ? clip.volume
      : 1;
  const staticDb = (clip.trackVolumeDb ?? 0) + (clip.gainDb ?? 0);
  const staticGain = legacyVolume * dbToVolume(staticDb);
  const volumeTrack = findKeyframeTrack(clip.keyframes, 'volumeDb');
  if (!volumeTrack) return `volume=${formatVolume(staticGain)}`;
  const volumeDbExpression = ffmpegVolumeDbExpression(volumeTrack);
  if (!volumeDbExpression) return `volume=${formatVolume(staticGain)}`;
  const expression = `min(2,${formatExpressionNumber(staticGain)}*pow(10,(${volumeDbExpression})/20))`;
  return `volume='${escapeFilterExpression(expression)}':eval=frame`;
}

function ffmpegVolumeDbExpression(track: KeyframeTrack): string | null {
  const keys = normalizeKeyframeTrack(track).keys;
  if (keys.length === 0) return null;
  if (keys.length === 1) return formatExpressionNumber(keys[0]!.value);

  let expression = formatExpressionNumber(keys[keys.length - 1]!.value);
  for (let index = keys.length - 2; index >= 0; index -= 1) {
    const left = keys[index]!;
    const right = keys[index + 1]!;
    const leftSec = formatExpressionNumber(left.atMs / 1000);
    const rightSec = formatExpressionNumber(right.atMs / 1000);
    const segment = ffmpegVolumeKeyframeSegmentExpression(left, right);
    expression = `if(lt(t,${rightSec}),if(lte(t,${leftSec}),${formatExpressionNumber(left.value)},${segment}),${expression})`;
  }
  return expression;
}

function ffmpegVolumeKeyframeSegmentExpression(
  left: KeyframeTrack['keys'][number],
  right: KeyframeTrack['keys'][number],
): string {
  const spanMs = right.atMs - left.atMs;
  if (spanMs <= 0 || (left.interp ?? 'linear') === 'hold') {
    return formatExpressionNumber(left.value);
  }
  const leftValue = formatExpressionNumber(left.value);
  const delta = formatExpressionNumber(right.value - left.value);
  const progress = `((t-${formatExpressionNumber(left.atMs / 1000)})/${formatExpressionNumber(spanMs / 1000)})`;
  const t =
    left.interp === 'smooth'
      ? `(${progress}*${progress}*(3-2*${progress}))`
      : progress;
  return `(${leftValue}+${delta}*${t})`;
}

function audioPlaybackFilters(playback?: ClipPlayback): string[] {
  const normalized = normalizeClipPlayback(playback);
  return [
    ...(normalized.reverse ? ['areverse'] : []),
    ...audioTempoFilters(normalized.speed),
  ];
}

function audioTempoFilters(speed: number): string[] {
  if (Math.abs(speed - 1) <= 0.0001) return [];
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 2) {
    filters.push('atempo=2');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 0.0001) {
    filters.push(`atempo=${formatSeconds(remaining)}`);
  }
  return filters;
}

function bookendAudioFilters(
  totalDurationSec: number,
  introFrames: number | undefined,
  outroFrames: number | undefined,
  fps: number,
): string | undefined {
  const introSec = bookendFadeSec(
    framesToMs(introFrames, fps),
    totalDurationSec,
  );
  const outroSec = bookendFadeSec(
    framesToMs(outroFrames, fps),
    totalDurationSec,
  );
  const filters: string[] = [];
  if (introSec > 0) {
    filters.push(`afade=t=in:st=0:d=${formatSeconds(introSec)}`);
  }
  if (outroSec > 0) {
    filters.push(
      `afade=t=out:st=${formatSeconds(Math.max(0, totalDurationSec - outroSec))}:d=${formatSeconds(
        outroSec,
      )}`,
    );
  }
  return filters.length ? filters.join(',') : undefined;
}

function framesToMs(
  frames: number | undefined,
  fps: number,
): number | undefined {
  return frames && frames > 0 ? (frames / fps) * 1000 : undefined;
}

function bookendFadeSec(
  durationMs: number | undefined,
  totalDurationSec: number,
): number {
  if (!durationMs || durationMs <= 0 || totalDurationSec <= 0) return 0;
  const clampedMs = Math.min(3000, Math.max(33, durationMs));
  return Math.min(clampedMs / 1000, totalDurationSec / 2);
}

function clampedFadeSec(
  fadeMs: number | undefined,
  durationSec: number,
): number {
  if (!fadeMs || fadeMs <= 0) return 0;
  return Math.min(fadeMs / 1000, Math.max(0, durationSec / 2));
}

function audioFormatFilter(): string {
  return 'aformat=sample_rates=48000:channel_layouts=stereo';
}

function audioCodecArgs(): string[] {
  return ['-c:a', 'aac', '-ar', '48000', '-ac', '2'];
}

function dbToVolume(db: number): number {
  return Math.max(0, Math.min(2, 10 ** (db / 20)));
}

function formatVolume(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function escapeFilterExpression(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/,/g, '\\,');
}

function formatSeconds(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatExpressionNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}
