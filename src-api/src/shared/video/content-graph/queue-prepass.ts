import { createLogger } from '@/shared/utils/logger';
import type { VideoEngineAdapter } from '@/shared/video/engines/types';
import {
  type GalleryTemplate,
  loadTemplateGallery,
  resolveDefaultTemplateGalleryRoots,
} from '@/shared/video/templates/gallery-loader';
import type { MediaItem, Storyboard, VideoProject } from '@/shared/video/types';

import {
  type CompiledStoryboard,
  HTML_FRAME_PLACEHOLDER_ASSET_ID,
} from './compile';
import {
  materializeHtmlStoryboard,
  type MaterializeOptions,
} from './materialize';
import {
  htmlStoryboardTemplateId,
  isHtmlSeededScene,
  isHtmlStoryboard,
} from './storyboard-detect';

// Phase 1 M5 queue pre-pass.
//
// `renderProject` calls this before its usual `materializeSceneAssets`
// step. When the project's storyboard is HTML-seeded, this resolves the
// template, runs the materializer, and returns an updated VideoProject
// whose storyboard scenes are MediaItem-backed (so the existing concat
// path consumes them as ordinary `kind: 'existing'` scenes).
//
// In-memory only: the persisted project still carries the placeholder
// assetIds + the htmlFrameSeed, so a re-render from the same project
// state is reproducible. The render cache (PR #233 + Slice B
// frame-seed-hash) makes the re-render cheap.

const logger = createLogger('VideoHtmlQueuePrepass');

export interface MaterializeRenderConfig {
  width: number;
  height: number;
  fps: number;
}

export interface RunHtmlMaterializerPrepassOptions {
  /** Workspace root passed through to the template gallery + materializer. */
  workspaceRoot: string;
  /** Per-project cache dir; scenes are rendered under <workDir>/scenes/. */
  workDir: string;
  /** Output resolution + fps. Defaults to 1920×1080 @ 30fps. */
  renderConfig?: Partial<MaterializeRenderConfig>;
  /** Forwarded to the materializer for cancellation. */
  signal?: AbortSignal;
  /** Forwarded to the materializer for progress reporting. */
  onProgress?: MaterializeOptions['onProgress'];
  /**
   * Test seam: resolve a template by id from the storyboard's
   * htmlFrameSeed. Defaults to the gallery loader scanning
   * `<workspaceRoot>/.neuma/video-templates/` (user) and the in-tree
   * `branding/default/video-templates/` (branding).
   */
  resolveTemplate?: (templateId: string) => Promise<GalleryTemplate>;
  /**
   * Test seam: bypass the registry's adapter lookup. Production callers
   * leave this undefined and the materializer picks the adapter declared
   * by the template's `engine` field.
   */
  adapter?: VideoEngineAdapter;
}

/**
 * Returns the project unchanged when no HTML scenes are present.
 * Otherwise: materialises every HTML scene, registers a MediaItem per
 * scene on the project, and updates the storyboard's `assetPlan.assetId`
 * fields to point at the new items.
 */
export async function runHtmlMaterializerPrepass(
  project: VideoProject,
  options: RunHtmlMaterializerPrepassOptions,
): Promise<VideoProject> {
  if (!isHtmlStoryboard(project.storyboard)) {
    return project;
  }

  const templateId = htmlStoryboardTemplateId(project.storyboard);
  const resolveTemplate =
    options.resolveTemplate ?? defaultResolveTemplate(options.workspaceRoot);
  const template = await resolveTemplate(templateId);

  const renderConfig: MaterializeRenderConfig = {
    width: options.renderConfig?.width ?? 1920,
    height: options.renderConfig?.height ?? 1080,
    fps: options.renderConfig?.fps ?? 30,
  };

  const compiled: CompiledStoryboard = {
    storyboard: project.storyboard,
    totalDurationMs: project.storyboard.totalDurationMs,
    nodeIdToSceneId: nodeIdToSceneIdFromStoryboard(project.storyboard),
  };

  logger.info('video.html.materializer_prepass', {
    project_id: project.id,
    template_id: templateId,
    scene_count: project.storyboard.scenes.length,
  });

  const result = await materializeHtmlStoryboard(compiled, {
    template,
    resolveTemplate,
    workDir: options.workDir,
    renderConfig,
    signal: options.signal,
    onProgress: options.onProgress,
    adapter: options.adapter,
  });

  // Merge the new MediaItems onto the project's assets so the existing
  // concat path can resolve them by id. Don't drop existing assets; the
  // project may carry other source media (broll, music, narration).
  const existingIds = new Set(project.assets.map((a) => a.id));
  const newAssets: MediaItem[] = [
    ...project.assets,
    ...result.mediaItems.filter((m) => !existingIds.has(m.id)),
  ];

  return {
    ...project,
    storyboard: result.storyboard,
    assets: newAssets,
  };
}

/**
 * Build the `nodeIdToSceneId` map from a storyboard that was previously
 * compiled by `compileContentGraphToStoryboard` but persisted (so the
 * caller has only the storyboard, not the original `CompiledStoryboard`).
 */
function nodeIdToSceneIdFromStoryboard(
  storyboard: Storyboard,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const scene of storyboard.scenes) {
    if (isHtmlSeededScene(scene)) {
      map[scene.htmlFrameSeed.nodeId] = scene.id;
    }
  }
  return map;
}

/**
 * Default template resolver: scan the user + branding template roots and
 * return the matching template. Throws on miss so the queue surfaces a
 * typed error rather than silently rendering nothing.
 */
function defaultResolveTemplate(
  workspaceRoot: string,
): (templateId: string) => Promise<GalleryTemplate> {
  return async (templateId) => {
    const roots = resolveDefaultTemplateGalleryRoots(workspaceRoot);
    const gallery = await loadTemplateGallery(roots);
    const found = gallery.templates.find((t) => t.id === templateId);
    if (!found) {
      throw new Error(
        `runHtmlMaterializerPrepass: template "${templateId}" not found in ` +
          `${roots.userRoot} or ${roots.brandingRoot}. Issues: ${JSON.stringify(gallery.issues)}`,
      );
    }
    return found;
  };
}

/** Re-exported for the cache key in pipeline.ts. */
export { HTML_FRAME_PLACEHOLDER_ASSET_ID };
