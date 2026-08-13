import {
  deriveTimelineClipFrameFields,
  durationMsToFrames,
  msToFrame,
  normalizeFrameRate,
  type FrameRate,
} from '@neumar/video-ir';

import { vividOverlayContextSummary } from './overlays/context-summary';
import { buildTimelineWindow } from './timeline-window';
import type {
  AspectRatio,
  MediaItem,
  StoryboardScene,
  TimelineClip,
  TimelineTrack,
  VideoEditorSelectionContext,
  VideoProject,
} from './types';

export const CURRENT_VIDEO_CONTEXT_INCLUDES = [
  'scene',
  'selection',
  'previewFrame',
  'timelineWindow',
  'assets',
] as const;

const DEFAULT_TIMELINE_FPS = 30;

export type CurrentVideoContextInclude =
  (typeof CURRENT_VIDEO_CONTEXT_INCLUDES)[number];

export interface CurrentVideoContextInput {
  selectedSceneId?: string;
  aspectRatio?: AspectRatio | string;
  editorSelection?: VideoEditorSelectionContext;
  include?: CurrentVideoContextInclude[];
  windowMs?: number;
}

export function buildCurrentVideoContext(
  project: VideoProject,
  input: CurrentVideoContextInput = {},
) {
  const include = new Set<CurrentVideoContextInclude>(
    input.include ?? ['scene', 'selection', 'previewFrame'],
  );
  const frameRate = project.timeline
    ? normalizeFrameRate(
        project.timeline.frameRate ??
          project.timeline.fps ??
          DEFAULT_TIMELINE_FPS,
      )
    : undefined;
  const playheadMs = normalizeMs(
    input.editorSelection?.previewFrame?.atMs ??
      input.editorSelection?.playheadMs,
  );
  const selectedClipIds = uniqueIds(input.editorSelection?.selectedClipIds);
  const clipLocations = collectClipLocations(project);
  const selectedClips = selectedClipIds
    .map((clipId) =>
      clipLocations.find((location) => location.clip.id === clipId),
    )
    .filter((location): location is ClipLocation => Boolean(location));
  const clipsAtPlayhead =
    playheadMs === undefined
      ? []
      : clipLocations.filter((location) =>
          clipIntersectsTime(location.clip, playheadMs),
        );
  const previewClip =
    findPreviewClip({
      clipLocations,
      previewClipId: input.editorSelection?.previewFrame?.clipId,
      selectedClips,
      clipsAtPlayhead,
    }) ?? selectedClips[0];
  const selectedScene = findStoryboardScene(project, input.selectedSceneId);
  const assets = selectedAssetSummaries(project, [
    ...selectedClips,
    ...clipsAtPlayhead,
    ...(previewClip ? [previewClip] : []),
  ]);

  return {
    schema: 'neuma.video.current-context.v1',
    projectId: project.id,
    ...(project.timeline
      ? {
          fps: project.timeline.fps,
          ...(frameRate ? { frameRate } : {}),
        }
      : {}),
    active: {
      selectedSceneId: input.selectedSceneId,
      aspectRatio: input.aspectRatio,
      playheadMs,
      playheadFrame:
        playheadMs !== undefined && frameRate
          ? msToFrame(playheadMs, frameRate)
          : undefined,
      selectedClipIds,
      previewFrame: input.editorSelection?.previewFrame,
      ...(input.editorSelection?.activePanel
        ? { activePanel: input.editorSelection.activePanel }
        : {}),
    },
    ...(include.has('scene')
      ? { selectedScene: selectedScene ? summarizeScene(selectedScene) : null }
      : {}),
    ...(include.has('selection')
      ? {
          selection: {
            selectedClips: selectedClips.map((location) =>
              summarizeClipLocation(project, location, playheadMs, frameRate),
            ),
            clipsAtPlayhead: clipsAtPlayhead.map((location) =>
              summarizeClipLocation(project, location, playheadMs, frameRate),
            ),
          },
        }
      : {}),
    ...(include.has('previewFrame')
      ? {
          previewFrame:
            playheadMs === undefined
              ? null
              : {
                  atMs: playheadMs,
                  atFrame: frameRate
                    ? msToFrame(playheadMs, frameRate)
                    : undefined,
                  aspectRatio:
                    input.editorSelection?.previewFrame?.aspectRatio ??
                    input.aspectRatio,
                  sceneId:
                    input.editorSelection?.previewFrame?.sceneId ??
                    input.selectedSceneId,
                  clip: previewClip
                    ? summarizeClipLocation(
                        project,
                        previewClip,
                        playheadMs,
                        frameRate,
                      )
                    : null,
                  note: 'For visual grounding, inspect this source asset or extract a frame with ffmpeg_extract_frames at clipLocalMs/sourceTimeMs.',
                },
        }
      : {}),
    ...(include.has('timelineWindow') && playheadMs !== undefined
      ? {
          timelineWindow: buildTimelineWindow(project, {
            startMs: Math.max(0, playheadMs - windowRadius(input.windowMs)),
            endMs: playheadMs + windowRadius(input.windowMs),
            limit: 40,
          }),
        }
      : {}),
    ...(include.has('assets') ? { assets } : {}),
  };
}

interface ClipLocation {
  track: TimelineTrack;
  clip: TimelineClip;
}

function collectClipLocations(project: VideoProject): ClipLocation[] {
  return (
    project.timeline?.tracks.flatMap((track) =>
      track.clips.map((clip) => ({ track, clip })),
    ) ?? []
  );
}

function summarizeScene(scene: StoryboardScene) {
  return {
    id: scene.id,
    durationMs: scene.durationMs,
    intent: scene.intent,
    caption: scene.caption?.text,
    assetPlan: scene.assetPlan,
    reframe: scene.reframe,
  };
}

function summarizeClipLocation(
  project: VideoProject,
  location: ClipLocation,
  playheadMs: number | undefined,
  frameRate: FrameRate | undefined,
) {
  const { clip, track } = location;
  const frameFields = frameRate
    ? deriveTimelineClipFrameFields(clip, frameRate)
    : undefined;
  const clipLocalMs =
    playheadMs === undefined
      ? undefined
      : Math.max(0, Math.min(clip.durationMs, playheadMs - clip.startMs));
  const sourceTimeMs =
    clipLocalMs === undefined ? undefined : clip.trimStartMs + clipLocalMs;
  return {
    track: { id: track.id, kind: track.kind, name: track.name },
    clip: {
      id: clip.id,
      kind: clip.kind,
      name: clip.name,
      sceneId: clip.sceneId,
      sourceRef: clip.sourceRef,
      startMs: clip.startMs,
      endMs: clip.startMs + clip.durationMs,
      durationMs: clip.durationMs,
      ...(frameFields ?? {}),
      trimStartMs: clip.trimStartMs,
      trimEndMs: clip.trimEndMs,
      activeAtPlayhead:
        playheadMs === undefined
          ? undefined
          : clipIntersectsTime(clip, playheadMs),
      clipLocalMs,
      clipLocalFrame:
        clipLocalMs !== undefined && frameRate
          ? durationMsToFrames(clipLocalMs, frameRate)
          : undefined,
      sourceTimeMs,
      sourceFrame:
        sourceTimeMs !== undefined && frameRate
          ? msToFrame(sourceTimeMs, frameRate)
          : undefined,
      ...visualClipFields(clip),
    },
    asset: assetSummaryForClip(project, clip),
  };
}

function visualClipFields(clip: TimelineClip) {
  if (clip.kind === 'effect') {
    const overlay = vividOverlayContextSummary(clip);
    return overlay ? { overlay } : {};
  }
  if (
    clip.kind !== 'video' &&
    clip.kind !== 'image' &&
    clip.kind !== 'overlay'
  ) {
    return {};
  }
  return {
    transforms: clip.transforms,
    filters: clip.filters,
    muted: clip.muted,
  };
}

function selectedAssetSummaries(
  project: VideoProject,
  locations: ClipLocation[],
) {
  const assetIds = uniqueIds(
    locations
      .map((location) => location.clip.sourceRef)
      .flatMap((sourceRef) =>
        sourceRef.kind === 'asset' ? [sourceRef.assetId] : [],
      ),
  );
  return assetIds
    .map((assetId) => project.assets.find((asset) => asset.id === assetId))
    .filter((asset): asset is MediaItem => Boolean(asset))
    .map(summarizeAssetForContext);
}

function assetSummaryForClip(project: VideoProject, clip: TimelineClip) {
  if (clip.sourceRef.kind !== 'asset') return undefined;
  const { assetId } = clip.sourceRef;
  const asset = project.assets.find((candidate) => candidate.id === assetId);
  return asset ? summarizeAssetForContext(asset) : undefined;
}

function summarizeAssetForContext(asset: MediaItem) {
  return {
    id: asset.id,
    kind: asset.kind,
    source: asset.source,
    path: asset.path,
    durationMs: asset.metadata.durationMs,
    width: asset.metadata.width,
    height: asset.metadata.height,
    displayName: asset.provenance?.sourceDisplayName,
    thumbnailUrl: asset.provenance?.thumbnailUrl,
    materializationState: asset.materializationState,
  };
}

function findPreviewClip(input: {
  clipLocations: ClipLocation[];
  previewClipId?: string;
  selectedClips: ClipLocation[];
  clipsAtPlayhead: ClipLocation[];
}): ClipLocation | undefined {
  if (input.previewClipId) {
    const explicit = input.clipLocations.find(
      (location) => location.clip.id === input.previewClipId,
    );
    if (explicit) return explicit;
  }
  return (
    input.selectedClips.find(isVisualLocation) ??
    input.clipsAtPlayhead.find(isVisualLocation) ??
    input.clipsAtPlayhead[0]
  );
}

function findStoryboardScene(
  project: VideoProject,
  sceneId: string | undefined,
): StoryboardScene | undefined {
  if (!sceneId) return undefined;
  return project.storyboard?.scenes.find((scene) => scene.id === sceneId);
}

function isVisualLocation(location: ClipLocation): boolean {
  const kind = location.clip.kind;
  return kind === 'video' || kind === 'image' || kind === 'overlay';
}

function clipIntersectsTime(clip: TimelineClip, timeMs: number): boolean {
  return timeMs >= clip.startMs && timeMs < clip.startMs + clip.durationMs;
}

function normalizeMs(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

function uniqueIds(values: Iterable<string | undefined> | undefined): string[] {
  if (!values) return [];
  return [
    ...new Set([...values].filter((value): value is string => Boolean(value))),
  ];
}

function windowRadius(windowMs: number | undefined): number {
  if (typeof windowMs !== 'number' || !Number.isFinite(windowMs)) return 5_000;
  return Math.max(500, Math.min(60_000, Math.round(windowMs)));
}
