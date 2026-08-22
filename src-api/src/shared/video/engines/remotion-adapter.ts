import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { frameRateToNumber } from '@neumar/video-ir';
import { bundle } from '@remotion/bundler';
import {
  makeCancelSignal,
  renderMedia,
  selectComposition,
} from '@remotion/renderer';

import { REMOTION_HTML_FRAME_COMPOSITION_ID } from './remotion/bridge-composition';
import {
  type EngineNativeTemplateRef,
  type EngineRenderContext,
  type EngineRenderInput,
  type EngineRenderOutput,
  type EngineTemplateRef,
  type EngineValidationResult,
  type VideoEngineAdapter,
  type VideoEngineCapabilities,
} from './types';

const REMOTION_CAPABILITIES: VideoEngineCapabilities = {
  paradigms: ['react-tsx', 'html-css-gsap'],
  outputFormats: ['mp4', 'webm'],
  maxResolution: { width: 3840, height: 2160 },
  alpha: false,
  audio: 'multi',
  subtitles: 'burn-in',
  renderTarget: ['local-node'],
  fps: [
    { num: 24, den: 1 },
    { num: 30, den: 1 },
    { num: 60, den: 1 },
  ],
  licensing: 'MIT (Remotion); see Remotion company-license rules',
  bestFor: [
    'React-controlled animation',
    'deterministic data frames',
    'HTML frame bridge rendering',
  ],
  weaknesses: [
    'Commercial license required for larger teams',
    'HTML bridge requires animation time-driver sync',
  ],
};

const ENGINE_VERSION = 'remotion-direct/0.1.0';
const MIN_DURATION_SEC = 0.1;
const AUTO_DURATION_SEC = 5;
const REMOTION_CANCEL_MESSAGES = [
  'renderMedia() got cancelled',
  'renderFrames() got cancelled',
  'renderStill() got cancelled',
  'stitchFramesToVideo() got cancelled',
];

export interface RemotionAdapterDeps {
  /** Test seam: override expensive Remotion bundling. */
  bundleProject?: typeof bundle;
  /** Test seam: override Remotion composition selection. */
  selectComposition?: typeof selectComposition;
  /** Test seam: override Remotion media render. */
  renderMedia?: typeof renderMedia;
  /** Test seam: override Remotion cancellation token creation. */
  makeCancelSignal?: typeof makeCancelSignal;
}

export function createRemotionAdapter(
  deps: RemotionAdapterDeps = {},
): VideoEngineAdapter {
  const bundleProject = deps.bundleProject ?? bundle;
  const select = deps.selectComposition ?? selectComposition;
  const render = deps.renderMedia ?? renderMedia;
  const createCancelSignal = deps.makeCancelSignal ?? makeCancelSignal;

  return {
    id: 'remotion',
    name: 'Remotion',
    upstreamVersion: ENGINE_VERSION,
    capabilities: REMOTION_CAPABILITIES,
    probeAvailability: () => ({ installed: true, version: ENGINE_VERSION }),
    validate(template: EngineTemplateRef): EngineValidationResult {
      const issues: EngineValidationResult['issues'] = [];
      if (!template.sourcePath) {
        issues.push({
          code: 'missing-source-path',
          message:
            'EngineTemplateRef.sourcePath is required for the remotion engine',
          severity: 'error',
        });
      }
      if (template.mode === 'native' && !template.nativeCompositionId) {
        issues.push({
          code: 'missing-native-composition-id',
          message: 'Native remotion templates require nativeCompositionId',
          severity: 'error',
        });
      }
      return { ok: issues.every((i) => i.severity !== 'error'), issues };
    },
    async render(
      input: EngineRenderInput,
      ctx: EngineRenderContext,
    ): Promise<EngineRenderOutput> {
      const start = Date.now();
      const durationSec = resolveDurationSec(input);
      const fps = frameRateToNumber(input.config.fps);
      const durationInFrames = Math.max(1, Math.round(durationSec * fps));
      const { width, height } = input.config.resolution;

      await fs.mkdir(path.dirname(input.config.outputPath), {
        recursive: true,
      });
      const tmpDir = path.join(ctx.workDir, 'remotion-tmp');
      await fs.mkdir(tmpDir, { recursive: true });
      const tmpOut = path.join(
        tmpDir,
        `${safeFileStem(input.template.id)}-${randomUUID()}.${input.config.format === 'webm' ? 'webm' : 'mp4'}`,
      );

      const entryPoint =
        input.template.mode === 'native'
          ? input.template.sourcePath
          : resolveBridgeEntryPoint();
      const compositionId =
        input.template.mode === 'native'
          ? input.template.nativeCompositionId
          : REMOTION_HTML_FRAME_COMPOSITION_ID;

      ctx.onProgress?.(5, 'preparing');
      const serveUrl = await bundleProject({
        entryPoint,
        outDir: path.join(ctx.workDir, 'remotion-bundle', cacheKey(entryPoint)),
        enableCaching: true,
      });

      const inputProps =
        input.template.mode === 'native'
          ? nativeInputProps(input.template, input, {
              width,
              height,
              fps,
              durationInFrames,
            })
          : await bridgeInputProps(input, {
              width,
              height,
              fps,
              durationInFrames,
            });

      const { cancelSignal, cancel } = createCancelSignal();
      const abort = () => cancel();
      if (ctx.signal?.aborted) abort();
      ctx.signal?.addEventListener('abort', abort, { once: true });

      try {
        ctx.onProgress?.(15, 'preparing');
        const composition = await select({
          serveUrl,
          id: compositionId,
          inputProps,
          logLevel: 'warn',
        });
        await render({
          serveUrl,
          composition,
          inputProps,
          codec: input.config.format === 'webm' ? 'vp8' : 'h264',
          outputLocation: tmpOut,
          overwrite: true,
          cancelSignal,
          logLevel: 'warn',
          onProgress: ({ progress }) => {
            ctx.onProgress?.(20 + Math.round(progress * 75), 'rendering');
          },
        });
        await fs.rename(tmpOut, input.config.outputPath).catch(async () => {
          await fs.copyFile(tmpOut, input.config.outputPath);
        });
      } catch (err) {
        if (isRenderCancellationError(err)) {
          throw new RemotionEngineError('cancelled', 'Remotion render aborted');
        }
        throw new RemotionEngineError(
          'render-failed',
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        ctx.signal?.removeEventListener('abort', abort);
        await fs.rm(tmpOut, { force: true }).catch(() => {});
      }

      const stat = await fs.stat(input.config.outputPath);
      ctx.onProgress?.(100, 'muxing');
      return {
        outputPath: input.config.outputPath,
        meta: {
          durationSec,
          fileSizeBytes: stat.size,
          actualResolution: input.config.resolution,
          fps,
          renderedFrames: durationInFrames,
          renderWallClockSec: (Date.now() - start) / 1000,
          engineVersion: ENGINE_VERSION,
        },
        diagnostics: [],
      };
    },
  };
}

export class RemotionEngineError extends Error {
  constructor(
    public readonly code: 'cancelled' | 'render-failed',
    message: string,
  ) {
    super(message);
    this.name = 'RemotionEngineError';
  }
}

export function neutralizeBlockingResources(html: string): string {
  return html.replace(
    /<link\b[^>]*\brel=(["']?)stylesheet\1[^>]*>/gi,
    (tag) => {
      if (!/\bhref=(["'])(?:https?:)?\/\//i.test(tag)) return tag;
      if (/\bmedia=/i.test(tag)) return tag;
      return tag.replace(
        /\s*\/?>$/,
        ` media="print" onload="this.media='all'">`,
      );
    },
  );
}

function resolveDurationSec(input: EngineRenderInput): number {
  if (input.config.duration === 'auto') return AUTO_DURATION_SEC;
  const n = Number(input.config.duration);
  if (!Number.isFinite(n)) return AUTO_DURATION_SEC;
  return Math.max(MIN_DURATION_SEC, n);
}

function isRemotionCancelledRender(err: unknown): boolean {
  return (
    err instanceof Error &&
    REMOTION_CANCEL_MESSAGES.some((message) => err.message.includes(message))
  );
}

function isRenderCancellationError(err: unknown): boolean {
  if (isRemotionCancelledRender(err)) return true;
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;

  const message = err.message.toLowerCase();
  return (
    message.includes('aborted') ||
    message.includes('cancelled') ||
    message.includes('canceled')
  );
}

function nativeInputProps(
  _template: EngineNativeTemplateRef,
  input: EngineRenderInput,
  renderMeta: {
    width: number;
    height: number;
    fps: number;
    durationInFrames: number;
  },
): Record<string, unknown> {
  return {
    ...(input.variables ?? {}),
    ...renderMeta,
  };
}

async function bridgeInputProps(
  input: EngineRenderInput,
  renderMeta: {
    width: number;
    height: number;
    fps: number;
    durationInFrames: number;
  },
): Promise<Record<string, unknown>> {
  const rawHtml = await fs.readFile(input.template.sourcePath, 'utf8');
  return {
    html: neutralizeBlockingResources(rawHtml),
    ...renderMeta,
  };
}

function resolveBridgeEntryPoint(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'remotion', 'bridge-entry.ts'),
    path.join(here, 'remotion', 'bridge-entry.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Remotion bridge entry not found; checked ${candidates.join(', ')}`,
  );
}

function cacheKey(entryPoint: string): string {
  const stem = safeFileStem(path.basename(entryPoint)).slice(0, 48) || 'entry';
  const digest = createHash('sha256').update(entryPoint).digest('hex');
  return `${stem}-${digest.slice(0, 16)}`;
}

function safeFileStem(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, '_');
}
