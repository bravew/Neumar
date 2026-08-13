import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '@/shared/utils/logger';
import { type VideoEngineAdapter } from '@/shared/video/engines';
import type {
  EngineRenderContext,
  EngineRenderInput,
} from '@/shared/video/engines/types';
import type { GalleryTemplate } from '@/shared/video/templates/gallery-loader';
import type {
  MediaItem,
  Storyboard,
  StoryboardScene,
} from '@/shared/video/types';

import {
  HTML_FRAME_PLACEHOLDER_ASSET_ID,
  type CompiledStoryboard,
} from './compile';
import { hashHtmlFrameSeed } from './frame-seed-hash';
import {
  resolveSceneRenderPlan,
  resolveTemplateSourcePath,
} from './render-plan';

// Phase 2 M2 bonus — HTML scene materializer.
//
// Walks the storyboard produced by `compileContentGraphToStoryboard`, renders
// each scene's HTML frame to an MP4 segment via the html engine, registers
// a MediaItem per segment, and fills `scene.assetPlan.assetId` so the
// existing `pipeline.ts` concat path can consume the result unchanged.
//
// Render is sequential by design — the existing render queue enforces "one
// active render per project" (see `pipeline.ts`); the materializer respects
// the same backpressure within a single project.

const logger = createLogger('VideoHtmlMaterializer');

export interface MaterializeOptions {
  template: GalleryTemplate;
  /** Resolve per-scene native render overrides by template id. */
  resolveTemplate?: (templateId: string) => Promise<GalleryTemplate>;
  /** Working directory: per-project cache root. */
  workDir: string;
  renderConfig: { width: number; height: number; fps: number };
  signal?: AbortSignal;
  onProgress?: (sceneIdx: number, total: number, pct: number) => void;
  /** Test-only seam: pre-resolved adapter instead of registry lookup. */
  adapter?: VideoEngineAdapter;
  /** Test-only seam: clock for deterministic MediaItem ids/timestamps. */
  now?: () => Date;
  /** Test-only seam: id generator for MediaItem. */
  newId?: () => string;
}

export interface MaterializeResult {
  storyboard: Storyboard;
  mediaItems: MediaItem[];
  /** sceneId → MediaItem id (for fast lookups). */
  sceneIdToAssetId: Record<string, string>;
}

export async function materializeHtmlStoryboard(
  compiled: CompiledStoryboard,
  options: MaterializeOptions,
): Promise<MaterializeResult> {
  const newId = options.newId ?? (() => crypto.randomUUID());

  // The base template's source-entry path lives next to the metadata file.
  const templateSourcePath = resolveTemplateSourcePath(options.template);

  // Per-frame HTML overrides live at `<workDir>/frames/<nodeId>.html` (the
  // queue prepass passes the project dir as workDir; the agent's
  // `video_write_frame_html` MCP tool persists overrides there). When an
  // override exists for a scene's nodeId, it is used as the source HTML
  // instead of the template's source/index.html. Variable injection still
  // runs on top so `window.__NEUMA_VARS__` is consistent across both paths.
  const framesDir = path.join(options.workDir, 'frames');
  const resolveFrameOverridePath = async (
    nodeId: string,
  ): Promise<{ path: string; sha256: string } | null> => {
    const overridePath = path.join(framesDir, `${nodeId}.html`);
    try {
      const body = await fs.readFile(overridePath, 'utf8');
      return {
        path: overridePath,
        sha256: createHash('sha256').update(body).digest('hex').slice(0, 16),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  };

  const total = compiled.storyboard.scenes.length;
  const outScenes: StoryboardScene[] = [];
  const mediaItems: MediaItem[] = [];
  const sceneIdToAssetId: Record<string, string> = {};

  for (let idx = 0; idx < total; idx++) {
    if (options.signal?.aborted) {
      throw new Error('materializeHtmlStoryboard aborted');
    }

    const scene = compiled.storyboard.scenes[idx]!;
    if (!scene.htmlFrameSeed) {
      // Non-HTML scene — pass through. The lowering compiler only emits
      // html-seeded scenes today, so this is a future-proof skip.
      outScenes.push(scene);
      continue;
    }

    const override = await resolveFrameOverridePath(scene.htmlFrameSeed.nodeId);
    const renderPlan = await resolveSceneRenderPlan({
      seed: scene.htmlFrameSeed,
      baseTemplate: options.template,
      baseTemplateSourcePath: templateSourcePath,
      bridgeOverride: override,
      resolveTemplate: options.resolveTemplate,
      adapter: options.adapter,
    });

    // Cache key — same shape as html-adapter's inputHash, minus the per-run
    // injection nonce. Identical seed + template + engine + resolution + fps
    // + duration + override-bytes → identical MP4 (within capture tolerance),
    // so we can re-use a prior render and skip Playwright entirely. An
    // edited override changes its sha256, invalidating the cache.
    const cacheKey = hashHtmlFrameSeed({
      seed: scene.htmlFrameSeed,
      templateSourcePath: renderPlan.sourcePath,
      templateVersion: renderPlan.version,
      engineVersion: renderPlan.adapter.upstreamVersion,
      resolution: {
        width: options.renderConfig.width,
        height: options.renderConfig.height,
      },
      fps: options.renderConfig.fps,
      durationSec: scene.durationMs / 1000,
    });

    const cachedDir = path.join(options.workDir, 'cache', 'html-frames');
    await fs.mkdir(cachedDir, { recursive: true });
    const cachedPath = path.join(cachedDir, `${cacheKey}.mp4`);
    // Defence in depth: the lowering compiler already constrains scene.id to
    // `cg-<slug>` where slug must match `^[\w][\w.-]*$` (so `..` cannot
    // appear as a leading segment), but a future refactor could weaken
    // that. Reject any id that would escape the workDir before writing.
    assertSlugSafePathSegment(scene.id);
    const outputPath = path.join(options.workDir, 'scenes', `${scene.id}.mp4`);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    let cacheHit = false;
    try {
      await fs.access(cachedPath);
      cacheHit = true;
    } catch {
      /* miss */
    }

    let resultOutputPath: string;
    let resultMeta: {
      durationSec: number;
      fileSizeBytes: number;
      actualResolution: { width: number; height: number };
      fps: number;
      engineVersion: string;
    };

    let renderWallClockSec = 0;
    if (cacheHit) {
      // Re-use the cached render: copy from cache → scene output path so
      // every materialised storyboard has a self-contained scenes/ dir.
      const copyStart = Date.now();
      await fs.copyFile(cachedPath, outputPath);
      renderWallClockSec = (Date.now() - copyStart) / 1000;
      const stat = await fs.stat(outputPath);
      resultOutputPath = outputPath;
      resultMeta = {
        durationSec: scene.durationMs / 1000,
        fileSizeBytes: stat.size,
        actualResolution: {
          width: options.renderConfig.width,
          height: options.renderConfig.height,
        },
        fps: options.renderConfig.fps,
        engineVersion: renderPlan.adapter.upstreamVersion,
      };
      logger.info(`html-frame cache hit ${scene.id} (key=${cacheKey})`);
      options.onProgress?.(idx, total, 100);
    } else {
      const renderInput: EngineRenderInput = {
        template: {
          ...renderPlan.templateRef,
          version: renderPlan.version,
        },
        variables: renderPlan.variables,
        config: {
          format: 'mp4',
          resolution: {
            width: options.renderConfig.width,
            height: options.renderConfig.height,
          },
          fps: options.renderConfig.fps,
          duration: scene.durationMs / 1000,
          outputPath,
        },
      };

      const renderCtx: EngineRenderContext = {
        workDir: path.join(options.workDir, 'scenes'),
        signal: options.signal,
        onProgress: (pct, _stage) => {
          options.onProgress?.(idx, total, pct);
        },
      };

      const adapterResult = await renderPlan.adapter.render(
        renderInput,
        renderCtx,
      );
      resultOutputPath = adapterResult.outputPath;
      resultMeta = {
        durationSec: adapterResult.meta.durationSec,
        fileSizeBytes: adapterResult.meta.fileSizeBytes,
        actualResolution: adapterResult.meta.actualResolution,
        fps: adapterResult.meta.fps,
        engineVersion: adapterResult.meta.engineVersion,
      };
      renderWallClockSec = adapterResult.meta.renderWallClockSec;

      // Populate the cache for the next render.
      await fs.copyFile(resultOutputPath, cachedPath).catch((err) => {
        logger.warn(
          `html-frame cache write failed for ${scene.id}: ${(err as Error).message}`,
        );
      });
    }

    const result = {
      outputPath: resultOutputPath,
      meta: {
        ...resultMeta,
        renderedFrames: Math.round(resultMeta.durationSec * resultMeta.fps),
        // Cache hit: the wall-clock of the in-process file copy (small but
        // non-zero — distinguishes a "served from cache" event from any
        // future zero-cost path). Cache miss: the real adapter render time.
        renderWallClockSec,
      },
    };

    const mediaItemId = newId();
    const mediaItem: MediaItem = {
      id: mediaItemId,
      kind: 'video',
      source: 'html-engine',
      path: result.outputPath,
      metadata: {
        durationMs: Math.round(result.meta.durationSec * 1000),
        width: result.meta.actualResolution.width,
        height: result.meta.actualResolution.height,
        frameRate: result.meta.fps,
        codec: 'h264',
        fileSize: result.meta.fileSizeBytes,
      },
      provenance: {
        provider: 'html-engine',
        model: result.meta.engineVersion,
        prompt: `content-graph-node:${scene.htmlFrameSeed.nodeId};template:${renderPlan.template.id}`,
        sourceUrl: undefined,
      },
    };
    mediaItems.push(mediaItem);
    sceneIdToAssetId[scene.id] = mediaItemId;

    outScenes.push({
      ...scene,
      assetPlan: { kind: 'existing', assetId: mediaItemId },
    });

    logger.info(
      `Materialised scene ${scene.id} (${result.meta.renderedFrames} frames, ${result.meta.renderWallClockSec.toFixed(2)}s)`,
    );
  }

  const storyboard: Storyboard = {
    ...compiled.storyboard,
    scenes: outScenes,
  };

  // Sanity: no placeholder assetIds remain on HTML-seeded scenes.
  for (const scene of outScenes) {
    if (
      scene.htmlFrameSeed &&
      scene.assetPlan.kind === 'existing' &&
      scene.assetPlan.assetId === HTML_FRAME_PLACEHOLDER_ASSET_ID
    ) {
      throw new Error(
        `materializeHtmlStoryboard: scene ${scene.id} still has the placeholder assetId after materialization`,
      );
    }
  }

  return {
    storyboard,
    mediaItems,
    sceneIdToAssetId,
  };
}

/**
 * Reject any path segment that contains traversal (`..`), absolute markers,
 * or path separators. The compiler's IR-level slug regex prevents these
 * cases today; this is a defence-in-depth check at the file-write boundary.
 */
function assertSlugSafePathSegment(segment: string): void {
  if (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.split('.').includes('..')
  ) {
    throw new Error(
      `materializeHtmlStoryboard: refusing to write to unsafe path segment "${segment}"`,
    );
  }
}

/** Convenience pass-through unused export to make `now` test-only seam explicit. */
export type { MaterializeOptions as MaterializerOptions };
export const _materializeNow = (): Date => new Date();
