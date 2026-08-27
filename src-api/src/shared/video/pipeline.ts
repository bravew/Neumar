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
  type TimelineOp,
} from '@neumar/video-ir';

import { getDatabase } from '@/shared/db';
import { safeFetch } from '@/shared/network-policy/fetch';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';
import type { PathValidationOptions } from '@/shared/services/ffmpeg';
import {
  probeFile,
  runFFmpeg,
  validateInputFile,
  validatePath,
} from '@/shared/services/ffmpeg';
import {
  createLipsyncTask,
  createVideoTask,
  generateImage,
  getVideoTaskStatus,
} from '@/shared/services/media-generation/router';
import {
  PINNED_RENDERER_IMAGE,
  PINNED_RENDERER_VERSION,
} from '@/shared/services/render/config';
import {
  createAssetManifestItem,
  renderWithCloudProvider,
} from '@/shared/services/render/router';
import type {
  RenderAssetManifestItem,
  RenderGraph,
  RenderRequest,
  RenderWhere,
} from '@/shared/services/render/types';
import { logUsage } from '@/shared/services/usage-logger';
import { createLogger } from '@/shared/utils/logger';

import {
  assetCanProvideAudio,
  assetPathValidation,
  resolveProjectAssetPath,
} from './asset-files';
import {
  normalizeRenderedAudio,
  type LoudnessMetadata,
} from './audio-normalize';
import {
  autoColorFilter,
  buildVideoColorFilters,
  colorMetadataFromProbe,
  colorMetadataFromStream,
  summarizeColorManagement,
  type ColorManagementSummary,
  type VideoColorMetadata,
} from './auto-color';
import {
  hydrateReferencedProjectAssets,
  isReferencedProjectAsset,
} from './catalog-assets';
import { runHtmlMaterializerPrepass } from './content-graph/queue-prepass';
import { signExportedMp4 } from './export-c2pa';
import {
  buildExportMetadata,
  embedExportMetadata,
  writeDisclosureSidecar,
} from './export-metadata';
import {
  assertSupportedImageBuffer,
  imageExtensionFromName,
} from './image-validation';
import { publishRenderStatus } from './job-events';
import { applyVividOverlayPass, vividOverlayEntryCount } from './overlay-pass';
import { detectVideoPluginCandidateAfterRender } from './plugins/candidate-video';
import { generatePosterFrame } from './poster';
import { runVideoQaReport } from './qa';
import {
  buildReframeCropFilters,
  resolveReframePlan,
  type VideoReframePlan,
} from './reframe';
import { REMOTION_RENDER_COMPOSITION_ID } from './remotion-constants';
import { buildRemotionRenderInput } from './remotion-render-input';
import { renderProjectWithRemotion } from './remotion-renderer';
import {
  getRenderCacheEntry,
  recordRenderCacheEntry,
  renderCacheScenePath,
  renderSceneCacheKey,
} from './render-cache';
import {
  defaultSoundtrackFadeOutSec,
  resolveSoundtrackGains,
} from './soundtrack';
import {
  getProject,
  getVideoProjectDirForRoot,
  getVideoProjectRoot,
  writeProject,
} from './store';
import {
  compileTimelineToEdl,
  pictureTimelineDurationMs,
  rebuildTimelineFromStoryboard,
} from './timeline';
import {
  transitionPrefersWebCodecsFinalRender,
  transitionRendererQuality,
} from './transition-quality';
import { synthesizeTtsPreview } from './tts';
import {
  normalizeTransition,
  transitionRegistryEntry,
  LOUDNESS_TARGET_LUFS,
  type TransitionDirection,
  type TransitionDegradation,
  type TransitionKind,
  type TimelineTransition,
  type AspectRatio,
  type AssetPlan,
  type ClipTransform,
  type CaptionRenderMode,
  type EdlAudioClip,
  type EdlAudioTrack,
  type EdlOverlay,
  type EdlSegment,
  type MediaItem,
  type LoudnessTargetLufs,
  type LoudnessTargetSetting,
  type ProviderId,
  type RenderOutput,
  type RenderStatus,
  type StoryboardScene,
  type TimelineSourceRef,
  type TtsProvider,
  type VideoQaMissingMedia,
  type VideoRenderPath,
  type VideoProject,
} from './types';
import {
  checkWebCodecsRenderHostAvailability,
  renderProjectWithWebCodecs,
} from './webcodecs-renderer';

const logger = createLogger('VideoPipeline');
const renderControllers = new Map<string, AbortController>();
const projectSceneLocks = new Map<string, Promise<void>>();
const CROSSFADE_DURATION_SEC = 0.5;
const MIN_BOOKEND_FADE_MS = 33;
const MAX_BOOKEND_FADE_MS = 3000;

export interface RenderProjectOptions {
  signal?: AbortSignal;
  aspectRatio?: AspectRatio;
  mode?: 'speed' | 'reproducible';
  renderer?: 'ffmpeg' | 'remotion' | 'webcodecs';
  captionMode?: CaptionRenderMode;
  where?: RenderWhere;
  renderProviderId?: string;
  cloudEgressConfirmed?: boolean;
  loudnessTargetLufs?: LoudnessTargetSetting;
  autoColorEnabled?: boolean;
  autoReframeEnabled?: boolean;
}

type FinalRenderer = NonNullable<RenderProjectOptions['renderer']>;

export async function renderProject(
  projectId: string,
  opts: RenderProjectOptions = {},
): Promise<RenderStatus> {
  let project = await getProject(projectId);
  if (project.storyboard?.status !== 'approved') {
    throw new Error('Storyboard must be approved before render');
  }
  if (renderControllers.has(projectId)) {
    throw new Error(`Render already in progress for project ${projectId}`);
  }

  const controller = new AbortController();
  renderControllers.set(projectId, controller);
  opts.signal?.addEventListener('abort', () => controller.abort(), {
    once: true,
  });

  try {
    const root = getVideoProjectRoot(projectId);

    // Phase 1 M5 — when the storyboard is HTML-engine-backed, run the
    // content-graph materializer pre-pass before the usual scene-asset
    // materialization. The pre-pass renders each HTML frame to an MP4
    // segment, registers a MediaItem per segment, and rewrites the
    // storyboard scenes' assetIds so the existing concat path consumes
    // them as ordinary `kind: 'existing'` scenes. In-memory only: the
    // persisted project still carries the placeholder assetIds + the
    // htmlFrameSeed (re-render reproducibility).
    // workDir is the project's per-project dir; the materializer appends its
    // own `cache/html-frames/` and `scenes/` subdirectories. Adding a `cache`
    // suffix here would double-nest to `cache/cache/html-frames/`.
    project = await runHtmlMaterializerPrepass(project, {
      workspaceRoot: root,
      workDir: getVideoProjectDirForRoot(root, projectId),
      signal: controller.signal,
    });

    project = await hydrateReferencedRenderAssets(
      project,
      controller,
      async (render) => {
        project = await reloadAndUpdateRenderStatus(project.id, render);
      },
    );

    project = await materializeSceneAssets(
      project,
      controller,
      async (render) => {
        project = await reloadAndUpdateRenderStatus(project.id, render);
      },
      { root },
    );

    const aspectRatio = opts.aspectRatio ?? '16:9';
    const autoColorEnabled =
      opts.autoColorEnabled ?? project.settings?.autoColorEnabled ?? false;
    const autoReframeEnabled =
      opts.autoReframeEnabled ?? project.settings?.autoReframeEnabled ?? true;
    const renderableScenes = await collectRenderableScenes(project, root, {
      autoColorEnabled,
      autoReframeEnabled,
      aspectRatio,
    });
    const missingMedia = collectMissingMedia(project);
    const overlays = await collectProjectOverlays(project, root, {
      autoColorEnabled,
      aspectRatio,
    });
    const colorManagement = summarizeColorManagement([
      ...renderableScenes,
      ...overlays,
    ]);
    const bookends = timelineBookendsForRender(project);
    if (renderableScenes.length === 0) {
      throw new Error('No renderable scene assets are ready');
    }

    const projectDir = validatePath(
      getVideoProjectDirForRoot(root, projectId),
      root,
      'write',
    );
    await fs.mkdir(projectDir, { recursive: true });
    // Final renders land under <projectDir>/output/. Source media
    // (generated images, voiceover, music, b-roll, uploads) belongs to
    // <projectDir>/assets/ — see SessionContext.mediaOutputDir for how
    // the media MCP is steered. Caption sidecars follow the render and
    // therefore land in output/ too.
    const renderOutputDir = validatePath(
      path.join(projectDir, 'output'),
      root,
      'write',
    );
    await fs.mkdir(renderOutputDir, { recursive: true });
    const mode = opts.mode ?? 'speed';
    const outputPath = validatePath(
      path.join(renderOutputDir, outputName(aspectRatio)),
      root,
      'write',
    );
    // Guard against a stale directory at the output path (e.g. created by an
    // older `/files/open` call before the renderer had produced the file).
    // ffmpeg would otherwise refuse to write here on every re-render.
    try {
      const existing = await fs.stat(outputPath);
      if (existing.isDirectory()) {
        await fs.rm(outputPath, { recursive: true, force: true });
        logger.warn('video.render.cleared_stale_output_dir', {
          project_id: projectId,
          output_path: outputPath,
        });
      }
    } catch {
      // missing path is fine — ffmpeg will create the file
    }
    const totalDurationSec = renderableScenes.reduce(
      (total, scene) => total + scene.durationSec,
      0,
    );
    const captionMode =
      opts.captionMode ?? project.settings?.renderCaptionMode ?? 'off';
    const cloudRequested =
      (opts.where ?? project.settings?.renderWhere) === 'cloud';
    const shouldProbeWebCodecsHost =
      !cloudRequested &&
      !opts.renderer &&
      !finalRendererEnvOverride() &&
      renderableScenes.some((scene) =>
        transitionPrefersWebCodecsFinalRender(scene.transitionToNext),
      );
    const webCodecsHostAvailability = shouldProbeWebCodecsHost
      ? await checkWebCodecsRenderHostAvailability({
          signal: controller.signal,
        })
      : undefined;
    if (webCodecsHostAvailability?.available === false) {
      logger.warn('video.render.webcodecs_host_unavailable', {
        project_id: projectId,
        render_host_source: webCodecsHostAvailability.source,
        render_host_url: webCodecsHostAvailability.url,
        reason: webCodecsHostAvailability.reason,
        fallback_renderer: 'remotion',
      });
    }
    const vividOverlayCount = vividOverlayEntryCount(project);
    const selectedRenderer = selectFinalRenderer({
      opts,
      scenes: renderableScenes,
      webCodecsHostAvailable: webCodecsHostAvailability?.available,
      hasVividOverlays: vividOverlayCount > 0,
    });
    const renderer =
      cloudRequested && selectedRenderer === 'webcodecs'
        ? 'remotion'
        : selectedRenderer;
    const transitionDegradations =
      renderer === 'webcodecs'
        ? []
        : transitionDegradationsForScenes(
            renderableScenes,
            projectId,
            renderer,
          );
    const renderStatus: RenderStatus = {
      status: 'running',
      progress: 0,
      message: 'Rendering',
      ...(transitionDegradations.length > 0
        ? { transitions: { degraded: transitionDegradations } }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    project = await reloadAndUpdateRenderStatus(projectId, renderStatus);
    const captionSidecarPath =
      captionMode === 'off'
        ? undefined
        : await writeCaptionSidecarFile(project, outputPath, root);
    const loudnessTargetLufs = normalizeLoudnessTarget(
      opts.loudnessTargetLufs ?? project.settings?.loudnessTargetLufs,
    );
    const audioTracks = collectProjectAudioTracks(project, root);
    // Phase 5 — fold the project soundtrack (background music + narration bed,
    // dB-ducked, faded) into the same audio mix. Appended after timeline audio
    // so it flows through the one existing ffmpeg invoker, not a second pass.
    audioTracks.push(
      ...collectSoundtrackAudioTracks(project, root, totalDurationSec),
    );
    if (cloudRequested) {
      const providerId =
        opts.renderProviderId ??
        project.settings?.cloudRenderProviderId ??
        'fal';
      project = await ensureCloudRenderConsent(
        project,
        providerId,
        opts.cloudEgressConfirmed,
      );
      const graph = buildRenderGraph({
        projectId,
        scenes: renderableScenes,
        overlays,
        audioTracks,
        captionFilePath: captionSidecarPath,
        aspectRatio,
        mode,
        loudnessTargetLufs,
        introMs: bookends.introMs,
        outroMs: bookends.outroMs,
      });
      const manifest = await buildRenderAssetManifest({
        projectId,
        scenes: renderableScenes,
        overlays,
        audioTracks,
        captionFilePath: captionSidecarPath,
      });
      const request = await buildCloudRenderRequest({
        project,
        projectId,
        graph,
        manifest,
        outputName: path.basename(outputPath),
        renderer,
        aspectRatio,
        captionMode,
        transitionDegradations,
        root,
      });
      if (vividOverlayCount > 0) {
        // Cloud runners use a prebuilt Remotion bundle (ffmpeg graphs have no
        // overlay-pass step at all); vivid overlays may be missing until the
        // cloud bundle ships the overlay composition. Surface, don't silence.
        logger.warn('video.render.vivid_overlays_cloud_unverified', {
          project_id: projectId,
          renderer,
          entry_count: vividOverlayCount,
        });
      }
      const task = await renderWithCloudProvider({
        providerId,
        outputPath,
        signal: controller.signal,
        request,
        onStatus: async (status) => {
          await reloadAndUpdateRenderStatus(project.id, {
            status: status.status,
            progress: status.progress,
            message: status.message,
            taskId: status.taskId,
            provider: status.provider,
            where: status.where,
            updatedAt: new Date().toISOString(),
          });
        },
      });
      const output = await finalizeRenderOutput({
        projectId,
        project,
        root,
        outputPath,
        aspectRatio,
        captionSidecarPath:
          captionSidecarPath && captionMode !== 'burn-in'
            ? path.relative(root, captionSidecarPath)
            : undefined,
        loudnessTargetLufs,
        colorManagement,
        missingMedia,
        transitionDegradations,
        signal: controller.signal,
      });
      const done: RenderStatus = {
        status: 'done',
        outputPath: path.relative(root, outputPath),
        progress: 100,
        message: 'Cloud render complete',
        taskId: task.taskId,
        provider: task.provider,
        where: 'cloud',
        ...(transitionDegradations.length > 0
          ? { transitions: { degraded: transitionDegradations } }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      await updateRenderStatus(project, done, output);
      await detectPluginCandidateAfterSuccessfulRender(projectId);
      return done;
    }
    if (renderer === 'webcodecs') {
      await renderProjectWithWebCodecs({
        project,
        outputPath,
        aspectRatio,
        mode,
        includeCaptions: captionMode === 'burn-in',
        root,
        signal: controller.signal,
        onProgress: (progress) => {
          void updateRenderStatus(project, {
            ...renderStatus,
            message: 'Rendering with browser compositor',
            progress,
            updatedAt: new Date().toISOString(),
          }).catch((error) => {
            logger.warn('video.render.progress_update_failed', {
              project_id: projectId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        },
      });

      await applyVividOverlayPassForcedRenderer({
        vividOverlayCount,
        renderer,
        captionMode,
        project,
        root,
        aspectRatio,
        outputPath,
        signal: controller.signal,
      });

      const output = await finalizeRenderOutput({
        projectId,
        project,
        root,
        outputPath,
        aspectRatio,
        captionSidecarPath:
          captionSidecarPath && captionMode !== 'burn-in'
            ? path.relative(root, captionSidecarPath)
            : undefined,
        loudnessTargetLufs,
        colorManagement,
        missingMedia,
        transitionDegradations,
        signal: controller.signal,
      });
      const done: RenderStatus = {
        status: 'done',
        outputPath: path.relative(root, outputPath),
        progress: 100,
        message: 'Browser compositor render complete',
        updatedAt: new Date().toISOString(),
      };
      await updateRenderStatus(project, done, output);
      await detectPluginCandidateAfterSuccessfulRender(projectId);
      return done;
    }
    if (renderer === 'remotion') {
      await renderProjectWithRemotion({
        project,
        outputPath,
        aspectRatio,
        mode,
        includeCaptions: captionMode === 'burn-in',
        root,
        signal: controller.signal,
        onProgress: (progress) => {
          void updateRenderStatus(project, {
            ...renderStatus,
            message: 'Rendering with Remotion',
            progress,
            updatedAt: new Date().toISOString(),
          }).catch((error) => {
            logger.warn('video.render.progress_update_failed', {
              project_id: projectId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        },
      });

      const output = await finalizeRenderOutput({
        projectId,
        project,
        root,
        outputPath,
        aspectRatio,
        captionSidecarPath:
          captionSidecarPath && captionMode !== 'burn-in'
            ? path.relative(root, captionSidecarPath)
            : undefined,
        loudnessTargetLufs,
        colorManagement,
        missingMedia,
        transitionDegradations,
        signal: controller.signal,
      });
      const done: RenderStatus = {
        status: 'done',
        outputPath: path.relative(root, outputPath),
        progress: 100,
        message: 'Remotion render complete',
        updatedAt: new Date().toISOString(),
      };
      await updateRenderStatus(project, done, output);
      await detectPluginCandidateAfterSuccessfulRender(projectId);
      return done;
    }
    const sceneCache = await materializeCachedSceneRenders({
      projectId,
      scenes: renderableScenes,
      root,
      aspectRatio,
      mode,
      signal: controller.signal,
    });
    const scenesForRender = sceneCache.scenes;
    const needsFilterGraph =
      scenesForRender.length > 1 ||
      overlays.length > 0 ||
      audioTracks.length > 0 ||
      Boolean(captionSidecarPath && captionMode === 'burn-in');
    const args = !needsFilterGraph
      ? buildRenderArgs({
          inputPath: scenesForRender[0]!.inputPath,
          outputPath,
          assetKind: scenesForRender[0]!.kind,
          durationSec: scenesForRender[0]!.durationSec,
          sourceStartSec: scenesForRender[0]!.sourceStartSec,
          playback: scenesForRender[0]!.playback,
          hasAudio: scenesForRender[0]!.hasAudio,
          aspectRatio,
          mode,
          imagePan: scenesForRender[0]!.imagePan,
          blurPad: scenesForRender[0]!.blurPad,
          background: scenesForRender[0]!.background,
          color: scenesForRender[0]!.color,
          autoColorFilter: scenesForRender[0]!.autoColorFilter,
          reframe: scenesForRender[0]!.reframe,
          introMs: bookends.introMs,
          outroMs: bookends.outroMs,
          captionFilePath:
            captionMode === 'burn-in' ? captionSidecarPath : undefined,
        })
      : buildMultiSceneRenderArgs({
          projectId,
          scenes: scenesForRender,
          overlays,
          audioTracks,
          captionFilePath:
            captionMode === 'burn-in' ? captionSidecarPath : undefined,
          outputPath,
          aspectRatio,
          mode,
          introMs: bookends.introMs,
          outroMs: bookends.outroMs,
        });
    await runFFmpeg(args, {
      inputDuration: totalDurationSec,
      abortSignal: controller.signal,
      onProgress: (progress) => {
        void updateRenderStatus(project, {
          ...renderStatus,
          progress: progress.percent ?? undefined,
          updatedAt: new Date().toISOString(),
        }).catch((error) => {
          logger.warn('video.render.progress_update_failed', {
            project_id: projectId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
    });

    await applyVividOverlayPassForcedRenderer({
      vividOverlayCount,
      renderer,
      captionMode,
      project,
      root,
      aspectRatio,
      outputPath,
      signal: controller.signal,
    });

    const output = await finalizeRenderOutput({
      projectId,
      project,
      root,
      outputPath,
      aspectRatio,
      captionSidecarPath:
        captionSidecarPath && captionMode !== 'burn-in'
          ? path.relative(root, captionSidecarPath)
          : undefined,
      loudnessTargetLufs,
      colorManagement,
      missingMedia,
      transitionDegradations,
      signal: controller.signal,
    });
    const done: RenderStatus = {
      status: 'done',
      outputPath: path.relative(root, outputPath),
      progress: 100,
      ...(transitionDegradations.length > 0
        ? { transitions: { degraded: transitionDegradations } }
        : {}),
      ...(sceneCache.stats.sceneHits > 0 || sceneCache.stats.sceneMisses > 0
        ? { cache: sceneCache.stats }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    await updateRenderStatus(project, done, output);
    await detectPluginCandidateAfterSuccessfulRender(projectId);
    return done;
  } catch (error) {
    const cancelled = controller.signal.aborted;
    const status: RenderStatus = {
      status: cancelled ? 'cancelled' : 'error',
      message: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    };
    try {
      await reloadAndUpdateRenderStatus(projectId, status);
    } catch (writeError) {
      logger.warn('video.render.error_status_write_failed', {
        project_id: projectId,
        error:
          writeError instanceof Error ? writeError.message : String(writeError),
      });
    }
    return status;
  } finally {
    renderControllers.delete(projectId);
  }
}

async function detectPluginCandidateAfterSuccessfulRender(
  projectId: string,
): Promise<void> {
  try {
    await detectVideoPluginCandidateAfterRender(projectId);
  } catch (error) {
    logger.warn('video.plugin_candidate.detect_failed', {
      project_id: projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Vivid overlays on a non-Remotion final renderer (explicit override or env
 * pin) burn via the alpha overlay pass AFTER the base render — which puts
 * them above burned-in captions. The default selection avoids this by
 * preferring Remotion; when forced, apply the pass and log the ordering
 * caveat so the degradation is visible, never silent.
 */
async function applyVividOverlayPassForcedRenderer(input: {
  vividOverlayCount: number;
  renderer: FinalRenderer;
  captionMode: CaptionRenderMode;
  project: VideoProject;
  root: string;
  aspectRatio: AspectRatio;
  outputPath: string;
  signal: AbortSignal;
}): Promise<void> {
  if (input.vividOverlayCount === 0) return;
  if (input.captionMode === 'burn-in') {
    logger.warn('video.render.vivid_overlays_above_captions', {
      project_id: input.project.id,
      renderer: input.renderer,
      entry_count: input.vividOverlayCount,
    });
  }
  await applyVividOverlayPass({
    project: input.project,
    root: input.root,
    aspectRatio: input.aspectRatio,
    outputPath: input.outputPath,
    signal: input.signal,
  });
}

export function selectFinalRenderer({
  opts,
  scenes,
  webCodecsHostAvailable = true,
  hasVividOverlays = false,
}: {
  opts?: Pick<RenderProjectOptions, 'renderer'>;
  scenes?: readonly Pick<SceneClip, 'transitionToNext'>[];
  webCodecsHostAvailable?: boolean;
  hasVividOverlays?: boolean;
}): FinalRenderer {
  if (opts?.renderer) return opts.renderer;
  const envOverride = finalRendererEnvOverride();
  if (envOverride) return envOverride;
  // Vivid overlays render natively (below captions) only in the Remotion
  // composition; the other renderers need the burned overlay pass, which
  // cannot keep captions on top. Prefer Remotion so captions stay last.
  if (hasVividOverlays) return 'remotion';
  const prefersWebCodecs = scenes?.some((scene) =>
    transitionPrefersWebCodecsFinalRender(scene.transitionToNext),
  );
  if (!prefersWebCodecs) return 'ffmpeg';
  return webCodecsHostAvailable ? 'webcodecs' : 'remotion';
}

function finalRendererEnvOverride(): FinalRenderer | undefined {
  const value = process.env.NEUMA_VIDEO_FINAL_RENDERER?.toLowerCase().trim();
  return value === 'remotion' || value === 'ffmpeg' || value === 'webcodecs'
    ? value
    : undefined;
}

function normalizeLoudnessTarget(
  value?: LoudnessTargetSetting,
): LoudnessTargetLufs | undefined {
  if (value === undefined || value === 'off') return undefined;
  return LOUDNESS_TARGET_LUFS.includes(value) ? value : undefined;
}

async function buildCloudRenderRequest(input: {
  project: VideoProject;
  projectId: string;
  graph: RenderGraph;
  manifest: RenderAssetManifestItem[];
  outputName: string;
  renderer: NonNullable<RenderProjectOptions['renderer']>;
  aspectRatio: AspectRatio;
  captionMode: CaptionRenderMode;
  transitionDegradations: TransitionDegradation[];
  root: string;
}): Promise<RenderRequest> {
  if (input.renderer === 'ffmpeg') {
    return {
      kind: 'ffmpeg',
      projectId: input.projectId,
      graph: input.graph,
      assets: input.manifest,
      outputName: input.outputName,
      ...(input.transitionDegradations.length > 0
        ? { transitions: { degraded: input.transitionDegradations } }
        : {}),
      costCapUsd: input.project.budget?.capUsd,
    };
  }

  const inputProps = await buildRemotionRenderInput(input.project, {
    aspectRatio: input.aspectRatio,
    includeCaptions: input.captionMode === 'burn-in',
    root: input.root,
  });

  return {
    kind: 'remotion',
    projectId: input.projectId,
    graph: input.graph,
    bundle: {
      compositionId: REMOTION_RENDER_COMPOSITION_ID,
      bundleUrl: resolveCloudRemotionBundleUrl(),
      inputProps,
    },
    assets: input.manifest,
    outputName: input.outputName,
    ...(input.transitionDegradations.length > 0
      ? { transitions: { degraded: input.transitionDegradations } }
      : {}),
    costCapUsd: input.project.budget?.capUsd,
  };
}

function resolveCloudRemotionBundleUrl(): string | undefined {
  const value =
    process.env.NEUMA_VIDEO_CLOUD_REMOTION_BUNDLE_URL ??
    process.env.NEUMA_VIDEO_REMOTION_BUNDLE_URL;
  return value?.trim() || undefined;
}

export async function cancelRender(projectId: string): Promise<RenderStatus> {
  renderControllers.get(projectId)?.abort();
  const project = await getProject(projectId);
  const status: RenderStatus = {
    status: 'cancelled',
    updatedAt: new Date().toISOString(),
  };
  await updateRenderStatus(project, status);
  return status;
}

export async function getRenderStatus(
  projectId: string,
): Promise<RenderStatus> {
  const project = await getProject(projectId);
  return (
    project.render ?? {
      status: 'idle',
      updatedAt: project.updatedAt,
    }
  );
}

const AI_CLIP_POLL_INTERVAL_MS = 5000;
const AI_CLIP_POLL_TIMEOUT_MS = 10 * 60 * 1000;

function aiClipPollIntervalMs(): number {
  const override = Number(process.env.NEUMA_VIDEO_AI_CLIP_POLL_INTERVAL_MS);
  return Number.isFinite(override) && override >= 0
    ? override
    : AI_CLIP_POLL_INTERVAL_MS;
}

type AiClipScene = StoryboardScene & {
  assetPlan: Extract<AssetPlan, { kind: 'ai-clip' }>;
};
type AiImageScene = StoryboardScene & {
  assetPlan: Extract<AssetPlan, { kind: 'ai-image' }>;
};
type LipsyncScene = StoryboardScene & {
  assetPlan: Extract<AssetPlan, { kind: 'lipsync' }>;
};

interface MaterializeSceneAssetsOptions {
  onlyScenes?: Set<string>;
  root?: string;
}

async function hydrateReferencedRenderAssets(
  project: VideoProject,
  controller: AbortController,
  onStatus: (render: RenderStatus) => Promise<void>,
): Promise<VideoProject> {
  const assetIds = collectRenderAssetIds(project);
  const pending = project.assets.filter(
    (asset) => assetIds.has(asset.id) && isReferencedProjectAsset(asset),
  );
  if (pending.length === 0) return project;

  if (controller.signal.aborted) throw new Error('Render cancelled');
  await onStatus({
    status: 'running',
    message: `Downloading cloud assets (${pending.length})`,
    progress: 0,
    updatedAt: new Date().toISOString(),
  });
  const result = await hydrateReferencedProjectAssets(
    project.id,
    pending.map((asset) => asset.id),
    { role: 'asset' },
  );
  if (controller.signal.aborted) throw new Error('Render cancelled');
  return result.project;
}

function collectRenderAssetIds(project: VideoProject): Set<string> {
  const assetIds = new Set<string>();
  const addSourceRef = (sourceRef: TimelineSourceRef) => {
    if (sourceRef.kind === 'asset') assetIds.add(sourceRef.assetId);
  };

  const edl = compileTimelineToEdl(project);
  for (const segment of [...edl.segments, ...edl.overlays]) {
    addSourceRef(segment.sourceRef);
  }
  for (const track of edl.audioTracks) {
    for (const clip of track.clips) addSourceRef(clip.sourceRef);
  }

  for (const scene of project.storyboard?.scenes ?? []) {
    if (
      scene.assetPlan.kind === 'existing' ||
      scene.assetPlan.kind === 'image-pan'
    ) {
      assetIds.add(scene.assetPlan.assetId);
    }
  }
  if (project.storyboard?.music?.assetId) {
    assetIds.add(project.storyboard.music.assetId);
  }
  if (project.storyboard?.narration?.assetId) {
    assetIds.add(project.storyboard.narration.assetId);
  }
  for (const scene of project.scenes ?? []) {
    for (const clip of scene.clips) assetIds.add(clip.mediaId);
  }

  return assetIds;
}

async function materializeSceneAssets(
  project: VideoProject,
  controller: AbortController,
  onStatus: (render: RenderStatus) => Promise<void>,
  opts: MaterializeSceneAssetsOptions = {},
): Promise<VideoProject> {
  const root = opts.root ?? getVideoProjectRoot(project.id);
  const scenes = project.storyboard?.scenes ?? [];
  const sceneIncluded = (scene: StoryboardScene) =>
    !opts.onlyScenes || opts.onlyScenes.has(scene.id);
  const pendingClips = scenes.filter(
    (scene): scene is AiClipScene =>
      sceneIncluded(scene) && scene.assetPlan.kind === 'ai-clip',
  );
  const pendingImages = scenes.filter(
    (scene): scene is AiImageScene =>
      sceneIncluded(scene) && scene.assetPlan.kind === 'ai-image',
  );
  const pendingLipsync = scenes.filter(
    (scene): scene is LipsyncScene =>
      sceneIncluded(scene) && scene.assetPlan.kind === 'lipsync',
  );
  if (
    pendingClips.length === 0 &&
    pendingImages.length === 0 &&
    pendingLipsync.length === 0
  )
    return project;

  let current = project;
  for (let i = 0; i < pendingImages.length; i++) {
    if (controller.signal.aborted) throw new Error('Render cancelled');
    const scene = pendingImages[i]!;
    await onStatus({
      status: 'running',
      message: `Generating scene images (${i + 1}/${pendingImages.length})…`,
      progress: Math.round((i / pendingImages.length) * 20),
      updatedAt: new Date().toISOString(),
    });
    current = await materializeAiImageScene(current.id, scene, { root });
  }

  for (let i = 0; i < pendingClips.length; i++) {
    if (controller.signal.aborted) throw new Error('Render cancelled');
    const scene = pendingClips[i]!;
    const plan = scene.assetPlan;
    await onStatus({
      status: 'running',
      message: `Generating scene clips (${i + 1}/${pendingClips.length})…`,
      progress: 20 + Math.round((i / pendingClips.length) * 40),
      updatedAt: new Date().toISOString(),
    });

    const durationSec = Math.max(
      4,
      Math.round((plan.durationMs ?? scene.durationMs ?? 5000) / 1000),
    );
    logger.info('video.pipeline.ai_clip_request', {
      project_id: current.id,
      scene_id: scene.id,
      provider: plan.provider,
      duration_sec: durationSec,
      ref_image: Boolean(plan.refImageId),
      ref_image_tail: Boolean(plan.refImageTailId),
      seed: plan.seed,
    });
    const referenceImageUrl = plan.refImageId
      ? await assetToDataUri(current, plan.refImageId, root)
      : undefined;
    const referenceImageTailUrl = plan.refImageTailId
      ? await assetToDataUri(current, plan.refImageTailId, root)
      : undefined;
    const created = await createVideoTask({
      prompt: plan.prompt,
      aspectRatio: plan.aspectRatio,
      duration: durationSec,
      provider: plan.provider,
      referenceImageUrl,
      referenceImageTailUrl,
      seed: plan.seed,
    });
    if (!created.success || !created.taskId) {
      throw new Error(created.error || 'ai-clip task creation failed');
    }

    const startedAt = Date.now();
    let videoUrl: string | undefined;
    let resultDurationSec: number | undefined;
    while (true) {
      if (controller.signal.aborted) throw new Error('Render cancelled');
      if (Date.now() - startedAt > AI_CLIP_POLL_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for ai-clip task ${created.taskId}`);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, aiClipPollIntervalMs()),
      );
      const status = await getVideoTaskStatus(
        created.taskId,
        controller.signal,
      );
      if (status.status === 'succeeded' && status.videoUrl) {
        videoUrl = status.videoUrl;
        resultDurationSec = status.duration;
        break;
      }
      if (
        status.status === 'failed' ||
        status.status === 'cancelled' ||
        status.status === 'expired'
      ) {
        throw new Error(status.error || `ai-clip task ${status.status}`);
      }
    }

    const assetDir = getVideoAssetsDirForRoot(root, current.id);
    await fs.mkdir(assetDir, { recursive: true });
    const assetId = randomUUID();
    const outPath = path.join(assetDir, `ai-clip-${assetId}.mp4`);
    const response = await safeFetch(videoUrl!, trustedLocalPolicy(), {
      timeoutMs: 120_000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Failed to download ai-clip video: HTTP ${response.status}`,
      );
    }
    await fs.writeFile(outPath, response.body);

    const finalDurationSec = resultDurationSec ?? durationSec;
    const asset: MediaItem = {
      id: assetId,
      kind: 'video',
      source: 'ai-clip',
      path: path.relative(root, outPath),
      metadata: {
        durationMs: finalDurationSec * 1000,
        fileSize: response.body.length,
      },
      provenance: {
        provider: created.provider,
        model: created.model,
        prompt: plan.prompt,
        refImageId: plan.refImageId,
        refImageTailId: plan.refImageTailId,
        seed: created.seed ?? plan.seed,
        sourceUrl: videoUrl,
        commercialUse: true,
      },
    };

    const latest = await getProjectForRoot(current.id, root);
    const updatedScenes = (latest.storyboard?.scenes ?? []).map((entry) =>
      entry.id === scene.id
        ? { ...entry, assetPlan: { kind: 'existing' as const, assetId } }
        : entry,
    );
    current = rebuildTimelineFromStoryboard({
      ...latest,
      assets: [...latest.assets, asset],
      storyboard: latest.storyboard
        ? { ...latest.storyboard, scenes: updatedScenes }
        : latest.storyboard,
      updatedAt: new Date().toISOString(),
    });
    await writeProjectForRoot(current, root);

    logUsage({
      callType: 'video',
      provider: created.provider,
      model: created.model,
      unitType: 'video_second',
      unitCount: finalDurationSec,
      metadata: {
        project_id: current.id,
        scene_id: scene.id,
        caller: 'video-pipeline',
        media_kind: 'ai-clip',
      },
    });
  }

  for (let i = 0; i < pendingLipsync.length; i++) {
    if (controller.signal.aborted) throw new Error('Render cancelled');
    const scene = pendingLipsync[i]!;
    await onStatus({
      status: 'running',
      message: `Generating lipsync avatars (${i + 1}/${pendingLipsync.length})…`,
      progress: 60 + Math.round((i / pendingLipsync.length) * 20),
      updatedAt: new Date().toISOString(),
    });
    current = await materializeLipsyncScene(current.id, scene, {
      root,
      signal: controller.signal,
    });
  }

  return current;
}

export async function materializeStoryboardSceneAsset(
  projectId: string,
  sceneId: string,
): Promise<{ project: VideoProject; asset: MediaItem }> {
  const project = await getProject(projectId);
  const scene = project.storyboard?.scenes.find(
    (entry) => entry.id === sceneId,
  );
  if (!scene) throw new Error('Storyboard scene not found');
  if (
    scene.assetPlan.kind !== 'ai-image' &&
    scene.assetPlan.kind !== 'lipsync'
  ) {
    throw new Error(
      'Only ai-image and lipsync scenes can be materialized on demand',
    );
  }
  const next =
    scene.assetPlan.kind === 'lipsync'
      ? await materializeLipsyncScene(project.id, scene as LipsyncScene)
      : await materializeAiImageScene(project.id, scene as AiImageScene);
  const nextScene = next.storyboard?.scenes.find(
    (entry) => entry.id === sceneId,
  );
  const assetId =
    nextScene?.assetPlan.kind === 'existing' ? nextScene.assetPlan.assetId : '';
  const asset = next.assets.find((entry) => entry.id === assetId);
  if (!asset) throw new Error('Generated image asset not found');
  return { project: next, asset };
}

export interface RegenerateStoryboardSceneInput {
  prompt?: string;
  lipsyncText?: string;
  voiceId?: string;
  voiceProvider?: TtsProvider;
  refImageAssetId?: string;
  refImageTailAssetId?: string;
  provider?: string;
  durationMs?: number;
  seed?: number;
  motionScale?: number;
  background?: Extract<AssetPlan, { kind: 'lipsync' }>['background'];
  confirmReferenceUpload?: boolean;
  signal?: AbortSignal;
}

export async function regenerateStoryboardSceneAsset(
  projectId: string,
  sceneId: string,
  input: RegenerateStoryboardSceneInput,
): Promise<{ project: VideoProject; asset: MediaItem }> {
  return withProjectSceneLock(projectId, async () => {
    const root = getVideoProjectRoot(projectId);
    const original = await getProjectForRoot(projectId, root);
    const originalScene = original.storyboard?.scenes.find(
      (entry) => entry.id === sceneId,
    );
    if (!originalScene) throw new Error('Storyboard scene not found');

    const nextPlan = buildRegenerateAssetPlan(original, originalScene, input);
    const referenceIds = referenceIdsForPlan(nextPlan);
    const egressConfirmed =
      input.confirmReferenceUpload === true ||
      (nextPlan.kind === 'lipsync' && nextPlan.egressConfirmed === true);
    if (referenceIds.length > 0 && !egressConfirmed) {
      throw new Error(
        'Reference image upload must be confirmed before regenerating this scene',
      );
    }

    const patched: VideoProject = rebuildTimelineFromStoryboard({
      ...original,
      storyboard: original.storyboard
        ? {
            ...original.storyboard,
            scenes: original.storyboard.scenes.map((entry) =>
              entry.id === sceneId
                ? {
                    ...entry,
                    durationMs: input.durationMs ?? entry.durationMs,
                    intent: input.prompt?.trim() || entry.intent,
                    assetPlan: nextPlan,
                  }
                : entry,
            ),
          }
        : original.storyboard,
      updatedAt: new Date().toISOString(),
    });
    await writeProjectForRoot(patched, root);

    const controller = new AbortController();
    if (input.signal?.aborted) controller.abort();
    input.signal?.addEventListener('abort', () => controller.abort(), {
      once: true,
    });

    try {
      const next = await materializeSceneAssets(
        patched,
        controller,
        async () => undefined,
        {
          onlyScenes: new Set([sceneId]),
          root,
        },
      );
      const nextScene = next.storyboard?.scenes.find(
        (entry) => entry.id === sceneId,
      );
      const assetId =
        nextScene?.assetPlan.kind === 'existing'
          ? nextScene.assetPlan.assetId
          : '';
      const asset = next.assets.find((entry) => entry.id === assetId);
      if (!asset) throw new Error('Generated scene asset not found');
      return { project: next, asset };
    } catch (error) {
      if (controller.signal.aborted) {
        await writeProjectForRoot(original, root);
      }
      throw error;
    }
  });
}

async function materializeAiImageScene(
  projectId: string,
  scene: AiImageScene,
  opts: { root?: string } = {},
): Promise<VideoProject> {
  const root = opts.root ?? getVideoProjectRoot(projectId);
  const latest = await getProjectForRoot(projectId, root);
  const currentScene = latest.storyboard?.scenes.find(
    (entry): entry is AiImageScene =>
      entry.id === scene.id && entry.assetPlan.kind === 'ai-image',
  );
  if (!currentScene) return latest;
  const plan = currentScene.assetPlan;
  const assetDir = getVideoAssetsDirForRoot(root, projectId);
  await fs.mkdir(assetDir, { recursive: true });
  const referenceImageUrl = plan.refImageIds?.[0]
    ? await assetToDataUri(latest, plan.refImageIds[0], root)
    : undefined;

  logger.info('video.pipeline.ai_image_request', {
    project_id: projectId,
    scene_id: scene.id,
    provider: plan.provider,
  });
  const result = await generateImage({
    prompt: plan.prompt,
    aspectRatio: plan.aspectRatio,
    size: plan.size,
    provider: plan.provider,
    count: 1,
    workDir: assetDir,
    referenceImageUrl,
    seed: plan.seed,
  });
  if (!result.success || result.images.length === 0) {
    throw new Error(result.error || 'ai-image generation failed');
  }

  const generated = result.images[0]!;
  const assetId = randomUUID();
  const outPath = await persistGeneratedImage({
    assetDir,
    assetId,
    generated,
    root,
  });
  const metadata = await readGeneratedImageMetadata(outPath, root);
  const asset: MediaItem = {
    id: assetId,
    kind: 'image',
    source: 'ai-image',
    path: path.relative(root, outPath),
    metadata,
    provenance: {
      provider: result.provider,
      model: result.model,
      requestedProvider: result.provenance?.requestedProvider,
      requestedModel: result.provenance?.requestedModel,
      fallbackReason: result.provenance?.fallbackReason,
      prompt: plan.prompt,
      refImageId: plan.refImageIds?.[0],
      seed: result.seed ?? plan.seed,
      sourceUrl: generated.url?.startsWith('data:') ? undefined : generated.url,
      commercialUse: true,
    },
  };

  const afterGeneration = await getProjectForRoot(projectId, root);
  const updatedScenes = (afterGeneration.storyboard?.scenes ?? []).map(
    (entry) =>
      entry.id === scene.id
        ? { ...entry, assetPlan: { kind: 'existing' as const, assetId } }
        : entry,
  );
  const next = rebuildTimelineFromStoryboard({
    ...afterGeneration,
    assets: [...afterGeneration.assets, asset],
    storyboard: afterGeneration.storyboard
      ? { ...afterGeneration.storyboard, scenes: updatedScenes }
      : afterGeneration.storyboard,
    updatedAt: new Date().toISOString(),
  });
  await writeProjectForRoot(next, root);

  logUsage({
    callType: 'image',
    provider: result.provider,
    model: result.model,
    unitType: 'image',
    unitCount: 1,
    metadata: {
      project_id: projectId,
      scene_id: scene.id,
      caller: 'video-pipeline',
      media_kind: 'ai-image',
    },
  });

  return next;
}

async function materializeLipsyncScene(
  projectId: string,
  scene: LipsyncScene,
  opts: { root?: string; signal?: AbortSignal } = {},
): Promise<VideoProject> {
  const root = opts.root ?? getVideoProjectRoot(projectId);
  const latest = await getProjectForRoot(projectId, root);
  const currentScene = latest.storyboard?.scenes.find(
    (entry): entry is LipsyncScene =>
      entry.id === scene.id && entry.assetPlan.kind === 'lipsync',
  );
  if (!currentScene) return latest;

  const plan = currentScene.assetPlan;
  if (plan.egressConfirmed !== true) {
    throw new Error(
      'Reference image upload must be confirmed before generating lipsync video',
    );
  }

  const referenceImageUrl = await assetToDataUri(
    latest,
    plan.referenceImageAssetId,
    root,
  );
  const tts = await synthesizeTtsPreview(projectId, {
    text: plan.text,
    voiceId: plan.voiceId,
    provider: plan.voiceProvider,
    aspectDurationMs: currentScene.durationMs,
  });
  if (opts.signal?.aborted) throw new Error('Render cancelled');

  const afterTts = tts.project;
  const audioPath = resolveProjectAssetPath(tts.asset, root);
  const audioBase64 = (await fs.readFile(audioPath)).toString('base64');
  const background = await lipsyncBackgroundToRouterInput(afterTts, plan, root);
  const requestedProvider =
    plan.lipsyncProvider && plan.lipsyncProvider !== 'auto'
      ? plan.lipsyncProvider
      : undefined;

  logger.info('video.pipeline.lipsync_request', {
    project_id: projectId,
    scene_id: scene.id,
    provider: requestedProvider,
    reference_image: plan.referenceImageAssetId,
    tts_provider: tts.provider,
  });
  const created = await createLipsyncTask(
    {
      imageUrl: referenceImageUrl,
      audio: { base64: audioBase64 },
      text: plan.text,
      motionScale: plan.motionScale,
      aspectRatio: plan.aspectRatio,
      background,
      provider: requestedProvider,
    },
    opts.signal,
  );
  if (!created.success || !created.taskId) {
    throw new Error(created.error || 'lipsync task creation failed');
  }

  const startedAt = Date.now();
  let videoUrl: string | undefined;
  let resultDurationSec: number | undefined;
  while (true) {
    if (opts.signal?.aborted) throw new Error('Render cancelled');
    if (Date.now() - startedAt > AI_CLIP_POLL_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for lipsync task ${created.taskId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, aiClipPollIntervalMs()));
    const status = await getVideoTaskStatus(created.taskId, opts.signal);
    if (status.status === 'succeeded' && status.videoUrl) {
      videoUrl = status.videoUrl;
      resultDurationSec = status.duration;
      break;
    }
    if (
      status.status === 'failed' ||
      status.status === 'cancelled' ||
      status.status === 'expired'
    ) {
      throw new Error(status.error || `lipsync task ${status.status}`);
    }
  }

  const assetDir = getVideoAssetsDirForRoot(root, projectId);
  await fs.mkdir(assetDir, { recursive: true });
  const assetId = randomUUID();
  const outPath = path.join(assetDir, `lipsync-${assetId}.mp4`);
  const response = await safeFetch(videoUrl!, trustedLocalPolicy(), {
    timeoutMs: 120_000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Failed to download lipsync video: HTTP ${response.status}`,
    );
  }
  await fs.writeFile(outPath, response.body);

  const metadata = await readLipsyncVideoMetadata(
    outPath,
    root,
    resultDurationSec ?? Math.max(1, Math.ceil(tts.durationMs / 1000)),
    response.body.length,
  );
  const asset: MediaItem = {
    id: assetId,
    kind: 'video',
    source: 'lipsync',
    path: path.relative(root, outPath),
    metadata,
    provenance: {
      provider: created.provider,
      model: created.model,
      requestedProvider: created.provenance?.requestedProvider,
      requestedModel: created.provenance?.requestedModel,
      fallbackReason: created.provenance?.fallbackReason,
      prompt: plan.text,
      refImageId: plan.referenceImageAssetId,
      sourceUrl: videoUrl,
      commercialUse: true,
    },
  };

  const afterGeneration = await getProjectForRoot(projectId, root);
  const updatedScenes = (afterGeneration.storyboard?.scenes ?? []).map(
    (entry) =>
      entry.id === scene.id
        ? { ...entry, assetPlan: { kind: 'existing' as const, assetId } }
        : entry,
  );
  const next: VideoProject = rebuildTimelineFromStoryboard({
    ...afterGeneration,
    assets: [...afterGeneration.assets, asset],
    storyboard: afterGeneration.storyboard
      ? { ...afterGeneration.storyboard, scenes: updatedScenes }
      : afterGeneration.storyboard,
    updatedAt: new Date().toISOString(),
  });
  await writeProjectForRoot(next, root);

  const durationSec = Math.max(1, Math.ceil(metadata.durationMs / 1000));
  logUsage({
    callType: 'video',
    provider: created.provider,
    model: created.model,
    unitType: 'video_second',
    unitCount: durationSec,
    metadata: {
      project_id: projectId,
      scene_id: scene.id,
      caller: 'video-pipeline',
      media_kind: 'lipsync',
      face_asset_id: plan.referenceImageAssetId,
    },
  });

  return next;
}

async function lipsyncBackgroundToRouterInput(
  project: VideoProject,
  plan: Extract<AssetPlan, { kind: 'lipsync' }>,
  root: string,
) {
  if (!plan.background) return undefined;
  if (plan.background.kind === 'image') {
    return {
      kind: 'image' as const,
      imageUrl: await assetToDataUri(project, plan.background.assetId, root),
    };
  }
  return plan.background;
}

async function readLipsyncVideoMetadata(
  filePath: string,
  root: string,
  fallbackDurationSec: number,
  fallbackSize: number,
): Promise<MediaItem['metadata']> {
  try {
    const probe = await probeFile(filePath, root);
    const video = probe.streams.find((stream) => stream.codecType === 'video');
    return {
      durationMs: Math.round((probe.duration || fallbackDurationSec) * 1000),
      width: video?.width,
      height: video?.height,
      codec: video?.codecName ?? probe.formatName,
      pixelFormat: video?.pixelFormat,
      colorTransfer: video?.colorTransfer,
      colorPrimaries: video?.colorPrimaries,
      colorSpace: video?.colorSpace,
      fileSize: probe.size,
      audioTrackCount: probe.streams.filter(
        (stream) => stream.codecType === 'audio',
      ).length,
    };
  } catch (error) {
    logger.warn('video.pipeline.lipsync_probe_failed', {
      file: path.basename(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      durationMs: fallbackDurationSec * 1000,
      fileSize: fallbackSize,
    };
  }
}

async function persistGeneratedImage(input: {
  assetDir: string;
  assetId: string;
  generated: { url?: string; localPath?: string };
  root: string;
}): Promise<string> {
  if (input.generated.localPath) {
    const sourcePath = validateInputFile(input.generated.localPath, input.root);
    const buffer = await fs.readFile(sourcePath);
    assertSupportedImageBuffer(buffer, sourcePath);
    const outPath = path.join(
      input.assetDir,
      `ai-image-${input.assetId}${imageExtensionFromName(sourcePath)}`,
    );
    await fs.copyFile(sourcePath, outPath);
    return outPath;
  }

  if (!input.generated.url) {
    throw new Error('Image provider returned no file');
  }

  if (input.generated.url.startsWith('data:image/')) {
    const buffer = imageDataUriToBuffer(input.generated.url);
    assertSupportedImageBuffer(buffer, 'generated image');
    const outPath = path.join(input.assetDir, `ai-image-${input.assetId}.png`);
    await fs.writeFile(outPath, buffer);
    return outPath;
  }

  const response = await safeFetch(input.generated.url, trustedLocalPolicy(), {
    timeoutMs: 120_000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to download ai-image: HTTP ${response.status}`);
  }
  assertSupportedImageBuffer(response.body, input.generated.url);
  const outPath = path.join(
    input.assetDir,
    `ai-image-${input.assetId}${imageExtensionFromName(new URL(input.generated.url).pathname)}`,
  );
  await fs.writeFile(outPath, response.body);
  return outPath;
}

function imageDataUriToBuffer(dataUri: string): Buffer {
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(dataUri);
  if (!match?.[1]) throw new Error('Invalid generated image data URI');
  return Buffer.from(match[1], 'base64');
}

async function readGeneratedImageMetadata(
  filePath: string,
  root: string,
): Promise<MediaItem['metadata']> {
  try {
    const probe = await probeFile(filePath, root);
    const video = probe.streams.find((stream) => stream.codecType === 'video');
    return {
      durationMs: 0,
      width: video?.width,
      height: video?.height,
      codec: video?.codecName ?? probe.formatName,
      fileSize: probe.size,
    };
  } catch (error) {
    const stat = await fs.stat(filePath);
    logger.warn('video.pipeline.ai_image_probe_failed', {
      file: path.basename(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return { durationMs: 0, fileSize: stat.size };
  }
}

async function assetToDataUri(
  project: VideoProject,
  assetId: string,
  root: string,
): Promise<string> {
  const asset = project.assets.find((entry) => entry.id === assetId);
  if (!asset || asset.kind !== 'image') {
    throw new Error('Reference image asset not found');
  }
  const filePath = resolveProjectAssetPath(asset, root);
  const buffer = await fs.readFile(filePath);
  assertSupportedImageBuffer(buffer, filePath);
  return `data:${imageMimeFromPath(filePath)};base64,${buffer.toString('base64')}`;
}

function imageMimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.avif') return 'image/avif';
  return 'image/png';
}

function buildRegenerateAssetPlan(
  project: VideoProject,
  scene: StoryboardScene,
  input: RegenerateStoryboardSceneInput,
): Extract<AssetPlan, { kind: 'ai-clip' | 'ai-image' | 'lipsync' }> {
  const prompt = input.prompt?.trim() || scene.intent;
  const current = scene.assetPlan;
  if (current.kind === 'ai-image') {
    const refImageIds = input.refImageAssetId
      ? [input.refImageAssetId]
      : current.refImageIds;
    return {
      ...current,
      prompt,
      provider: (input.provider as ProviderId | undefined) ?? current.provider,
      refImageIds,
      seed: input.seed ?? current.seed,
    };
  }
  if (current.kind === 'ai-clip') {
    return {
      ...current,
      prompt,
      provider: (input.provider as ProviderId | undefined) ?? current.provider,
      refImageId: input.refImageAssetId ?? current.refImageId,
      refImageTailId: input.refImageTailAssetId ?? current.refImageTailId,
      durationMs: input.durationMs ?? current.durationMs ?? scene.durationMs,
      seed: input.seed ?? current.seed,
    };
  }
  if (current.kind === 'lipsync') {
    return {
      ...current,
      text: input.lipsyncText?.trim() || input.prompt?.trim() || current.text,
      voiceId: input.voiceId ?? current.voiceId,
      voiceProvider: input.voiceProvider ?? current.voiceProvider,
      referenceImageAssetId:
        input.refImageAssetId ?? current.referenceImageAssetId,
      lipsyncProvider:
        (input.provider as Extract<
          AssetPlan,
          { kind: 'lipsync' }
        >['lipsyncProvider']) ?? current.lipsyncProvider,
      motionScale: input.motionScale ?? current.motionScale,
      background: input.background ?? current.background,
      egressConfirmed:
        input.confirmReferenceUpload === true ? true : current.egressConfirmed,
    };
  }

  const existingAsset =
    current.kind === 'existing' || current.kind === 'image-pan'
      ? project.assets.find((asset) => asset.id === current.assetId)
      : undefined;
  if (existingAsset?.kind === 'image') {
    return {
      kind: 'ai-image',
      prompt,
      provider: input.provider as ProviderId | undefined,
      aspectRatio: '16:9',
      refImageIds: input.refImageAssetId ? [input.refImageAssetId] : undefined,
      seed: input.seed,
    };
  }
  return {
    kind: 'ai-clip',
    prompt,
    provider: (input.provider as ProviderId | undefined) ?? 'seedance-2-0-fast',
    aspectRatio: '16:9',
    durationMs: input.durationMs ?? scene.durationMs,
    refImageId: input.refImageAssetId,
    refImageTailId: input.refImageTailAssetId,
    seed: input.seed,
  };
}

function referenceIdsForPlan(
  plan: Extract<AssetPlan, { kind: 'ai-clip' | 'ai-image' | 'lipsync' }>,
): string[] {
  if (plan.kind === 'ai-image') return plan.refImageIds ?? [];
  if (plan.kind === 'lipsync') return [plan.referenceImageAssetId];
  return [plan.refImageId, plan.refImageTailId].filter((id): id is string =>
    Boolean(id),
  );
}

async function withProjectSceneLock<T>(
  projectId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = projectSceneLocks.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  projectSceneLocks.set(projectId, queued);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (projectSceneLocks.get(projectId) === queued) {
      projectSceneLocks.delete(projectId);
    }
  }
}

async function getProjectForRoot(
  projectId: string,
  root: string,
): Promise<VideoProject> {
  const raw = await fs.readFile(
    getVideoProjectJsonPathForRoot(root, projectId),
    'utf8',
  );
  return JSON.parse(raw) as VideoProject;
}

async function writeProjectForRoot(
  project: VideoProject,
  root: string,
): Promise<void> {
  const dir = getVideoProjectDirForRoot(root, project.id);
  await fs.mkdir(dir, { recursive: true });
  const filePath = getVideoProjectJsonPathForRoot(root, project.id);
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(project, null, 2)}\n`);
  await fs.rename(tmpPath, filePath);
}

function getVideoProjectJsonPathForRoot(
  root: string,
  projectId: string,
): string {
  return path.join(getVideoProjectDirForRoot(root, projectId), 'project.json');
}

function getVideoAssetsDirForRoot(root: string, projectId: string): string {
  return path.join(getVideoProjectDirForRoot(root, projectId), 'assets');
}

async function reloadAndUpdateRenderStatus(
  projectId: string,
  render: RenderStatus,
  output?: NonNullable<VideoProject['outputs']>[number],
): Promise<VideoProject> {
  const latest = await getProject(projectId);
  await updateRenderStatus(latest, render, output);
  // Phase 6 M4 — mirror every render-status update onto the resumable SSE
  // stream. Best-effort: a bus failure must never break the render.
  try {
    publishRenderStatus(projectId, render);
  } catch {
    // Streaming is observational; swallow.
  }
  return latest;
}

export interface SceneClip {
  inputPath: string;
  durationSec: number;
  sourceStartSec?: number;
  playback?: ClipPlayback;
  kind: 'image' | 'video';
  hasAudio?: boolean;
  color?: VideoColorMetadata;
  autoColorFilter?: string;
  reframe?: VideoReframePlan;
  imagePan?: Extract<AssetPlan, { kind: 'image-pan' }>;
  /** When true, fill the canvas with a blurred copy behind the contained media. */
  blurPad?: boolean;
  /** Canvas background behind contain-fit media, usually for logos. */
  background?: string;
  transitionToNext?: TimelineTransition;
  audioSeamToNext?: 'follow' | 'cut';
}

export interface AudioTrackClip {
  inputPath: string;
  role: 'music' | 'narration' | 'sfx';
  volume: number;
  gainDb?: number;
  trackVolumeDb?: number;
  keyframes?: KeyframeTrack[];
  timelineStartSec?: number;
  sourceStartSec?: number;
  durationSec?: number;
  playback?: ClipPlayback;
  fadeInMs?: number;
  fadeOutMs?: number;
  fadeInCurve?: EdlAudioClip['fadeInCurve'];
  fadeOutCurve?: EdlAudioClip['fadeOutCurve'];
}

export interface OverlayClip {
  inputPath: string;
  kind: EdlOverlay['kind'];
  mediaKind: 'image' | 'video';
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
  playback?: ClipPlayback;
  ptsShiftSec: number;
  color?: VideoColorMetadata;
  autoColorFilter?: string;
  imagePan?: Extract<AssetPlan, { kind: 'image-pan' }>;
  /**
   * Per-clip transform (position, scale, rotation, opacity). When present, the
   * overlay is letterbox-fit to the canvas as usual, then transformed and
   * composited. Semantics match the CSS transform applied in the Remotion
   * composer (rotate + scaleX/scaleY around center; positionX/Y are
   * normalized 0..1 of the canvas).
   */
  transforms?: ClipTransform;
  /** Optional entrance fade-in in seconds. */
  entranceSec?: number;
  /** Optional exit fade-out in seconds. */
  exitSec?: number;
}

export interface MultiSceneInput {
  projectId?: string;
  scenes: SceneClip[];
  overlays?: OverlayClip[];
  audioTracks?: AudioTrackClip[];
  captionFilePath?: string;
  introMs?: number;
  outroMs?: number;
  outputPath: string;
  aspectRatio: AspectRatio;
  mode: 'speed' | 'reproducible';
}

async function collectRenderableScenes(
  project: VideoProject,
  root: string,
  opts: {
    autoColorEnabled: boolean;
    autoReframeEnabled: boolean;
    aspectRatio: AspectRatio;
  },
): Promise<SceneClip[]> {
  const clips: SceneClip[] = [];
  const edl = compileTimelineToEdl(project, { aspectRatio: opts.aspectRatio });
  const probeCache = new Map<string, Awaited<ReturnType<typeof probeFile>>>();
  for (const segment of [...edl.segments].sort(compareEdlSegments)) {
    const { asset, imagePan, scene } =
      visualAssetForSegment(project, segment) ?? {};
    if (!asset || (asset.kind !== 'image' && asset.kind !== 'video')) continue;

    const isVideo = asset.kind === 'video';
    const inputPath = resolveProjectAssetPath(asset, root);
    const probe = isVideo
      ? await probeRenderableVideo(
          inputPath,
          root,
          probeCache,
          assetPathValidation(asset),
        )
      : undefined;
    const color =
      (probe ? colorMetadataFromProbe(probe) : undefined) ??
      colorMetadataFromMedia(asset.metadata);
    clips.push({
      inputPath,
      durationSec: Math.max(0.001, segment.durationMs / 1000),
      sourceStartSec: isVideo ? segment.sourceStartMs / 1000 : undefined,
      playback: segment.playback,
      kind: isVideo ? 'video' : 'image',
      hasAudio:
        !segment.muted &&
        isVideo &&
        (probe?.audioStreamCount ?? asset.metadata.audioTrackCount ?? 0) > 0,
      color,
      autoColorFilter: autoColorFilter(opts.autoColorEnabled),
      reframe: resolveReframePlan({
        aspectRatio: opts.aspectRatio,
        enabled: opts.autoReframeEnabled,
        override: scene?.reframe,
        assetPlanKind: scene?.assetPlan.kind,
      }),
      imagePan: !isVideo ? imagePan : undefined,
      blurPad: segment.transforms?.fit === 'blur-pad',
      background: segment.transforms?.background,
      transitionToNext: segment.transitionToNext ?? 'cut',
      audioSeamToNext: segment.audioSeamToNext,
    });
  }
  return clips;
}

async function probeRenderableVideo(
  inputPath: string,
  root: string,
  cache: Map<string, Awaited<ReturnType<typeof probeFile>>>,
  validation: PathValidationOptions = {},
): Promise<Awaited<ReturnType<typeof probeFile>>> {
  const cached = cache.get(inputPath);
  if (cached) return cached;
  const probe = await probeFile(inputPath, root, validation);
  cache.set(inputPath, probe);
  return probe;
}

function colorMetadataFromMedia(
  metadata: MediaItem['metadata'],
): VideoColorMetadata | undefined {
  return colorMetadataFromStream({
    index: 0,
    codecType: 'video',
    codecName: metadata.codec ?? 'unknown',
    pixelFormat: metadata.pixelFormat,
    colorTransfer: metadata.colorTransfer,
    colorPrimaries: metadata.colorPrimaries,
    colorSpace: metadata.colorSpace,
  });
}

async function materializeCachedSceneRenders(input: {
  projectId: string;
  scenes: SceneClip[];
  root: string;
  aspectRatio: AspectRatio;
  mode: 'speed' | 'reproducible';
  signal: AbortSignal;
}): Promise<{
  scenes: SceneClip[];
  stats: { sceneHits: number; sceneMisses: number };
}> {
  if (input.scenes.length <= 1) {
    return { scenes: input.scenes, stats: { sceneHits: 0, sceneMisses: 0 } };
  }

  const scenes: SceneClip[] = [];
  const stats = { sceneHits: 0, sceneMisses: 0 };
  for (const scene of input.scenes) {
    if (input.signal.aborted) throw new Error('Render cancelled');
    const hash = await renderSceneCacheKey({
      ...scene,
      aspectRatio: input.aspectRatio,
      mode: input.mode,
      root: input.root,
    });
    const hit = await getRenderCacheEntry({
      root: input.root,
      projectId: input.projectId,
      hash,
    });
    if (hit) {
      stats.sceneHits += 1;
      scenes.push(cachedSceneClip(scene, hit.absolutePath));
      continue;
    }

    const outputPath = renderCacheScenePath(input.root, input.projectId, hash);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const result = await runFFmpeg(
      buildRenderArgs({
        inputPath: scene.inputPath,
        outputPath,
        assetKind: scene.kind,
        durationSec: scene.durationSec,
        sourceStartSec: scene.sourceStartSec,
        playback: scene.playback,
        hasAudio: scene.hasAudio,
        aspectRatio: input.aspectRatio,
        mode: input.mode,
        imagePan: scene.imagePan,
        blurPad: scene.blurPad,
        background: scene.background,
        color: scene.color,
        autoColorFilter: scene.autoColorFilter,
        reframe: scene.reframe,
      }),
      {
        inputDuration: scene.durationSec,
        abortSignal: input.signal,
      },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `Scene cache render failed: ${result.stderr.slice(0, 500)}`,
      );
    }
    await recordRenderCacheEntry({
      root: input.root,
      projectId: input.projectId,
      hash,
      absolutePath: outputPath,
      metadata: {
        sourcePath: path.relative(input.root, scene.inputPath),
        durationSec: scene.durationSec,
        kind: scene.kind,
      },
    });
    stats.sceneMisses += 1;
    scenes.push(cachedSceneClip(scene, outputPath));
  }
  return { scenes, stats };
}

function cachedSceneClip(scene: SceneClip, inputPath: string): SceneClip {
  const {
    sourceStartSec: _sourceStartSec,
    playback: _playback,
    imagePan: _imagePan,
    color: _color,
    autoColorFilter: _autoColorFilter,
    reframe: _reframe,
    ...rest
  } = scene;
  return {
    ...rest,
    inputPath,
    kind: 'video',
  };
}

function compareEdlSegments(a: EdlSegment, b: EdlSegment): number {
  return a.timelineStartMs - b.timelineStartMs || a.id.localeCompare(b.id);
}

function visualAssetForSegment(
  project: VideoProject,
  segment: EdlSegment,
):
  | {
      asset: MediaItem;
      imagePan?: Extract<AssetPlan, { kind: 'image-pan' }>;
      scene?: StoryboardScene;
    }
  | undefined {
  const scene = segment.sceneId
    ? project.storyboard?.scenes.find((item) => item.id === segment.sceneId)
    : undefined;
  const sourceAsset = assetForSourceRef(project, segment.sourceRef);
  if (sourceAsset) {
    return {
      asset: sourceAsset,
      imagePan: imagePanForScene(scene, sourceAsset.id),
      ...(scene ? { scene } : {}),
    };
  }

  if (!scene) return undefined;
  const plan = scene.assetPlan;
  if (plan.kind === 'existing' || plan.kind === 'image-pan') {
    const asset = project.assets.find((item) => item.id === plan.assetId);
    return asset
      ? {
          asset,
          imagePan: imagePanForScene(scene, asset.id),
          ...(scene ? { scene } : {}),
        }
      : undefined;
  }
  return undefined;
}

function imagePanForScene(
  scene: StoryboardScene | undefined,
  assetId: string,
): Extract<AssetPlan, { kind: 'image-pan' }> | undefined {
  return scene?.assetPlan.kind === 'image-pan' &&
    scene.assetPlan.assetId === assetId
    ? scene.assetPlan
    : undefined;
}

async function collectProjectOverlays(
  project: VideoProject,
  root: string,
  opts: { aspectRatio: AspectRatio; autoColorEnabled: boolean },
): Promise<OverlayClip[]> {
  const clips: OverlayClip[] = [];
  const edl = compileTimelineToEdl(project, { aspectRatio: opts.aspectRatio });
  const probeCache = new Map<string, Awaited<ReturnType<typeof probeFile>>>();
  for (const overlay of [...edl.overlays].sort(compareEdlSegments)) {
    const { asset, imagePan } = visualAssetForSegment(project, overlay) ?? {};
    if (!asset || (asset.kind !== 'image' && asset.kind !== 'video')) continue;
    const inputPath = resolveProjectAssetPath(asset, root);
    const probe =
      asset.kind === 'video'
        ? await probeRenderableVideo(inputPath, root, probeCache)
        : undefined;

    clips.push({
      inputPath,
      kind: overlay.kind,
      mediaKind: asset.kind,
      timelineStartSec: overlay.timelineStartMs / 1000,
      sourceStartSec: overlay.sourceStartMs / 1000,
      durationSec: Math.max(0.001, overlay.durationMs / 1000),
      playback: overlay.playback,
      ptsShiftSec: overlayPtsShiftSec(overlay),
      color:
        (probe ? colorMetadataFromProbe(probe) : undefined) ??
        colorMetadataFromMedia(asset.metadata),
      autoColorFilter: autoColorFilter(opts.autoColorEnabled),
      imagePan: asset.kind === 'image' ? imagePan : undefined,
      transforms: overlay.transforms,
      entranceSec:
        typeof overlay.entranceMs === 'number'
          ? overlay.entranceMs / 1000
          : undefined,
      exitSec:
        typeof overlay.exitMs === 'number' ? overlay.exitMs / 1000 : undefined,
    });
  }
  return clips;
}

function collectProjectAudioTracks(
  project: VideoProject,
  root: string,
): AudioTrackClip[] {
  const tracks: AudioTrackClip[] = [];
  const edl = compileTimelineToEdl(project);
  for (const track of edl.audioTracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      if (clip.muted) continue;
      const asset = assetForSourceRef(project, clip.sourceRef);
      if (!assetCanProvideAudio(asset)) continue;
      tracks.push(audioTrackClipFromEdl(track, clip, asset, root));
    }
  }
  return tracks;
}

/**
 * Build audio clips for the project soundtrack (Phase 5 mux). Returns the music
 * bed and narration bed as full-length `AudioTrackClip`s so the existing
 * `amix` + `alimiter` path mixes them under the scene audio.
 *
 * Ducking is the static-dB model html-video uses: music defaults to −18 dB
 * (`resolveSoundtrackGains`), narration to 0 dB. Fades apply to the music bed
 * only (narration is speech); the fade-out defaults to `min(1.5s, dur/3)`.
 * Missing/non-audio assets are skipped rather than failing the render — the QA
 * pass surfaces missing media separately.
 */
export function collectSoundtrackAudioTracks(
  project: VideoProject,
  root: string,
  totalDurationSec: number,
): AudioTrackClip[] {
  const soundtrack = project.soundtrack;
  if (!soundtrack) return [];
  const { musicVolumeDb, narrationVolumeDb } =
    resolveSoundtrackGains(soundtrack);
  const tracks: AudioTrackClip[] = [];

  const resolveAudioPath = (assetId?: string): string | undefined => {
    if (!assetId) return undefined;
    const asset = project.assets.find((item) => item.id === assetId);
    if (!assetCanProvideAudio(asset)) return undefined;
    // Skip non-fatally when the backing file is gone (purged upload, path
    // mismatch) or fails path validation — a missing soundtrack asset must not
    // abort the whole render. validateInputFile throws in both cases.
    try {
      return resolveProjectAssetPath(asset, root);
    } catch (error) {
      logger.warn('video.soundtrack.audio_asset_unresolved', {
        assetId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  };

  const musicPath = resolveAudioPath(soundtrack.musicAssetId);
  if (musicPath) {
    const fadeInMs = Math.max(0, (soundtrack.fadeInSec ?? 0) * 1000);
    const fadeOutSec =
      soundtrack.fadeOutSec ?? defaultSoundtrackFadeOutSec(totalDurationSec);
    tracks.push({
      inputPath: musicPath,
      role: 'music',
      volume: dbToVolume(musicVolumeDb),
      fadeInMs,
      fadeOutMs: Math.max(0, fadeOutSec * 1000),
    });
  }

  const narrationPath = resolveAudioPath(soundtrack.narrationAssetId);
  if (narrationPath) {
    tracks.push({
      inputPath: narrationPath,
      role: 'narration',
      volume: dbToVolume(narrationVolumeDb),
    });
  }

  return tracks;
}

function collectMissingMedia(project: VideoProject): VideoQaMissingMedia[] {
  const edl = compileTimelineToEdl(project);
  const missing: VideoQaMissingMedia[] = [];
  const seen = new Set<string>();
  const pushMissing = (
    entry: VideoQaMissingMedia & { sourceRef: TimelineSourceRef },
  ) => {
    const key = [
      entry.sceneId ?? '',
      entry.trackId ?? '',
      entry.clipId ?? '',
      JSON.stringify(entry.sourceRef),
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    missing.push(entry);
  };

  for (const segment of [...edl.segments, ...edl.overlays]) {
    const visual = visualAssetForSegment(project, segment);
    if (visual?.asset && !isReferencedProjectAsset(visual.asset)) continue;
    pushMissing({
      sceneId: segment.sceneId,
      trackId: segment.trackId,
      clipId: segment.clipId,
      sourceRef: segment.sourceRef,
    });
  }

  for (const track of edl.audioTracks) {
    for (const clip of track.clips) {
      const asset = assetForSourceRef(project, clip.sourceRef);
      if (asset && !isReferencedProjectAsset(asset)) continue;
      pushMissing({
        sceneId: clip.sceneId,
        trackId: track.id,
        clipId: clip.clipId,
        sourceRef: clip.sourceRef,
      });
    }
  }

  return missing;
}

function timelineBookendsForRender(project: VideoProject): {
  introMs?: number;
  outroMs?: number;
} {
  return {
    introMs: project.timeline?.intro?.durationMs,
    outroMs: project.timeline?.outro?.durationMs,
  };
}

function audioTrackClipFromEdl(
  track: EdlAudioTrack,
  clip: EdlAudioClip,
  asset: MediaItem,
  root: string,
): AudioTrackClip {
  return {
    inputPath: resolveProjectAssetPath(asset, root),
    role: audioRoleFromTrack(track),
    volume: dbToVolume((track.volumeDb ?? 0) + (clip.gainDb ?? 0)),
    gainDb: clip.gainDb,
    trackVolumeDb: track.volumeDb,
    keyframes: clip.keyframes,
    timelineStartSec: clip.timelineStartMs / 1000,
    sourceStartSec: clip.sourceStartMs / 1000,
    durationSec: clip.durationMs / 1000,
    playback: clip.playback,
    fadeInMs: clip.fadeInMs,
    fadeOutMs: clip.fadeOutMs,
    fadeInCurve: clip.fadeInCurve,
    fadeOutCurve: clip.fadeOutCurve,
  };
}

function audioRoleFromTrack(track: EdlAudioTrack): AudioTrackClip['role'] {
  if (track.kind === 'audio-music') return 'music';
  if (track.kind === 'audio-sfx') return 'sfx';
  return 'narration';
}

function assetForSourceRef(
  project: VideoProject,
  sourceRef: TimelineSourceRef,
): MediaItem | undefined {
  if (sourceRef.kind !== 'asset') return undefined;
  return project.assets.find((asset) => asset.id === sourceRef.assetId);
}

async function ensureCloudRenderConsent(
  project: VideoProject,
  providerId: string,
  confirmed?: boolean,
): Promise<VideoProject> {
  const existing =
    project.settings?.cloudRenderConsents?.[providerId]?.confirmed === true;
  if (!existing && !confirmed) {
    throw new Error(
      `Cloud render requires confirmation before uploading project assets to ${providerId}`,
    );
  }
  const next: VideoProject = {
    ...project,
    settings: {
      ...(project.settings ?? {}),
      renderWhere: 'cloud',
      cloudRenderProviderId: providerId,
      cloudRenderConsents: {
        ...(project.settings?.cloudRenderConsents ?? {}),
        [providerId]: {
          confirmed: true,
          confirmedAt:
            project.settings?.cloudRenderConsents?.[providerId]?.confirmedAt ??
            new Date().toISOString(),
        },
      },
    },
  };
  await writeProject(next);
  return next;
}

function buildRenderGraph(input: {
  projectId: string;
  scenes: SceneClip[];
  overlays: OverlayClip[];
  audioTracks: AudioTrackClip[];
  captionFilePath?: string;
  aspectRatio: AspectRatio;
  mode: 'speed' | 'reproducible';
  loudnessTargetLufs?: LoudnessTargetLufs;
  introMs?: number;
  outroMs?: number;
}): RenderGraph {
  const totalDurationSec = input.scenes.reduce(
    (total, scene) => total + scene.durationSec,
    0,
  );
  return {
    schema: 'neuma.video.render-graph.v1',
    scenes: input.scenes.map((scene, index) => ({
      id: `scene-${index + 1}`,
      assetName: sceneAssetName(scene.inputPath, index),
      durationSec: scene.durationSec,
      sourceStartSec: scene.sourceStartSec,
      playback: scene.playback,
      kind: scene.kind,
      hasAudio: scene.hasAudio,
      color: scene.color,
      autoColorFilter: scene.autoColorFilter,
      reframe: scene.reframe,
      imagePan: scene.imagePan,
      transitionToNext: scene.transitionToNext,
      audioSeamToNext: scene.audioSeamToNext,
    })),
    overlays: input.overlays.map((overlay, index) => ({
      id: `overlay-${index + 1}`,
      assetName: overlayAssetName(overlay.inputPath, index),
      kind: overlay.kind,
      mediaKind: overlay.mediaKind,
      timelineStartSec: overlay.timelineStartSec,
      sourceStartSec: overlay.sourceStartSec,
      durationSec: overlay.durationSec,
      playback: overlay.playback,
      ptsShiftSec: overlay.ptsShiftSec,
      color: overlay.color,
      autoColorFilter: overlay.autoColorFilter,
      imagePan: overlay.imagePan,
    })),
    audioTracks: input.audioTracks.map((track, index) => ({
      assetName: audioAssetName(track.inputPath, index),
      role: track.role,
      volume: track.volume,
      timelineStartSec: track.timelineStartSec,
      sourceStartSec: track.sourceStartSec,
      durationSec: track.durationSec,
      playback: track.playback,
      fadeInMs: track.fadeInMs,
      fadeOutMs: track.fadeOutMs,
    })),
    captionAssetName: input.captionFilePath
      ? captionAssetName(input.captionFilePath)
      : undefined,
    aspectRatio: input.aspectRatio,
    mode: input.mode,
    loudnessTargetLufs: input.loudnessTargetLufs,
    totalDurationSec,
    introMs: input.introMs,
    outroMs: input.outroMs,
    renderer: {
      image: PINNED_RENDERER_IMAGE,
      version: PINNED_RENDERER_VERSION,
    },
  };
}

async function buildRenderAssetManifest(input: {
  projectId: string;
  scenes: SceneClip[];
  overlays: OverlayClip[];
  audioTracks: AudioTrackClip[];
  captionFilePath?: string;
}): Promise<RenderAssetManifestItem[]> {
  const items: RenderAssetManifestItem[] = [];
  for (const [index, scene] of input.scenes.entries()) {
    items.push(
      await createAssetManifestItem({
        localAbsPath: scene.inputPath,
        name: sceneAssetName(scene.inputPath, index),
        role: 'scene',
        projectId: input.projectId,
        sourcePath: scene.inputPath,
      }),
    );
  }
  for (const [index, overlay] of input.overlays.entries()) {
    items.push(
      await createAssetManifestItem({
        localAbsPath: overlay.inputPath,
        name: overlayAssetName(overlay.inputPath, index),
        role: 'overlay',
        projectId: input.projectId,
        sourcePath: overlay.inputPath,
      }),
    );
  }
  for (const [index, track] of input.audioTracks.entries()) {
    items.push(
      await createAssetManifestItem({
        localAbsPath: track.inputPath,
        name: audioAssetName(track.inputPath, index),
        role: 'audio',
        projectId: input.projectId,
        sourcePath: track.inputPath,
      }),
    );
  }
  if (input.captionFilePath) {
    items.push(
      await createAssetManifestItem({
        localAbsPath: input.captionFilePath,
        name: captionAssetName(input.captionFilePath),
        role: 'caption',
        projectId: input.projectId,
        sourcePath: input.captionFilePath,
      }),
    );
  }
  return items;
}

function sceneAssetName(filePath: string, index: number): string {
  return `scene-${index + 1}${path.extname(filePath) || '.bin'}`;
}

function overlayAssetName(filePath: string, index: number): string {
  return `overlay-${index + 1}${path.extname(filePath) || '.bin'}`;
}

function audioAssetName(filePath: string, index: number): string {
  return `audio-${index + 1}${path.extname(filePath) || '.bin'}`;
}

function captionAssetName(filePath: string): string {
  return `captions${path.extname(filePath) || '.srt'}`;
}

export function buildRenderArgs(input: {
  inputPath: string;
  outputPath: string;
  assetKind: 'image' | 'video';
  durationSec: number;
  sourceStartSec?: number;
  playback?: ClipPlayback;
  hasAudio?: boolean;
  aspectRatio: AspectRatio;
  mode: 'speed' | 'reproducible';
  imagePan?: Extract<AssetPlan, { kind: 'image-pan' }>;
  blurPad?: boolean;
  background?: string;
  color?: VideoColorMetadata;
  autoColorFilter?: string;
  reframe?: VideoReframePlan;
  introMs?: number;
  outroMs?: number;
  captionFilePath?: string;
}): string[] {
  const size = canvasForAspect(input.aspectRatio);
  const stillImageFilters = normalizedVideoFilters(
    size,
    input.color,
    input.autoColorFilter,
    input.reframe,
    input.blurPad ? 0 : undefined,
    undefined,
    input.background,
  );
  const withCaptions = (filter: string) =>
    input.captionFilePath
      ? `${filter},${subtitleVideoFilter(input.captionFilePath)}`
      : filter;

  if (input.assetKind === 'image') {
    const imageFilters =
      input.imagePan && !input.blurPad
        ? [
            kenBurnsFilter(input.imagePan, input.durationSec, size),
            ...buildVideoColorFilters({
              autoColorFilter: input.autoColorFilter,
            }),
            'setsar=1',
            'format=yuv420p',
            'setpts=PTS-STARTPTS',
          ].join(',')
        : stillImageFilters;
    return [
      '-loop',
      '1',
      '-t',
      String(input.durationSec),
      '-i',
      input.inputPath,
      ...visualFilterArgs(
        withBookendVideoFilters(
          withCaptions(imageFilters),
          input.durationSec,
          input.introMs,
          input.outroMs,
        ),
        { blurPad: Boolean(input.blurPad), hasAudio: false },
      ),
      ...videoCodecArgs(input.mode),
      '-an',
      '-movflags',
      '+faststart',
      input.outputPath,
    ];
  }

  return [
    ...sourceSeekArgs(input.sourceStartSec),
    '-t',
    String(sourceDurationSec(input.durationSec, input.playback)),
    '-i',
    input.inputPath,
    ...visualFilterArgs(
      withBookendVideoFilters(
        withCaptions(
          normalizedVideoFilters(
            size,
            input.color,
            input.autoColorFilter,
            input.reframe,
            input.blurPad ? 0 : undefined,
            input.playback,
            input.background,
          ),
        ),
        input.durationSec,
        input.introMs,
        input.outroMs,
      ),
      { blurPad: Boolean(input.blurPad), hasAudio: input.hasAudio !== false },
    ),
    ...videoCodecArgs(input.mode),
    ...(input.hasAudio === false
      ? ['-an']
      : [
          ...audioFilterArgs(
            [
              ...audioPlaybackFilters(input.playback),
              ...(playbackRequiresRetime(input.playback)
                ? ['asetpts=PTS-STARTPTS']
                : []),
              ...(bookendAudioFilters(
                input.durationSec,
                input.introMs,
                input.outroMs,
              )?.split(',') ?? []),
            ].join(','),
          ),
          ...audioCodecArgs(),
        ]),
    '-movflags',
    '+faststart',
    input.outputPath,
  ];
}

export function buildMultiSceneRenderArgs(input: MultiSceneInput): string[] {
  if (input.scenes.length === 0) {
    throw new Error('At least one scene is required to render');
  }

  const size = canvasForAspect(input.aspectRatio);
  const inputArgs: string[] = [];
  const filters: string[] = [];
  const videoLabels: string[] = [];
  const audioLabels: string[] = [];
  let nextInputIndex = 0;

  input.scenes.forEach((scene, sceneIndex) => {
    const mediaInputIndex = nextInputIndex++;
    if (scene.kind === 'image') {
      inputArgs.push(
        '-loop',
        '1',
        '-t',
        formatSeconds(scene.durationSec),
        '-i',
        scene.inputPath,
      );
    } else {
      inputArgs.push(
        ...sourceSeekArgs(scene.sourceStartSec),
        '-t',
        formatSeconds(sourceDurationSec(scene.durationSec, scene.playback)),
        '-i',
        scene.inputPath,
      );
    }

    const videoLabel = `v${sceneIndex}`;
    videoLabels.push(`[${videoLabel}]`);
    filters.push(
      `[${mediaInputIndex}:v]${sceneVideoFilter(scene, size, sceneIndex)}[${videoLabel}]`,
    );

    const audioLabel = `a${sceneIndex}`;
    audioLabels.push(`[${audioLabel}]`);
    if (scene.hasAudio) {
      filters.push(
        `[${mediaInputIndex}:a]${normalizedAudioFilters(scene.playback)}[${audioLabel}]`,
      );
    } else {
      const silentInputIndex = nextInputIndex++;
      inputArgs.push(
        '-f',
        'lavfi',
        '-t',
        formatSeconds(scene.durationSec),
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=48000',
      );
      filters.push(
        [
          `[${silentInputIndex}:a]atrim=duration=${formatSeconds(scene.durationSec)}`,
          normalizedAudioFilters(),
        ].join(',') + `[${audioLabel}]`,
      );
    }
  });

  let currentVideo = videoLabels[0]!;
  let currentAudio = audioLabels[0]!;
  let currentDurationSec = input.scenes[0]!.durationSec;

  for (let index = 1; index < input.scenes.length; index++) {
    const previous = input.scenes[index - 1]!;
    const scene = input.scenes[index]!;
    const transition = ffmpegTransitionForSeam(
      previous.transitionToNext,
      input.projectId,
      index,
    );
    const videoOut = `vjoin${index}`;
    const audioOut = `ajoin${index}`;

    if (transition.kind === 'cut') {
      filters.push(
        `${currentVideo}${videoLabels[index]}concat=n=2:v=1:a=0[${videoOut}]`,
      );
      filters.push(
        `${currentAudio}${audioLabels[index]}concat=n=2:v=0:a=1[${audioOut}]`,
      );
      currentDurationSec += scene.durationSec;
    } else {
      const transitionDuration = Math.min(
        (transition.durationMs ?? CROSSFADE_DURATION_SEC * 1000) / 1000,
        currentDurationSec,
        scene.durationSec,
      );
      const offset = Math.max(0, currentDurationSec - transitionDuration);
      const duration = formatSeconds(transitionDuration);
      filters.push(
        `${currentVideo}${videoLabels[index]}xfade=transition=${xfadeName(transition)}:duration=${duration}:offset=${formatSeconds(offset)}[${videoOut}]`,
      );
      if (previous.audioSeamToNext === 'cut') {
        filters.push(
          `${currentAudio}${audioLabels[index]}concat=n=2:v=0:a=1[${audioOut}]`,
        );
      } else {
        filters.push(
          `${currentAudio}${audioLabels[index]}acrossfade=d=${duration}[${audioOut}]`,
        );
      }
      currentDurationSec += scene.durationSec - transitionDuration;
    }

    currentVideo = `[${videoOut}]`;
    currentAudio = `[${audioOut}]`;
  }

  for (const [index, overlay] of (input.overlays ?? []).entries()) {
    const overlayInputIndex = nextInputIndex++;
    if (overlay.mediaKind === 'image') {
      inputArgs.push(
        '-loop',
        '1',
        '-t',
        formatSeconds(overlay.durationSec),
        '-i',
        overlay.inputPath,
      );
    } else {
      inputArgs.push('-i', overlay.inputPath);
    }

    const overlayLabel = `overlay${index}`;
    filters.push(
      `[${overlayInputIndex}:v]${overlayVideoFilter(overlay, size)}[${overlayLabel}]`,
    );
    const videoOut = `voverlay${index}`;
    const overlayPosition = overlayPositionExpression(overlay.transforms);
    filters.push(
      `${currentVideo}[${overlayLabel}]overlay=${overlayPosition}eof_action=pass:shortest=0:format=auto[${videoOut}]`,
    );
    currentVideo = `[${videoOut}]`;
  }

  if (input.captionFilePath) {
    filters.push(
      `${currentVideo}${subtitleVideoFilter(input.captionFilePath)}[vsub]`,
    );
    currentVideo = '[vsub]';
  }

  const bookendVideoFilter = bookendVideoFilters(
    currentDurationSec,
    input.introMs,
    input.outroMs,
  );
  if (bookendVideoFilter) {
    filters.push(`${currentVideo}${bookendVideoFilter}[vbookend]`);
    currentVideo = '[vbookend]';
  }

  const audioMixLabels = [currentAudio];
  for (const [index, track] of (input.audioTracks ?? []).entries()) {
    const audioInputIndex = nextInputIndex++;
    inputArgs.push('-i', track.inputPath);
    const label = `trackaudio${index}`;
    filters.push(
      `[${audioInputIndex}:a]${normalizedAdditionalAudioFilters(
        track,
        currentDurationSec,
      )}[${label}]`,
    );
    audioMixLabels.push(`[${label}]`);
  }

  if (audioMixLabels.length > 1) {
    filters.push(
      `${audioMixLabels.join('')}amix=inputs=${audioMixLabels.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`,
    );
    currentAudio = '[aout]';
  }

  const bookendAudioFilter = bookendAudioFilters(
    currentDurationSec,
    input.introMs,
    input.outroMs,
  );
  if (bookendAudioFilter) {
    filters.push(`${currentAudio}${bookendAudioFilter}[abookend]`);
    currentAudio = '[abookend]';
  }

  return [
    ...inputArgs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    currentVideo,
    '-map',
    currentAudio,
    ...videoCodecArgs(input.mode),
    ...audioCodecArgs(),
    '-movflags',
    '+faststart',
    input.outputPath,
  ];
}

function sceneVideoFilter(
  scene: SceneClip,
  size: { width: number; height: number },
  uid: number,
): string {
  if (scene.blurPad) {
    return normalizedVideoFilters(
      size,
      scene.color,
      scene.autoColorFilter,
      undefined,
      uid,
      scene.playback,
      scene.background,
    );
  }
  if (scene.imagePan) {
    return [
      kenBurnsFilter(scene.imagePan, scene.durationSec, size),
      ...buildVideoColorFilters({ autoColorFilter: scene.autoColorFilter }),
      'setsar=1',
      'format=yuv420p',
      'setpts=PTS-STARTPTS',
    ].join(',');
  }
  return normalizedVideoFilters(
    size,
    scene.color,
    scene.autoColorFilter,
    scene.reframe,
    undefined,
    scene.playback,
    scene.background,
  );
}

function overlayVideoFilter(
  overlay: OverlayClip,
  size: { width: number; height: number },
): string {
  const filters =
    overlay.imagePan && overlay.mediaKind === 'image'
      ? [
          kenBurnsFilter(overlay.imagePan, overlay.durationSec, size),
          ...buildVideoColorFilters({
            autoColorFilter: overlay.autoColorFilter,
          }),
          'setsar=1',
          'format=yuva420p',
        ]
      : [
          `trim=start=${formatSeconds(overlay.sourceStartSec)}:duration=${formatSeconds(
            sourceDurationSec(overlay.durationSec, overlay.playback),
          )}`,
          ...videoPlaybackPreFilters(overlay.playback),
          ...normalizedOverlayVideoFilters(
            size,
            overlay.color,
            overlay.autoColorFilter,
            overlay.transforms?.background,
          ),
          ...playbackSetptsFilters(overlay.playback),
        ];
  return [
    ...filters,
    ...overlayTransformFilters(overlay.transforms),
    ...overlayFadeFilters(
      overlay.entranceSec,
      overlay.exitSec,
      overlay.durationSec,
    ),
    ptsShiftFilter(
      playbackRequiresRetime(overlay.playback)
        ? overlay.timelineStartSec
        : overlay.ptsShiftSec,
    ),
  ].join(',');
}

/**
 * Per-clip entrance / exit fade applied on the overlay content stream before
 * the final `overlay=` composite. We use the alpha-aware `fade` filter so the
 * underlying base scene shows through cleanly. Clamped so adjacent fades
 * never extend past the clip and the existing filter-graph stays unchanged
 * when both values are absent or zero.
 */
function overlayFadeFilters(
  entranceSec: number | undefined,
  exitSec: number | undefined,
  durationSec: number,
): string[] {
  const filters: string[] = [];
  const dur = Math.max(0.001, durationSec);
  const inSec = Math.max(0, Math.min(entranceSec ?? 0, dur));
  const outSec = Math.max(0, Math.min(exitSec ?? 0, dur - inSec));
  if (inSec > 0) {
    filters.push(`fade=t=in:st=0:d=${formatSeconds(inSec)}:alpha=1`);
  }
  if (outSec > 0) {
    filters.push(
      `fade=t=out:st=${formatSeconds(dur - outSec)}:d=${formatSeconds(outSec)}:alpha=1`,
    );
  }
  return filters;
}

/**
 * Filter steps for per-clip transforms applied to the *content* stream of an
 * overlay. The content is already letterbox-fit to canvas size when this runs,
 * so:
 *   - opacity multiplies alpha (requires rgba round-trip)
 *   - rotation rotates around content center; output bbox grows to fit
 *   - scale uniformly scales the resulting frame around its center
 * Order matches the CSS `rotate → scale` applied in the Remotion composer.
 * Returns `[]` when transforms are absent or all neutral so the existing
 * filter strings stay byte-identical for unchanged content.
 */
function overlayTransformFilters(
  transforms: ClipTransform | undefined,
): string[] {
  if (!transforms) return [];
  const filters: string[] = [];
  const opacity = transforms.opacity;
  if (typeof opacity === 'number' && opacity < 0.999) {
    const clamped = Math.max(0, Math.min(1, opacity));
    filters.push(
      'format=rgba',
      `colorchannelmixer=aa=${formatFloat(clamped)}`,
      'format=yuva420p',
    );
  }
  const rotation = transforms.rotation;
  if (typeof rotation === 'number' && Math.abs(rotation) > 0.01) {
    const rad = (rotation * Math.PI) / 180;
    // `c=none` keeps transparent fill; bbox grows so corners don't clip.
    filters.push(
      `rotate=${formatFloat(rad)}:c=none:ow=rotw(${formatFloat(rad)}):oh=roth(${formatFloat(rad)})`,
    );
  }
  // Independent scaleX/scaleY take precedence over the uniform `scale`
  // field. When one axis is missing it falls back to the uniform value so
  // legacy projects render identically.
  const uniform = transforms.scale ?? 1;
  const scaleX = transforms.scaleX ?? uniform;
  const scaleY = transforms.scaleY ?? uniform;
  if (Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001) {
    const sx = Math.max(0.05, Math.min(8, scaleX));
    const sy = Math.max(0.05, Math.min(8, scaleY));
    filters.push(`scale=iw*${formatFloat(sx)}:ih*${formatFloat(sy)}`);
  }
  return filters;
}

/**
 * `overlay=` x:y expression for a transformed overlay. When the overlay
 * carries no transforms we return `''` so the existing
 * `overlay=eof_action=...` string is unchanged (backward-compatible with
 * golden filter-graph tests).
 *
 * positionX/Y are canvas-relative center coordinates (0..1). Default 0.5
 * centers the overlay regardless of its post-transform size, matching the
 * Remotion composer.
 */
function overlayPositionExpression(
  transforms: ClipTransform | undefined,
): string {
  if (!transforms) return '';
  const posX = transforms.positionX;
  const posY = transforms.positionY;
  const hasX = typeof posX === 'number' && Math.abs(posX - 0.5) > 0.0005;
  const hasY = typeof posY === 'number' && Math.abs(posY - 0.5) > 0.0005;
  const uniform = transforms.scale ?? 1;
  const scaleX = transforms.scaleX ?? uniform;
  const scaleY = transforms.scaleY ?? uniform;
  const hasScale = Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001;
  const hasRotation =
    typeof transforms.rotation === 'number' &&
    Math.abs(transforms.rotation) > 0.01;
  if (!hasX && !hasY && !hasScale && !hasRotation) return '';
  const offX =
    typeof posX === 'number' ? formatFloat(posX - 0.5) : formatFloat(0);
  const offY =
    typeof posY === 'number' ? formatFloat(posY - 0.5) : formatFloat(0);
  return `x=(W-w)/2+W*(${offX}):y=(H-h)/2+H*(${offY}):`;
}

function formatFloat(value: number): string {
  // 4 decimal places is enough for canvas-relative coords and avoids 1e-7
  // jitter when converting from React state to the filter graph.
  return Number.isFinite(value) ? value.toFixed(4) : '0';
}

const BLUR_PAD_RADIUS = 20;

/**
 * blur-pad geometry: fill the canvas with a blurred, cover-cropped copy of the
 * source, then overlay the whole source (contain-fit) centered. Returns a
 * filtergraph segment ending at the overlay output (no leading `[in]`, no
 * trailing label). `uid` keeps the intermediate pad labels unique when many
 * scenes share one filtergraph (multi-scene path). Mirrors RemotionBlurPad.tsx.
 */
function blurPadGeometry(
  size: { width: number; height: number },
  uid: number,
): string {
  const { width: w, height: h } = size;
  return [
    `split[bpa${uid}][bpb${uid}]`,
    `[bpa${uid}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=${BLUR_PAD_RADIUS}:1[bpbg${uid}]`,
    `[bpb${uid}]scale=${w}:${h}:force_original_aspect_ratio=decrease[bpfg${uid}]`,
    `[bpbg${uid}][bpfg${uid}]overlay=(W-w)/2:(H-h)/2`,
  ].join(';');
}

/**
 * Build the FFmpeg video-filter args for a single-clip render. A plain `,`-chain
 * goes through `-vf`; a blur-pad chain contains `split`/`overlay` (`;`-separated
 * sub-graphs) which `-vf` rejects, so it must go through `-filter_complex` with
 * explicit stream maps ([vout] for video, 0:a? for audio).
 */
function visualFilterArgs(
  filter: string,
  opts: { blurPad: boolean; hasAudio: boolean },
): string[] {
  if (!opts.blurPad) return ['-vf', filter];
  return [
    '-filter_complex',
    `[0:v]${filter}[vout]`,
    '-map',
    '[vout]',
    ...(opts.hasAudio ? ['-map', '0:a?'] : []),
  ];
}

function normalizedVideoFilters(
  size: {
    width: number;
    height: number;
  },
  color?: VideoColorMetadata,
  autoColorFilter?: string,
  reframe?: VideoReframePlan,
  blurPadUid?: number,
  playback?: ClipPlayback,
  background?: string,
): string {
  const geometryFilters =
    blurPadUid !== undefined
      ? [blurPadGeometry(size, blurPadUid)]
      : reframe
        ? buildReframeCropFilters(size, reframe)
        : [
            `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`,
            `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=${ffmpegColor(background)}`,
          ];
  return [
    ...videoPlaybackPreFilters(playback),
    ...buildVideoColorFilters({ color, autoColorFilter }),
    ...geometryFilters,
    'fps=30',
    'setsar=1',
    'format=yuv420p',
    playbackSetptsFilter(playback),
  ].join(',');
}

function ffmpegColor(background: string | undefined): string {
  return ffmpegColorOr(background, 'black');
}

function ffmpegColorOr(
  background: string | undefined,
  fallback: string,
): string {
  const value = background?.trim().toLowerCase();
  if (!value) return fallback;
  if (/^#[0-9a-f]{6}$/.test(value)) return `0x${value.slice(1)}`;
  if (/^[a-z]+(?:@[0-9.]+)?$/.test(value)) return value;
  return fallback;
}

function sourceDurationSec(
  timelineDurationSec: number,
  playback?: ClipPlayback,
): number {
  const { speed } = normalizeClipPlayback(playback);
  return Math.max(0.001, timelineDurationSec * speed);
}

function overlayPtsShiftSec(overlay: EdlOverlay): number {
  return playbackRequiresRetime(overlay.playback)
    ? overlay.timelineStartMs / 1000
    : (overlay.ptsShiftMs ?? 0) / 1000;
}

function videoPlaybackPreFilters(playback?: ClipPlayback): string[] {
  // FFmpeg reverse buffers the trimmed segment, so keep source trims tight
  // before this filter is applied.
  return normalizeClipPlayback(playback).reverse ? ['reverse'] : [];
}

function playbackSetptsFilters(playback?: ClipPlayback): string[] {
  return playbackRequiresRetime(playback)
    ? [playbackSetptsFilter(playback)]
    : [];
}

function playbackSetptsFilter(playback?: ClipPlayback): string {
  const { speed } = normalizeClipPlayback(playback);
  return Math.abs(speed - 1) > 0.0001
    ? `setpts=(PTS-STARTPTS)/${formatSeconds(speed)}`
    : 'setpts=PTS-STARTPTS';
}

function playbackRequiresRetime(playback?: ClipPlayback): boolean {
  const normalized = normalizeClipPlayback(playback);
  return normalized.reverse || Math.abs(normalized.speed - 1) > 0.0001;
}

function normalizedOverlayVideoFilters(
  size: {
    width: number;
    height: number;
  },
  color?: VideoColorMetadata,
  autoColorFilter?: string,
  background?: string,
): string[] {
  return [
    ...buildVideoColorFilters({ color, autoColorFilter }),
    `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`,
    `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=${ffmpegColorOr(background, 'black@0')}`,
    'fps=30',
    'setsar=1',
    'format=yuva420p',
  ];
}

function normalizedAudioFilters(playback?: ClipPlayback): string {
  return [
    ...audioPlaybackFilters(playback),
    audioFormatFilter(),
    'asetpts=PTS-STARTPTS',
  ].join(',');
}

function audioPlaybackFilters(playback?: ClipPlayback): string[] {
  const normalized = normalizeClipPlayback(playback);
  return [
    // Like video reverse, areverse buffers the trimmed segment before output.
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
    // One atempo=0.5 stage halves speed, so double the residual toward 1.
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 0.0001) {
    filters.push(`atempo=${formatSeconds(remaining)}`);
  }
  return filters;
}

function normalizedAdditionalAudioFilters(
  track: AudioTrackClip,
  totalDurationSec: number,
): string {
  const clipDurationSec = Math.max(
    0.001,
    track.durationSec ?? totalDurationSec,
  );
  const timelineStartMs = Math.max(
    0,
    Math.round((track.timelineStartSec ?? 0) * 1000),
  );
  const fadeInSec = clampedFadeSec(track.fadeInMs, clipDurationSec);
  const fadeOutSec = clampedFadeSec(track.fadeOutMs, clipDurationSec);
  const filters = [
    `atrim=start=${formatSeconds(track.sourceStartSec ?? 0)}:duration=${formatSeconds(
      sourceDurationSec(clipDurationSec, track.playback),
    )}`,
    ...audioPlaybackFilters(track.playback),
    audioFormatFilter(),
    audioVolumeFilter(track),
  ];
  if (fadeInSec > 0) {
    filters.push(
      `afade=t=in:st=0:d=${formatSeconds(fadeInSec)}:curve=${mapAudioFadeCurveToFfmpeg(track.fadeInCurve, 'in')}`,
    );
  }
  if (fadeOutSec > 0) {
    filters.push(
      `afade=t=out:st=${formatSeconds(Math.max(0, clipDurationSec - fadeOutSec))}:d=${formatSeconds(fadeOutSec)}:curve=${mapAudioFadeCurveToFfmpeg(track.fadeOutCurve, 'out')}`,
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

function audioVolumeFilter(track: AudioTrackClip): string {
  const volumeTrack = findKeyframeTrack(track.keyframes, 'volumeDb');
  if (!volumeTrack) return `volume=${formatVolume(track.volume)}`;
  const volumeDbExpression = ffmpegVolumeDbExpression(volumeTrack);
  if (!volumeDbExpression) return `volume=${formatVolume(track.volume)}`;
  const trackVolumeDb = formatExpressionNumber(track.trackVolumeDb ?? 0);
  const expression = `min(2,pow(10,(${trackVolumeDb}+${volumeDbExpression})/20))`;
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

function escapeFilterExpression(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/,/g, '\\,');
}

function withBookendVideoFilters(
  baseFilter: string,
  totalDurationSec: number,
  introMs?: number,
  outroMs?: number,
): string {
  const bookendFilter = bookendVideoFilters(totalDurationSec, introMs, outroMs);
  return bookendFilter ? `${baseFilter},${bookendFilter}` : baseFilter;
}

function audioFilterArgs(filter: string): string[] {
  return filter ? ['-af', filter] : [];
}

function bookendVideoFilters(
  totalDurationSec: number,
  introMs?: number,
  outroMs?: number,
): string | undefined {
  return bookendFadeFilters('fade', totalDurationSec, introMs, outroMs);
}

function bookendAudioFilters(
  totalDurationSec: number,
  introMs?: number,
  outroMs?: number,
): string | undefined {
  return bookendFadeFilters('afade', totalDurationSec, introMs, outroMs);
}

function bookendFadeFilters(
  filterName: 'fade' | 'afade',
  totalDurationSec: number,
  introMs?: number,
  outroMs?: number,
): string | undefined {
  const introSec = bookendFadeSec(introMs, totalDurationSec);
  const outroSec = bookendFadeSec(outroMs, totalDurationSec);
  const filters: string[] = [];
  if (introSec > 0) {
    filters.push(`${filterName}=t=in:st=0:d=${formatSeconds(introSec)}`);
  }
  if (outroSec > 0) {
    filters.push(
      `${filterName}=t=out:st=${formatSeconds(Math.max(0, totalDurationSec - outroSec))}:d=${formatSeconds(outroSec)}`,
    );
  }
  return filters.length ? filters.join(',') : undefined;
}

function bookendFadeSec(
  durationMs: number | undefined,
  totalDurationSec: number,
): number {
  if (!durationMs || durationMs <= 0 || totalDurationSec <= 0) return 0;
  const clampedMs = Math.min(
    MAX_BOOKEND_FADE_MS,
    Math.max(MIN_BOOKEND_FADE_MS, durationMs),
  );
  return Math.min(clampedMs / 1000, totalDurationSec / 2);
}

function audioFormatFilter(): string {
  return 'aformat=sample_rates=48000:channel_layouts=stereo';
}

function subtitleVideoFilter(filePath: string): string {
  return `subtitles=filename='${escapeFilterValue(filePath)}'`;
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

function formatVolume(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function dbToVolume(db: number): number {
  return Math.max(0, Math.min(2, 10 ** (db / 20)));
}

function clampedFadeSec(
  fadeMs: number | undefined,
  durationSec: number,
): number {
  if (!fadeMs || fadeMs <= 0) return 0;
  return Math.min(fadeMs / 1000, Math.max(0, durationSec / 2));
}

function ptsShiftFilter(shiftSec: number): string {
  const operator = shiftSec < 0 ? '-' : '+';
  return `setpts=PTS${operator}${formatSeconds(Math.abs(shiftSec))}/TB`;
}

function videoCodecArgs(mode: 'speed' | 'reproducible'): string[] {
  return mode === 'reproducible'
    ? [
        '-c:v',
        'libx264',
        '-crf',
        '20',
        '-bitexact',
        '-fflags',
        '+bitexact',
        '-flags',
        '+bitexact',
      ]
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'];
}

function audioCodecArgs(): string[] {
  return ['-c:a', 'aac', '-ar', '48000', '-ac', '2'];
}

interface FfmpegTransitionResolution {
  transition: ReturnType<typeof normalizeTransition>;
  degradation?: TransitionDegradation;
}

export function transitionDegradationsForScenes(
  scenes: SceneClip[],
  projectId?: string,
  renderer: VideoRenderPath = 'ffmpeg',
): TransitionDegradation[] {
  const degradations: TransitionDegradation[] = [];
  for (let index = 1; index < scenes.length; index += 1) {
    const previous = scenes[index - 1]!;
    const requested = normalizeTransition(previous.transitionToNext);
    const degradation = transitionDegradationForRenderer(
      requested,
      renderer,
      projectId,
      index,
    );
    if (degradation) degradations.push(degradation);
  }
  return degradations;
}

function ffmpegTransitionForSeam(
  transition: TimelineTransition | undefined,
  projectId: string | undefined,
  seamIndex: number,
): ReturnType<typeof normalizeTransition> {
  return resolveFfmpegTransition(transition, projectId, seamIndex, true)
    .transition;
}

function resolveFfmpegTransition(
  transition: TimelineTransition | undefined,
  projectId: string | undefined,
  seamIndex: number,
  emitWarning: boolean,
): FfmpegTransitionResolution {
  const requested = normalizeTransition(transition);
  if (requested.kind === 'cut') return { transition: requested };
  const entry = transitionRegistryEntry(requested.kind);
  const quality = transitionRendererQuality(requested, 'ffmpeg');
  if (quality.support === 'native' || quality.support === 'custom') {
    return { transition: requested };
  }
  const degradation = transitionDegradationForRenderer(
    requested,
    'ffmpeg',
    projectId,
    seamIndex,
  );
  const fallbackKind = degradation?.fallbackKind ?? entry.fallbackFor.ffmpeg;
  if (!fallbackKind) {
    throw new Error(`Transition ${requested.kind} is not supported by FFmpeg`);
  }
  if (emitWarning) {
    logger.warn('video.render.transition_fallback_applied', {
      project_id: projectId,
      seam_index: seamIndex,
      requested_kind: requested.kind,
      fallback_kind: fallbackKind,
      renderer: 'ffmpeg',
      unsupported_params: degradation?.unsupportedParams,
    });
  }
  return {
    transition: fallbackTransition(requested, fallbackKind),
    ...(degradation ? { degradation } : {}),
  };
}

function transitionDegradationForRenderer(
  requested: ReturnType<typeof normalizeTransition>,
  renderer: VideoRenderPath,
  projectId: string | undefined,
  seamIndex: number,
): TransitionDegradation | undefined {
  if (requested.kind === 'cut') return undefined;
  const entry = transitionRegistryEntry(requested.kind);
  const quality = transitionRendererQuality(requested, renderer);
  if (quality.support === 'native' || quality.support === 'custom') {
    return undefined;
  }
  const fallbackKind = quality.fallbackKind ?? entry.fallbackFor[renderer];
  if (!fallbackKind) return undefined;
  const unsupportedParams = quality.unsupportedParams?.length
    ? quality.unsupportedParams
    : undefined;
  return {
    seamIndex,
    requestedKind: requested.kind,
    fallbackKind,
    renderer,
    ...(projectId ? { projectId } : {}),
    ...(unsupportedParams ? { unsupportedParams } : {}),
  };
}

function fallbackTransition(
  requested: ReturnType<typeof normalizeTransition>,
  fallbackKind: TransitionKind,
): ReturnType<typeof normalizeTransition> {
  const fallbackEntry = transitionRegistryEntry(fallbackKind);
  const direction =
    requested.direction &&
    fallbackEntry.directions.includes(requested.direction)
      ? requested.direction
      : undefined;
  return {
    kind: fallbackKind,
    ...(requested.durationMs ? { durationMs: requested.durationMs } : {}),
    ...(direction ? { direction } : {}),
  };
}

function xfadeName(transition: ReturnType<typeof normalizeTransition>): string {
  const direction = transition.direction;
  switch (transition.kind) {
    case 'cut':
      throw new Error('Cut transitions do not use FFmpeg xfade');
    case 'fade':
      return 'fade';
    case 'slide':
      return directionName(
        direction,
        {
          'from-left': 'slideright',
          'from-right': 'slideleft',
          'from-top': 'slidedown',
          'from-bottom': 'slideup',
        },
        'from-right',
      );
    case 'wipe':
      return directionName(
        direction,
        {
          'from-left': 'wiperight',
          'from-right': 'wipeleft',
          'from-top': 'wipedown',
          'from-bottom': 'wipeup',
        },
        'from-left',
      );
    case 'iris':
      return direction === 'from-right' ? 'circleclose' : 'circleopen';
    case 'dissolve':
      return 'dissolve';
    case 'pixelize':
      return 'pixelize';
    case 'soft-wipe':
      return softWipeXfadeName(transition.params);
    case 'clock-wipe':
      return 'radial';
    case 'cover':
      return directionName(
        direction,
        {
          'from-left': 'coverright',
          'from-right': 'coverleft',
          'from-top': 'coverdown',
          'from-bottom': 'coverup',
        },
        'from-left',
      );
    case 'reveal':
      return directionName(
        direction,
        {
          'from-left': 'revealright',
          'from-right': 'revealleft',
          'from-top': 'revealdown',
          'from-bottom': 'revealup',
        },
        'from-left',
      );
    default:
      throw new Error(`Transition ${transition.kind} is not native to FFmpeg`);
  }
}

function softWipeXfadeName(
  params: ReturnType<typeof normalizeTransition>['params'],
): string {
  return directionName(
    softWipeDirection(params),
    {
      'from-left': 'smoothright',
      'from-right': 'smoothleft',
      'from-top': 'smoothdown',
      'from-bottom': 'smoothup',
    },
    'from-left',
  );
}

function softWipeDirection(
  params: ReturnType<typeof normalizeTransition>['params'],
): TransitionDirection {
  const angle = typeof params?.angle === 'number' ? params.angle : 0;
  const normalized = ((angle % 360) + 360) % 360;
  let direction: TransitionDirection = 'from-left';
  if (Math.abs(normalized - 90) < 0.0001) direction = 'from-bottom';
  if (Math.abs(normalized - 180) < 0.0001) direction = 'from-right';
  if (Math.abs(normalized - 270) < 0.0001) direction = 'from-top';
  return params?.reverse === true ? oppositeDirection(direction) : direction;
}

function oppositeDirection(
  direction: TransitionDirection,
): TransitionDirection {
  switch (direction) {
    case 'from-bottom':
      return 'from-top';
    case 'from-left':
      return 'from-right';
    case 'from-right':
      return 'from-left';
    case 'from-top':
      return 'from-bottom';
  }
}

function directionName(
  direction: TransitionDirection | undefined,
  map: Record<TransitionDirection, string>,
  fallback: TransitionDirection,
): string {
  return map[direction ?? fallback];
}

function formatSeconds(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatExpressionNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function sourceSeekArgs(sourceStartSec: number | undefined): string[] {
  return sourceStartSec && sourceStartSec > 0
    ? ['-ss', formatSeconds(sourceStartSec)]
    : [];
}

async function writeCaptionSidecarFile(
  project: VideoProject,
  outputPath: string,
  root: string,
): Promise<string | undefined> {
  const srt = buildCaptionSidecarSrt(project);
  if (!srt) return undefined;
  const parsed = path.parse(outputPath);
  const sidecarPath = validatePath(
    path.join(parsed.dir, `${parsed.name}.srt`),
    root,
    'write',
  );
  await fs.writeFile(sidecarPath, srt);
  return sidecarPath;
}

export function buildCaptionSidecarSrt(
  project: VideoProject,
): string | undefined {
  const subtitles = timelineCaptionSubtitles(project);
  return subtitles.length > 0 ? renderSrt(subtitles) : undefined;
}

export function timelineCaptionSubtitles(project: VideoProject): Array<{
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}> {
  return compileTimelineToEdl(project)
    .captions.map((caption) => ({
      id: caption.id,
      startMs: caption.startMs,
      endMs: caption.endMs,
      text: caption.text.trim(),
    }))
    .filter((caption) => caption.text.length > 0)
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
    .map(({ id: _id, ...caption }, index) => ({
      index: index + 1,
      ...caption,
    }));
}

function renderSrt(
  subtitles: Array<{
    index: number;
    startMs: number;
    endMs: number;
    text: string;
  }>,
): string {
  return `${subtitles
    .map(
      (subtitle) =>
        `${subtitle.index}\n${formatSrtTimestamp(subtitle.startMs)} --> ${formatSrtTimestamp(subtitle.endMs)}\n${subtitle.text.replace(/\r?\n+/g, '\n')}`,
    )
    .join('\n\n')}\n`;
}

function formatSrtTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const milliseconds = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${padTime(hours)}:${padTime(minutes)}:${padTime(seconds)},${String(milliseconds).padStart(3, '0')}`;
}

function padTime(value: number): string {
  return String(value).padStart(2, '0');
}

async function buildRenderOutput(input: {
  projectId: string;
  root: string;
  outputPath: string;
  aspectRatio: AspectRatio;
  probe: Awaited<ReturnType<typeof probeFile>>;
  captionSidecarPath?: string;
  disclosurePath?: string;
  c2paManifestPath?: string;
  c2paSignerMode?: string;
  loudness?: LoudnessMetadata;
  colorManagement?: ColorManagementSummary;
  missingMedia?: VideoQaMissingMedia[];
  transitionDegradations?: TransitionDegradation[];
  cutBoundariesMs?: number[];
  expectedDurationMs?: number;
  signal?: AbortSignal;
}): Promise<RenderOutput> {
  const output: RenderOutput = {
    aspectRatio: input.aspectRatio,
    path: path.relative(input.root, input.outputPath),
    loudnessTargetLufs: input.loudness?.loudnessTargetLufs,
    loudnessLufs: input.loudness?.loudnessLufs,
    peakDbfs: input.loudness?.peakDbfs,
    colorManagement: input.colorManagement,
    durationSec: input.probe.duration,
    fileSize: input.probe.size,
    codec:
      input.probe.streams.find((stream) => stream.codecType === 'video')
        ?.codecName ?? 'unknown',
    captionSidecarPath: input.captionSidecarPath,
    disclosurePath: input.disclosurePath,
    c2paManifestPath: input.c2paManifestPath,
    c2paSignerMode: input.c2paSignerMode,
  };

  try {
    output.qaReport = await runVideoQaReport({
      root: input.root,
      outputPath: input.outputPath,
      probe: input.probe,
      missingMedia: input.missingMedia,
      transitionDegradations: input.transitionDegradations,
      cutBoundariesMs: input.cutBoundariesMs,
      expectedDurationMs: input.expectedDurationMs,
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    logger.warn('video.render.qa_failed', {
      project_id: input.projectId,
      output_path: output.path,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const poster = await generatePosterFrame({
      root: input.root,
      outputPath: input.outputPath,
      durationSec: input.probe.duration,
      signal: input.signal,
    });
    return { ...output, posterPath: poster.posterPath };
  } catch (error) {
    if (input.signal?.aborted) throw error;
    logger.warn('video.render.poster_generation_failed', {
      project_id: input.projectId,
      output_path: output.path,
      error: error instanceof Error ? error.message : String(error),
    });
    return output;
  }
}

async function finalizeRenderOutput(input: {
  projectId: string;
  project: VideoProject;
  root: string;
  outputPath: string;
  aspectRatio: AspectRatio;
  captionSidecarPath?: string;
  loudnessTargetLufs?: LoudnessTargetLufs;
  colorManagement?: ColorManagementSummary;
  missingMedia?: VideoQaMissingMedia[];
  transitionDegradations?: TransitionDegradation[];
  signal?: AbortSignal;
}): Promise<RenderOutput> {
  let probe = await probeFile(input.outputPath, input.root);
  const loudness = input.loudnessTargetLufs
    ? await normalizeRenderedAudio({
        root: input.root,
        outputPath: input.outputPath,
        probe,
        targetLufs: input.loudnessTargetLufs,
        signal: input.signal,
      })
    : undefined;
  if (loudness) {
    probe = await probeFile(input.outputPath, input.root);
  }

  // Phase 7 — attribution + AI-disclosure on the exported MP4 (container
  // metadata + a credits.json sidecar). Stream-copy pass, so it runs last and
  // is codec-independent. Best-effort: a post-processing failure here must not
  // discard an already-complete render — log and continue without disclosure.
  const exportMetadata = buildExportMetadata(input.project);
  let disclosurePath: string | undefined;
  try {
    await embedExportMetadata({
      root: input.root,
      outputPath: input.outputPath,
      metadata: exportMetadata,
      signal: input.signal,
    });
    probe = await probeFile(input.outputPath, input.root);
    const sidecarAbs = await writeDisclosureSidecar({
      root: input.root,
      outputPath: input.outputPath,
      projectId: input.projectId,
      metadata: exportMetadata,
      generatedAt: new Date().toISOString(),
    });
    disclosurePath = path.relative(input.root, sidecarAbs);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    logger.warn('video.export.metadata_embed_failed', {
      project_id: input.projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Best-effort C2PA Content Credentials. Re-probe after a successful embed
  // since the signed file replaces the original.
  const c2pa = await signExportedMp4({
    root: input.root,
    outputPath: input.outputPath,
    metadata: exportMetadata,
    signal: input.signal,
  });
  if (c2pa?.embedded) {
    probe = await probeFile(input.outputPath, input.root);
  }

  return buildRenderOutput({
    projectId: input.projectId,
    root: input.root,
    outputPath: input.outputPath,
    aspectRatio: input.aspectRatio,
    probe,
    captionSidecarPath: input.captionSidecarPath,
    disclosurePath,
    c2paManifestPath: c2pa?.manifestPath,
    c2paSignerMode: c2pa?.signerMode,
    loudness,
    colorManagement: input.colorManagement,
    missingMedia: input.missingMedia,
    transitionDegradations: input.transitionDegradations,
    cutBoundariesMs: collectCutBoundaryMs(input.project),
    expectedDurationMs: expectedProjectDurationMs(input.project),
    signal: input.signal,
  });
}

function expectedProjectDurationMs(project: VideoProject): number | undefined {
  const durationMs = project.timeline
    ? pictureTimelineDurationMs(project.timeline.tracks) ||
      project.timeline.durationMs
    : project.storyboard?.totalDurationMs;
  return typeof durationMs === 'number' && Number.isFinite(durationMs)
    ? Math.max(0, Math.round(durationMs))
    : undefined;
}

function collectCutBoundaryMs(project: VideoProject): number[] {
  const boundaries = new Set<number>();
  const history = project.history;
  const entries = history?.entries.slice(0, history.head) ?? [];
  for (const entry of entries) {
    if (entry.undone) continue;
    collectCutBoundaryMsFromOperation(entry.op, boundaries);
  }
  return [...boundaries].sort((left, right) => left - right);
}

function collectCutBoundaryMsFromOperation(
  operation: TimelineOp | { kind: 'timeline.batch'; ops: TimelineOp[] },
  boundaries: Set<number>,
): void {
  if (operation.kind === 'timeline.batch') {
    for (const op of operation.ops) {
      collectCutBoundaryMsFromOperation(op, boundaries);
    }
    return;
  }
  if (
    operation.kind === 'clip.removeTimeRange' &&
    Number.isFinite(operation.startMs)
  ) {
    boundaries.add(Math.max(0, Math.round(operation.startMs)));
  }
}

async function updateRenderStatus(
  project: VideoProject,
  render: RenderStatus,
  output?: NonNullable<VideoProject['outputs']>[number],
): Promise<void> {
  const outputs = output
    ? [
        ...(project.outputs ?? []).filter(
          (item) => item.aspectRatio !== output.aspectRatio,
        ),
        output,
      ]
    : project.outputs;
  await writeProject({
    ...project,
    render,
    outputs,
    updatedAt: new Date().toISOString(),
  });
  getDatabase()
    .prepare(
      `UPDATE video_projects
       SET render_status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(render.status, new Date().toISOString(), project.id);
}

function outputName(aspectRatio: AspectRatio): string {
  return aspectRatio === '16:9'
    ? 'out.mp4'
    : `out-${aspectRatio.replace(':', 'x')}.mp4`;
}

export function kenBurnsFilter(
  plan: Extract<AssetPlan, { kind: 'image-pan' }>,
  durationSec: number,
  canvas: { width: number; height: number },
): string {
  const fps = 30;
  const frames = Math.max(1, Math.round(durationSec * fps));
  const from = normalizeRect(
    plan.kenBurns?.from ?? { x: 0, y: 0, width: 1, height: 1 },
  );
  const to = normalizeRect(
    plan.kenBurns?.to ?? { x: 0, y: 0, width: 1, height: 1 },
  );
  const progress = `(on/${Math.max(frames - 1, 1)})`;
  const fromZoom = rectZoom(from);
  const toZoom = rectZoom(to);
  const fromCenter = rectCenter(from);
  const toCenter = rectCenter(to);
  const zoom = `${numberExpr(fromZoom)}+(${numberExpr(toZoom - fromZoom)})*${progress}`;
  const xCenter = `${numberExpr(fromCenter.x)}+(${numberExpr(toCenter.x - fromCenter.x)})*${progress}`;
  const yCenter = `${numberExpr(fromCenter.y)}+(${numberExpr(toCenter.y - fromCenter.y)})*${progress}`;
  const x = `iw*(${xCenter})-(iw/zoom/2)`;
  const y = `ih*(${yCenter})-(ih/zoom/2)`;
  return `zoompan=z='${zoom}':x='${x}':y='${y}':d=${frames}:s=${canvas.width}x${canvas.height}:fps=${fps}`;
}

function normalizeRect(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const width = clamp(rect.width, 0.05, 1);
  const height = clamp(rect.height, 0.05, 1);
  const x = clamp(rect.x, 0, 1 - width);
  const y = clamp(rect.y, 0, 1 - height);
  return { x, y, width, height };
}

function rectZoom(rect: { width: number; height: number }): number {
  return clamp(Math.max(1 / rect.width, 1 / rect.height), 1, 10);
}

function rectCenter(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function numberExpr(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6);
}

function canvasForAspect(aspectRatio: AspectRatio): {
  width: number;
  height: number;
} {
  if (aspectRatio === '9:16') return { width: 1080, height: 1920 };
  if (aspectRatio === '1:1') return { width: 1080, height: 1080 };
  if (aspectRatio === '4:5') return { width: 1080, height: 1350 };
  return { width: 1920, height: 1080 };
}
