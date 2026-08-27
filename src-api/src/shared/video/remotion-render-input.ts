import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  durationMsToFrames,
  msToFrame,
  normalizeClipPlayback,
  type ClipPlayback,
  type ClipEffectStack,
  type KeyframeTrack,
  type VividOverlayRenderEntry,
} from '@neumar/video-ir';

import { validateInputFile } from '@/shared/services/ffmpeg';

import { isExternalAsset, resolveProjectAssetPath } from './asset-files';
import { getVideoFeatureFlag } from './flags';
import { getImportedOverlayAsset } from './overlays/imported-items';
import { buildVividOverlayRenderEntriesWithPlugins } from './overlays/server-resolve';
import { resolveReframePlan, type VideoReframePlan } from './reframe';
import { getVideoProjectRoot } from './store';
import { compileTimelineToEdl } from './timeline';
import type {
  AspectRatio,
  AssetPlan,
  EdlAudioClip,
  EdlAudioTrack,
  EdlCaption,
  EdlOverlay,
  EdlSegment,
  MediaItem,
  StoryboardScene,
  TimelineSourceRef,
  TimelineTrack,
  VideoProject,
} from './types';

const MIN_BOOKEND_FADE_MS = 33;
const MAX_BOOKEND_FADE_MS = 3000;

export interface BuildRemotionRenderInputOptions {
  aspectRatio?: AspectRatio;
  includeCaptions?: boolean;
  root?: string;
}

export interface RemotionRenderInput extends Record<string, unknown> {
  schema: 'neuma.video.remotion-input.v1';
  projectId: string;
  aspectRatio: AspectRatio;
  compositionWidth: number;
  compositionHeight: number;
  durationInFrames: number;
  fps: number;
  introFrames?: number;
  outroFrames?: number;
  visualClips: RemotionRenderVisualClip[];
  audioClips: RemotionRenderAudioClip[];
  captions: RemotionRenderCaption[];
  /** Selects @remotion/media while retaining the legacy rollback path. */
  useRemotionMedia: boolean;
  /** Vivid overlay clips; rendered before captions (captions stay last). */
  vividOverlays?: VividOverlayRenderEntry[];
}

export interface RemotionRenderVisualClip {
  id: string;
  assetId: string;
  sourcePath: string;
  /**
   * `sourcePath` points at a master outside the workspace that the project
   * references in place. Carried on the clip because renderers re-probe the
   * path long after the asset record is out of scope, and the workspace check
   * would otherwise reject a file the resolver already approved.
   */
  sourceIsExternal?: boolean;
  src: string;
  fromFrame: number;
  sourceStartFrame: number;
  sourceEndFrame: number;
  sourceDurationFrames?: number;
  durationInFrames: number;
  layer: number;
  trackId: string;
  label: string;
  mediaKind: 'image' | 'video';
  trackKind: 'video' | 'broll' | 'overlay';
  muted?: boolean;
  playback?: ClipPlayback;
  transforms?: EdlSegment['transforms'];
  keyframes?: KeyframeTrack[];
  transitionToNext?: EdlSegment['transitionToNext'];
  filters?: EdlSegment['filters'];
  effects?: ClipEffectStack;
  imagePan?: Extract<AssetPlan, { kind: 'image-pan' }>;
  reframe?: VideoReframePlan;
}

export interface RemotionRenderAudioClip {
  id: string;
  assetId: string;
  sourcePath: string;
  src: string;
  fromFrame: number;
  sourceStartFrame: number;
  sourceEndFrame: number;
  durationInFrames: number;
  role: 'music' | 'narration' | 'sfx';
  volume: number;
  playback?: ClipPlayback;
  gainDb?: number;
  trackVolumeDb?: number;
  keyframes?: KeyframeTrack[];
  muted?: boolean;
  trackMuted?: boolean;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  fadeInCurve?: EdlAudioClip['fadeInCurve'];
  fadeOutCurve?: EdlAudioClip['fadeOutCurve'];
  transcriptText?: string;
}

export interface RemotionRenderCaptionWord {
  text: string;
  /** Frame the word becomes active, relative to the caption's own start. */
  fromFrame: number;
  /** Frame the word stops being active, relative to the caption's start. */
  toFrame: number;
}

export interface RemotionRenderCaption {
  id: string;
  fromFrame: number;
  durationInFrames: number;
  text: string;
  words?: RemotionRenderCaptionWord[];
  position: 'top' | 'middle' | 'bottom';
  keyframes?: KeyframeTrack[];
  style?: EdlCaption['style'];
  entranceFrames?: number;
  exitFrames?: number;
}

const ASPECT_DIMENSIONS: Record<
  AspectRatio,
  { width: number; height: number }
> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

export async function buildRemotionRenderInput(
  project: VideoProject,
  options: BuildRemotionRenderInputOptions = {},
): Promise<RemotionRenderInput> {
  const root = options.root ?? getVideoProjectRoot(project.id);
  const aspectRatio = options.aspectRatio ?? '16:9';
  const includeCaptions = options.includeCaptions ?? true;
  const dimensions = ASPECT_DIMENSIONS[aspectRatio];
  const edl = compileTimelineToEdl(project, { aspectRatio });
  const visualLayerByTrackId = getVisualLayerByTrackId(project);
  const fps = edl.fps;
  const visualClips = [...edl.segments, ...edl.overlays]
    .flatMap((segment, index) =>
      visualClipFromEdl(
        project,
        segment,
        aspectRatio,
        root,
        fps,
        visualLayerByTrackId.get(segment.trackId) ?? index,
      ),
    )
    .sort(compareRenderVisualClips)
    .map((clip, layer) => ({ ...clip, layer }));

  const vividOverlays = getVideoFeatureFlag('video.vividOverlays')
    ? await enrichVividOverlayEntries(
        project,
        root,
        buildVividOverlayRenderEntriesWithPlugins(project.timeline, fps),
      )
    : [];

  return {
    schema: 'neuma.video.remotion-input.v1',
    projectId: project.id,
    aspectRatio,
    compositionWidth: dimensions.width,
    compositionHeight: dimensions.height,
    durationInFrames: Math.max(1, durationMsToFrames(edl.durationMs, fps)),
    fps,
    useRemotionMedia: getVideoFeatureFlag('video.remotionMedia'),
    introFrames: bookendFrames(
      project.timeline?.intro?.durationMs,
      edl.durationMs,
      fps,
    ),
    outroFrames: bookendFrames(
      project.timeline?.outro?.durationMs,
      edl.durationMs,
      fps,
    ),
    visualClips,
    audioClips: edl.audioTracks.flatMap((track) =>
      track.muted
        ? []
        : track.clips.flatMap((clip) =>
            audioClipFromEdl(project, track, clip, root, fps),
          ),
    ),
    captions: includeCaptions
      ? edl.captions.map((caption) => captionFromEdl(caption, fps))
      : [],
    vividOverlays,
  };
}

const MAX_OVERLAY_SOURCE_BYTES = 15 * 1024 * 1024;

/**
 * Headless compositions receive inputProps as JSON (no loader callbacks), so
 * source-backed overlay entries carry their asset bytes inline. Oversized or
 * missing assets leave the entry unenriched — the composition then skips it,
 * which beats failing the whole render.
 */
async function enrichVividOverlayEntries(
  project: VideoProject,
  root: string,
  entries: VividOverlayRenderEntry[],
): Promise<VividOverlayRenderEntry[]> {
  return Promise.all(
    entries.map(async (entry) => {
      if (!entryUsesSourceAsset(entry) || !entry.sourceAssetId) {
        return entry;
      }
      if (entry.sourceAsset) return entry;
      if (entry.sourceAssetId.startsWith('import:')) {
        return enrichImportedOverlayEntry(entry);
      }
      const asset = project.assets.find(
        (item) => item.id === entry.sourceAssetId,
      );
      if (!asset) return entry;
      try {
        const sourcePath = resolveProjectAssetPath(asset, root);
        const fileStats = await stat(sourcePath);
        if (fileStats.size === 0 || fileStats.size > MAX_OVERLAY_SOURCE_BYTES) {
          return entry;
        }
        const data = await readFile(sourcePath);
        if (
          data.byteLength === 0 ||
          data.byteLength > MAX_OVERLAY_SOURCE_BYTES
        ) {
          return entry;
        }
        return {
          ...entry,
          sourceAsset: {
            base64: data.toString('base64'),
            mimeType: overlaySourceMimeType(sourcePath, entry.backend),
          },
        };
      } catch {
        return entry;
      }
    }),
  );
}

async function enrichImportedOverlayEntry(
  entry: VividOverlayRenderEntry,
): Promise<VividOverlayRenderEntry> {
  if (!entry.sourceAssetId) return entry;
  try {
    const imported = await getImportedOverlayAsset(entry.sourceAssetId);
    if (!imported || imported.item.kind !== entry.backend) return entry;
    if (
      imported.bytes.byteLength === 0 ||
      imported.bytes.byteLength > MAX_OVERLAY_SOURCE_BYTES
    ) {
      return entry;
    }
    return {
      ...entry,
      sourceAsset: {
        base64: imported.bytes.toString('base64'),
        mimeType: imported.item.source.mimeType,
      },
    };
  } catch {
    return entry;
  }
}

function entryUsesSourceAsset(entry: VividOverlayRenderEntry): boolean {
  return (
    entry.backend === 'gif' ||
    (entry.backend === 'lottie' && Boolean(entry.sourceAssetId))
  );
}

function overlaySourceMimeType(
  sourcePath: string,
  backend: VividOverlayRenderEntry['backend'],
): string {
  if (backend === 'lottie') return 'application/lottie+json';
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.png' || extension === '.apng') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/gif';
}

function visualClipFromEdl(
  project: VideoProject,
  segment: EdlSegment | EdlOverlay,
  aspectRatio: AspectRatio,
  root: string,
  fps: number,
  layer: number,
): RemotionRenderVisualClip[] {
  const resolved = resolveVisualAsset(project, segment);
  if (!resolved) return [];
  const { asset, imagePan, scene } = resolved;
  if (asset.kind !== 'image' && asset.kind !== 'video') return [];
  const trackKind = 'kind' in segment ? segment.kind : 'video';
  const sourceStartFrame = msToFrame(segment.sourceStartMs, fps);
  const durationInFrames = Math.max(
    1,
    durationMsToFrames(segment.durationMs, fps),
  );
  const sourceDurationFrames = segment.sourceDurationMs
    ? durationMsToFrames(segment.sourceDurationMs, fps)
    : undefined;

  const sourcePath = resolveProjectAssetPath(asset, root);
  return [
    {
      id: segment.id,
      assetId: asset.id,
      sourcePath,
      sourceIsExternal: isExternalAsset(asset),
      src: pathToFileURL(sourcePath).href,
      fromFrame: msToFrame(segment.timelineStartMs, fps),
      sourceStartFrame,
      sourceEndFrame: sourceEndFrameForPlayback({
        durationInFrames,
        playback: segment.playback,
        sourceDurationFrames,
        sourceStartFrame,
      }),
      sourceDurationFrames,
      durationInFrames,
      layer,
      trackId: segment.trackId,
      label: path.basename(asset.path),
      mediaKind: asset.kind,
      trackKind,
      muted: segment.muted,
      playback: segment.playback,
      transforms: segment.transforms,
      keyframes: segment.keyframes,
      transitionToNext: segment.transitionToNext,
      filters: segment.filters,
      effects: segment.effects,
      imagePan: asset.kind === 'image' ? imagePan : undefined,
      reframe:
        trackKind === 'video'
          ? resolveReframePlan({
              aspectRatio,
              enabled: project.settings?.autoReframeEnabled ?? true,
              override: scene?.reframe,
              assetPlanKind: scene?.assetPlan.kind,
            })
          : undefined,
    },
  ];
}

function audioClipFromEdl(
  project: VideoProject,
  track: EdlAudioTrack,
  clip: EdlAudioClip,
  root: string,
  fps: number,
): RemotionRenderAudioClip[] {
  const asset = assetForSourceRef(project, clip.sourceRef);
  if (asset?.kind !== 'audio') return [];

  const sourcePath = resolveProjectAssetPath(asset, root);
  const sourceStartFrame = msToFrame(clip.sourceStartMs, fps);
  const durationInFrames = Math.max(
    1,
    durationMsToFrames(clip.durationMs, fps),
  );
  return [
    {
      id: clip.id,
      assetId: asset.id,
      sourcePath,
      src: pathToFileURL(sourcePath).href,
      fromFrame: msToFrame(clip.timelineStartMs, fps),
      sourceStartFrame,
      sourceEndFrame: sourceEndFrameForPlayback({
        durationInFrames,
        playback: clip.playback,
        sourceStartFrame,
      }),
      durationInFrames,
      role: audioRoleFromTrack(track),
      volume: dbToVolume((track.volumeDb ?? 0) + (clip.gainDb ?? 0)),
      playback: clip.playback,
      gainDb: clip.gainDb,
      trackVolumeDb: track.volumeDb,
      keyframes: clip.keyframes,
      muted: clip.muted,
      trackMuted: track.muted,
      fadeInFrames: clip.fadeInMs
        ? Math.max(1, durationMsToFrames(clip.fadeInMs, fps))
        : undefined,
      fadeOutFrames: clip.fadeOutMs
        ? Math.max(1, durationMsToFrames(clip.fadeOutMs, fps))
        : undefined,
      fadeInCurve: clip.fadeInCurve,
      fadeOutCurve: clip.fadeOutCurve,
      transcriptText: clip.transcriptText,
    },
  ];
}

function captionFromEdl(
  caption: EdlCaption,
  fps: number,
): RemotionRenderCaption {
  return {
    id: caption.id,
    fromFrame: msToFrame(caption.startMs, fps),
    durationInFrames: Math.max(
      1,
      durationMsToFrames(caption.endMs - caption.startMs, fps),
    ),
    text: caption.text,
    words: caption.words?.map((word) => ({
      text: word.text,
      // Frames are relative to the caption's own start (the Sequence origin).
      // Clamp the ms delta first — msToFrame rejects a negative input.
      fromFrame: msToFrame(Math.max(0, word.startMs - caption.startMs), fps),
      toFrame: Math.max(
        1,
        msToFrame(Math.max(0, word.endMs - caption.startMs), fps),
      ),
    })),
    position: caption.style?.position ?? 'bottom',
    keyframes: caption.keyframes,
    style: caption.style,
    entranceFrames:
      typeof caption.entranceMs === 'number'
        ? Math.max(0, durationMsToFrames(caption.entranceMs, fps))
        : undefined,
    exitFrames:
      typeof caption.exitMs === 'number'
        ? Math.max(0, durationMsToFrames(caption.exitMs, fps))
        : undefined,
  };
}

function resolveVisualAsset(
  project: VideoProject,
  segment: EdlSegment,
):
  | {
      asset: MediaItem;
      imagePan?: Extract<AssetPlan, { kind: 'image-pan' }>;
      scene?: StoryboardScene;
    }
  | undefined {
  const sourceAsset = assetForSourceRef(project, segment.sourceRef);
  const scene = sceneForSegment(project, segment);
  if (sourceAsset) {
    return {
      asset: sourceAsset,
      imagePan: imagePanForSegment(project, segment, sourceAsset.id),
      ...(scene ? { scene } : {}),
    };
  }

  const plan = scene?.assetPlan;
  if (!plan || (plan.kind !== 'existing' && plan.kind !== 'image-pan')) {
    return undefined;
  }
  const assetId = plan.assetId;
  const asset = project.assets.find((item) => item.id === assetId);
  return asset
    ? {
        asset,
        imagePan: plan.kind === 'image-pan' ? plan : undefined,
        ...(scene ? { scene } : {}),
      }
    : undefined;
}

function imagePanForSegment(
  project: VideoProject,
  segment: EdlSegment,
  assetId: string,
): Extract<AssetPlan, { kind: 'image-pan' }> | undefined {
  const plan = sceneForSegment(project, segment)?.assetPlan;
  return plan?.kind === 'image-pan' && plan.assetId === assetId
    ? plan
    : undefined;
}

function sceneForSegment(
  project: VideoProject,
  segment: EdlSegment,
): StoryboardScene | undefined {
  return segment.sceneId
    ? project.storyboard?.scenes.find((scene) => scene.id === segment.sceneId)
    : undefined;
}

function assetForSourceRef(
  project: VideoProject,
  sourceRef: TimelineSourceRef,
): MediaItem | undefined {
  if (sourceRef.kind !== 'asset') return undefined;
  return project.assets.find((asset) => asset.id === sourceRef.assetId);
}

function getVisualLayerByTrackId(project: VideoProject): Map<string, number> {
  return new Map(
    [...(project.timeline?.tracks ?? [])]
      .sort(compareTracks)
      .filter(isVisualTrack)
      .map((track, index) => [track.id, track.order + index / 1000]),
  );
}

function sourceEndFrameForPlayback(input: {
  durationInFrames: number;
  playback?: ClipPlayback;
  sourceDurationFrames?: number;
  sourceStartFrame: number;
}): number {
  const playback = normalizeClipPlayback(input.playback);
  const sourceFrames = Math.max(
    1,
    Math.round(input.durationInFrames * playback.speed),
  );
  const sourceEndFrame = input.sourceStartFrame + sourceFrames;
  if (
    typeof input.sourceDurationFrames === 'number' &&
    input.sourceDurationFrames > 0
  ) {
    return Math.min(sourceEndFrame, input.sourceDurationFrames);
  }
  return sourceEndFrame;
}

function compareRenderVisualClips(
  a: RemotionRenderVisualClip,
  b: RemotionRenderVisualClip,
): number {
  return (
    a.layer - b.layer || a.fromFrame - b.fromFrame || a.id.localeCompare(b.id)
  );
}

function compareTracks(a: TimelineTrack, b: TimelineTrack): number {
  return a.order - b.order || a.id.localeCompare(b.id);
}

function isVisualTrack(track: TimelineTrack): boolean {
  return (
    track.kind === 'video' || track.kind === 'broll' || track.kind === 'overlay'
  );
}

function audioRoleFromTrack(
  track: EdlAudioTrack,
): RemotionRenderAudioClip['role'] {
  if (track.kind === 'audio-music') return 'music';
  if (track.kind === 'audio-sfx') return 'sfx';
  return 'narration';
}

function bookendFrames(
  durationMs: number | undefined,
  timelineDurationMs: number,
  fps: number,
): number | undefined {
  if (!durationMs || durationMs <= 0 || timelineDurationMs <= 0) {
    return undefined;
  }
  const clampedDurationMs = Math.min(
    MAX_BOOKEND_FADE_MS,
    Math.max(MIN_BOOKEND_FADE_MS, durationMs),
  );
  const maxFrames = Math.max(
    1,
    Math.floor(durationMsToFrames(timelineDurationMs, fps) / 2),
  );
  return Math.min(
    maxFrames,
    Math.max(1, durationMsToFrames(clampedDurationMs, fps)),
  );
}

function dbToVolume(db: number): number {
  return Math.max(0, Math.min(2, 10 ** (db / 20)));
}
