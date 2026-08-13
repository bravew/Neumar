import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runFFmpeg } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';

import { type BrowserHandle, acquireBrowser } from './browser';
import { HtmlEngineError } from './errors';

// Capture pipeline:
//   1. Acquire a headless Chromium (already-acquired one can be reused).
//   2. Open a context with recordVideo into a tmp dir.
//   3. file:// load the scene HTML.
//   4. Wait `durationSec * 1000` ms so opening animation completes.
//   5. Close the context → Playwright dumps a webm.
//   6. ffmpeg transmux/encode the webm → mp4 at the configured output path.
//
// This is the same shape as the upstream sample's adapter-hyperframes
// render path (_sample/html-video/packages/adapter-hyperframes/src/render.ts).
// We re-use Neuma's existing ffmpeg dispatcher rather than spawning ffmpeg
// directly, so memory budgets, retry, and shared concurrency limits all
// continue to apply.

const logger = createLogger('VideoHtmlCapture');

const MIN_DURATION_SEC = 0.1;
const MAX_DURATION_SEC = 600;

export type CaptureStage =
  | 'preparing'
  | 'launching-browser'
  | 'recording'
  | 'muxing';

export interface CaptureOptions {
  htmlPath: string;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  signal?: AbortSignal;
  onProgress?: (pct: number, stage: CaptureStage) => void;
  /** Test-only seam: re-use an already-acquired browser instead of launching. */
  browser?: BrowserHandle;
  /** Test-only seam matching acquireBrowser. */
  playwrightLoader?: () => Promise<unknown>;
  /** Test-only seam: replace `runFFmpeg`. */
  runFfmpeg?: typeof runFFmpeg;
}

export interface CaptureResult {
  outputPath: string;
  durationSec: number;
  width: number;
  height: number;
  fileSizeBytes: number;
  renderedFrames: number;
  wallClockSec: number;
}

interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightPage {
  goto(
    url: string,
    options?: { waitUntil?: string; timeout?: number },
  ): Promise<unknown>;
}

type PlaywrightBrowserShape = {
  newContext(options: {
    viewport: { width: number; height: number };
    recordVideo: { dir: string; size: { width: number; height: number } };
    deviceScaleFactor?: number;
  }): Promise<PlaywrightContext>;
};

export async function captureHtmlToMp4(
  options: CaptureOptions,
): Promise<CaptureResult> {
  if (
    !Number.isFinite(options.durationSec) ||
    options.durationSec < MIN_DURATION_SEC ||
    options.durationSec > MAX_DURATION_SEC
  ) {
    throw new HtmlEngineError(
      'duration-out-of-range',
      `durationSec ${options.durationSec} outside [${MIN_DURATION_SEC}, ${MAX_DURATION_SEC}]`,
    );
  }

  const ffmpeg = options.runFfmpeg ?? runFFmpeg;

  options.onProgress?.(5, 'preparing');
  if (options.signal?.aborted) {
    throw new HtmlEngineError(
      'browser-aborted',
      'Capture aborted before launch',
    );
  }

  // Ensure the output directory exists. The HTML scene path is asserted by
  // the caller; we don't materialise that here.
  try {
    await fs.access(options.htmlPath);
  } catch (err) {
    throw new HtmlEngineError(
      'template-source-missing',
      `HTML scene not found: ${options.htmlPath}`,
      err,
    );
  }
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });

  options.onProgress?.(10, 'launching-browser');
  const ownedBrowser = !options.browser;
  const handle =
    options.browser ??
    (await acquireBrowser({
      signal: options.signal,
      playwrightLoader: options.playwrightLoader,
    }));

  // recordVideo writes inside a tmp dir we control. UUID-suffixed so
  // concurrent renders in the same parent dir never share a record dir
  // (Date.now()+Math.random() is forbidden by CLAUDE.md § Frontend rules
  // and the same hazard applies on the server when two renders launch in
  // the same millisecond with the same Math.random() seed).
  const recordDir = path.join(
    path.dirname(options.outputPath),
    `.cap-${crypto.randomUUID()}`,
  );
  await fs.mkdir(recordDir, { recursive: true });

  const start = Date.now();
  let webmPath: string | undefined;

  try {
    const browser = handle.browser as unknown as PlaywrightBrowserShape;
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      recordVideo: {
        dir: recordDir,
        size: { width: options.width, height: options.height },
      },
      deviceScaleFactor: 1,
    });

    // Signal abort during a slow goto/wait must close the context so the
    // outer try/catch path can run cleanup without hanging. `{ once: true }`
    // so a long-lived caller signal that outlives capture doesn't leak the
    // listener (and double-close an already-closed context on the next abort).
    const onAbort = () => void context.close().catch(() => undefined);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    options.onProgress?.(15, 'recording');

    const page = await context.newPage();
    const url = pathToFileURL(options.htmlPath).toString();
    const gotoPromise = page
      .goto(url, { waitUntil: 'load', timeout: 30_000 })
      .catch((err) => {
        if (options.signal?.aborted) return undefined;
        throw err;
      });
    await raceAgainstAbort(gotoPromise, options.signal);
    if (options.signal?.aborted) {
      throw new HtmlEngineError(
        'browser-aborted',
        'Capture aborted during goto',
      );
    }

    await waitWithProgress({
      durationSec: options.durationSec,
      signal: options.signal,
      onProgress: options.onProgress,
    });

    await context.close();

    webmPath = await findWebmFile(recordDir);
    if (!webmPath) {
      throw new HtmlEngineError(
        'capture-failed',
        `No webm produced by recordVideo under ${recordDir}`,
      );
    }
  } catch (err) {
    if (err instanceof HtmlEngineError) throw err;
    if (options.signal?.aborted) {
      throw new HtmlEngineError('browser-aborted', 'Capture aborted', err);
    }
    throw new HtmlEngineError(
      'capture-failed',
      `Capture failed: ${(err as Error).message}`,
      err,
    );
  } finally {
    if (ownedBrowser) {
      await handle.close();
    }
  }

  options.onProgress?.(85, 'muxing');

  try {
    const args = [
      '-i',
      webmPath,
      '-r',
      String(options.fps),
      '-vf',
      `scale=${options.width}:${options.height},format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      options.outputPath,
    ];
    const { exitCode, stderr } = await ffmpeg(args, {
      inputDuration: options.durationSec,
      abortSignal: options.signal,
      onProgress: ({ percent }) => {
        // Map ffmpeg 0–100 into the 85–99 band.
        if (percent != null) {
          options.onProgress?.(85 + Math.floor(percent * 0.14), 'muxing');
        }
      },
    });
    if (exitCode !== 0) {
      throw new HtmlEngineError(
        'mux-failed',
        `ffmpeg exited ${exitCode}: ${stderr.split('\n').slice(-3).join(' | ')}`,
      );
    }
  } finally {
    // Best-effort cleanup of the recordVideo tmp dir.
    await fs
      .rm(recordDir, { recursive: true, force: true })
      .catch(() => undefined);
  }

  options.onProgress?.(100, 'muxing');

  const stat = await fs.stat(options.outputPath);
  const wallClockSec = (Date.now() - start) / 1000;
  const renderedFrames = Math.round(options.durationSec * options.fps);

  logger.info(
    `captureHtmlToMp4 ${options.outputPath} (${renderedFrames} frames @ ${options.fps}fps, ${wallClockSec.toFixed(2)}s wall)`,
  );

  return {
    outputPath: options.outputPath,
    durationSec: options.durationSec,
    width: options.width,
    height: options.height,
    fileSizeBytes: stat.size,
    renderedFrames,
    wallClockSec,
  };
}

async function waitWithProgress(opts: {
  durationSec: number;
  signal?: AbortSignal;
  onProgress?: (pct: number, stage: CaptureStage) => void;
}): Promise<void> {
  const totalMs = Math.max(1, Math.round(opts.durationSec * 1000));
  const start = Date.now();
  const tickMs = Math.min(250, Math.max(50, Math.floor(totalMs / 20)));

  return new Promise<void>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new HtmlEngineError('browser-aborted', 'Capture aborted'));
      return;
    }
    // `aborted` short-circuits any tick that fires between abort and the
    // microtask that clears the interval, so no progress event leaks
    // after the promise has been settled.
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      clearInterval(timer);
      reject(new HtmlEngineError('browser-aborted', 'Capture aborted'));
    };
    // `{ once: true }` matches the other engine listeners in this PR and
    // avoids holding the closure alive on a long-lived agent-scope signal.
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setInterval(() => {
      if (aborted) {
        clearInterval(timer);
        return;
      }
      const elapsed = Date.now() - start;
      if (elapsed >= totalMs) {
        clearInterval(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        resolve();
        return;
      }
      // Map elapsed in [0, totalMs] to pct in [15, 85].
      const pct = 15 + Math.floor((elapsed / totalMs) * 70);
      opts.onProgress?.(pct, 'recording');
    }, tickMs);
  });
}

function raceAgainstAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T | undefined> {
  if (!signal) return promise;
  return new Promise<T | undefined>((resolve, reject) => {
    const onAbort = () => resolve(undefined);
    if (signal.aborted) {
      resolve(undefined);
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise
      .then((v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      })
      .catch((err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

async function findWebmFile(dir: string): Promise<string | undefined> {
  const entries = await fs.readdir(dir);
  const webm = entries.find((e) => e.endsWith('.webm'));
  return webm ? path.join(dir, webm) : undefined;
}
