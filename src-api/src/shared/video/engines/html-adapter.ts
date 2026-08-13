import path from 'node:path';

import { hashHtmlFrameSeed } from '@/shared/video/content-graph/frame-seed-hash';

import { captureHtmlToMp4 } from './html/capture';
import { HtmlEngineError } from './html/errors';
import { buildHtmlScene } from './html/render-to-html';
import type {
  EngineRenderContext,
  EngineRenderInput,
  EngineRenderOutput,
  EngineTemplateRef,
  EngineValidationResult,
  HtmlSceneOutput,
  VideoEngineAdapter,
  VideoEngineCapabilities,
} from './types';

// Phase 1 M3 + M4 — real HTML video render via Playwright + ffmpeg.
//
// Re-resolved against sample HEAD `1a832796`: the upstream adapter no longer
// depends on `@hyperframes/engine`; it uses Playwright directly. We mirror
// that choice (and reuse Neuma's own DesignMode pattern). The full rationale
// lives in dev-doc/html-video/06-05/SPIKE-REPORT.md.
//
// The legacy stub error class is retained as an export so any external
// caller importing it from prior PR #230 continues to compile, but it is
// no longer thrown by this adapter.

const HTML_CAPABILITIES: VideoEngineCapabilities = {
  paradigms: ['html-css-gsap'],
  outputFormats: ['mp4', 'webm'],
  maxResolution: { width: 3840, height: 2160 },
  alpha: false,
  audio: 'multi',
  subtitles: 'burn-in',
  renderTarget: ['local-chromium'],
  fps: [24, 30, 60],
  licensing: 'Apache-2.0 (playwright)',
  bestFor: ['Animated HTML frames', 'GSAP / CSS @keyframes templates'],
  weaknesses: [
    'Real-time capture is frame-accurate but not byte-deterministic across hosts',
  ],
};

export class HtmlEngineNotImplementedError extends Error {
  constructor() {
    super(
      'HTML video engine implementation is unavailable in this build. ' +
        'See dev-doc/html-video/06-06/01-render-path-plan.md.',
    );
    this.name = 'HtmlEngineNotImplementedError';
  }
}

const ENGINE_VERSION = 'html-playwright/0.1.0';

/**
 * Fallback duration used when `RenderInput.config.duration === 'auto'`.
 * Matches the upstream sample default and our spike report: short enough
 * to keep auto renders cheap, long enough for a typical opening animation.
 */
const AUTO_DURATION_SEC = 5;

const MIN_DURATION_SEC = 0.1;
const MAX_DURATION_SEC = 600;

export interface HtmlAdapterDeps {
  /** Test-only seam: inject a stub `import('playwright')` module. */
  playwrightLoader?: () => Promise<unknown>;
  /** Test-only seam matching captureHtmlToMp4. */
  capture?: typeof captureHtmlToMp4;
  /** Test-only seam matching buildHtmlScene. */
  buildScene?: typeof buildHtmlScene;
}

export function createHtmlAdapter(
  deps: HtmlAdapterDeps = {},
): VideoEngineAdapter {
  const capture = deps.capture ?? captureHtmlToMp4;
  const buildScene = deps.buildScene ?? buildHtmlScene;

  return {
    id: 'html',
    name: 'HTML (Playwright)',
    upstreamVersion: ENGINE_VERSION,
    capabilities: HTML_CAPABILITIES,
    isInstalled: async () => {
      if (deps.playwrightLoader) {
        try {
          const mod = (await deps.playwrightLoader()) as {
            chromium?: unknown;
          };
          return typeof mod.chromium === 'object' && mod.chromium !== null;
        } catch {
          return false;
        }
      }
      // Same dual-load fallback as src-api/src/app/api/design.ts.
      try {
        const mod = (await import('playwright')) as { chromium?: unknown };
        if (typeof mod.chromium === 'object' && mod.chromium !== null)
          return true;
      } catch {
        /* fall through */
      }
      try {
        const mod = (await import('@playwright/test')) as {
          chromium?: unknown;
        };
        return typeof mod.chromium === 'object' && mod.chromium !== null;
      } catch {
        return false;
      }
    },
    validate(template: EngineTemplateRef): EngineValidationResult {
      const issues: EngineValidationResult['issues'] = [];
      if (!template.sourcePath) {
        issues.push({
          code: 'missing-source-path',
          message:
            'EngineTemplateRef.sourcePath is required for the html engine',
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
      const sceneOutDir = path.join(ctx.workDir, `scene-${input.template.id}`);

      ctx.onProgress?.(2, 'preparing');
      const scene = await buildScene({
        templateSourcePath: input.template.sourcePath,
        variables: input.variables,
        durationSec,
        outDir: sceneOutDir,
      });

      const result = await capture({
        htmlPath: scene.htmlPath,
        outputPath: input.config.outputPath,
        width: input.config.resolution.width,
        height: input.config.resolution.height,
        fps: input.config.fps,
        durationSec,
        signal: ctx.signal,
        playwrightLoader: deps.playwrightLoader,
        onProgress: (pct, stage) => {
          // Capture's 0..100 maps onto the adapter's three stages.
          if (stage === 'preparing' || stage === 'launching-browser') {
            ctx.onProgress?.(pct, 'preparing');
          } else if (stage === 'recording') {
            ctx.onProgress?.(pct, 'rendering');
          } else {
            ctx.onProgress?.(pct, 'muxing');
          }
        },
      });

      return {
        outputPath: result.outputPath,
        meta: {
          durationSec: result.durationSec,
          fileSizeBytes: result.fileSizeBytes,
          actualResolution: { width: result.width, height: result.height },
          fps: input.config.fps,
          renderedFrames: result.renderedFrames,
          renderWallClockSec: (Date.now() - start) / 1000,
          engineVersion: ENGINE_VERSION,
          inputHash: hashHtmlFrameSeed({
            // The adapter is called per-frame from the materializer, which
            // is the only layer that knows the content-graph nodeId. From
            // the adapter's perspective the render input is identified by
            // the template id alone — `nodeId` is filled with that as a
            // stand-in so the audit-only hash here stays defined.
            // Cache correctness is unaffected: the materializer's cache
            // key uses the real nodeId from scene.htmlFrameSeed.
            seed: {
              nodeId: input.template.id,
              templateId: input.template.id,
              engine: input.template.engineId,
              variables: input.variables,
            },
            templateSourcePath: input.template.sourcePath,
            templateVersion: input.template.version ?? '',
            engineVersion: ENGINE_VERSION,
            resolution: input.config.resolution,
            fps: input.config.fps,
            durationSec,
            injectionNonce: scene.injectionNonce,
          }),
        },
        diagnostics: [],
      };
    },
    async renderToHtml(
      input: EngineRenderInput,
      ctx: EngineRenderContext,
    ): Promise<HtmlSceneOutput> {
      if (ctx.signal?.aborted) {
        throw new HtmlEngineError(
          'browser-aborted',
          'renderToHtml aborted before start',
        );
      }
      const durationSec = resolveDurationSec(input);
      const sceneOutDir = path.join(ctx.workDir, `scene-${input.template.id}`);
      const scene = await buildScene({
        templateSourcePath: input.template.sourcePath,
        variables: input.variables,
        durationSec,
        outDir: sceneOutDir,
      });
      return {
        htmlPath: scene.htmlPath,
        referencedAssets: scene.referencedAssets,
        durationSec: scene.durationSec,
      };
    },
  };
}

function resolveDurationSec(input: EngineRenderInput): number {
  if (input.config.duration === 'auto') return AUTO_DURATION_SEC;
  return Math.max(
    MIN_DURATION_SEC,
    Math.min(MAX_DURATION_SEC, Number(input.config.duration)),
  );
}

// hashInput was lifted into @/shared/video/content-graph/frame-seed-hash.ts
// (`hashHtmlFrameSeed`) so the render cache key in pipeline.ts (Phase 1 M5)
// can share the same deterministic shape.
