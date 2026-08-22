import {
  clipPlaybackFromFields,
  durationMsToFrames,
  msToFrame,
  normalizeClipPlayback,
  type ClipPlayback,
  type ClipEffectStack,
  type KeyframeTrack,
} from '@neumar/video-ir';

import { API_BASE_URL } from '@/config';
import {
  isVisualTimelineTrack,
  normalizeVideoTransition,
  type VideoAspectRatio,
  type VideoClipFilters,
  type VideoEdlAudioClip,
  type VideoEdlAudioTrack,
  type VideoEdlCaption,
  type VideoEdlOverlay,
  type VideoEdlSegment,
  type VideoEditDecisionList,
  type VideoProject,
  type VideoRect,
  type VideoReframeOverride,
  type VideoStoryboardScene,
  type VideoTimelineClip,
  type VideoTimelineSourceRef,
  type VideoVisualTimelineClip,
} from '@/shared/types/video';

import {
  compareTimelineClips,
  compareTimelineTracks,
  getProjectTimeline,
} from '../timeline/projectTimeline';
import { inferDefaultVisualAssetTransform } from '../timeline/visualAssetFit';
import {
  buildVividOverlayEntries,
  type RemotionVividOverlay,
} from './overlays/vividOverlayPreviewModel';

export interface RemotionPreviewData {
  compositionWidth: number;
  compositionHeight: number;
  durationInFrames: number;
  fps: number;
  introFrames?: number;
  outroFrames?: number;
  visualClips: RemotionVisualClip[];
  audioClips: RemotionAudioClip[];
  captions: RemotionCaption[];
  /** Vivid overlay clips (effect kind); rendering is feature-flag gated. */
  vividOverlays: RemotionVividOverlay[];
}

export interface RemotionVisualClip {
  id: string;
  timelineClipId?: string;
  fromFrame: number;
  sourceStartFrame: number;
  sourceEndFrame: number;
  sourceDurationFrames?: number;
  durationInFrames: number;
  layer: number;
  trackId: string;
  trackKind: 'video' | 'broll' | 'overlay';
  label: string;
  mediaKind: 'image' | 'video' | 'placeholder';
  src?: string;
  transform?: VideoVisualTimelineClip['transforms'];
  transitionToNext?: VideoVisualTimelineClip['transitionToNext'];
  audioSeamToNext?: VideoVisualTimelineClip['audioSeamToNext'];
  filters?: VideoClipFilters;
  effects?: ClipEffectStack;
  reframe?: VideoReframeOverride;
  muted?: boolean;
  playback?: ClipPlayback;
  /** Ken Burns keyframes for an image-pan scene (normalized 0..1 rects). */
  imagePan?: { from: VideoRect; to: VideoRect };
}

export interface RemotionAudioClip {
  id: string;
  fromFrame: number;
  sourceStartFrame: number;
  sourceEndFrame: number;
  durationInFrames: number;
  src?: string;
  volume: number;
  playback?: ClipPlayback;
  gainDb?: number;
  trackVolumeDb?: number;
  keyframes?: KeyframeTrack[];
  muted?: boolean;
  trackMuted?: boolean;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  fadeInCurve?: VideoEdlAudioClip['fadeInCurve'];
  fadeOutCurve?: VideoEdlAudioClip['fadeOutCurve'];
}

export interface RemotionCaptionWord {
  text: string;
  /** Frame the word becomes active, relative to the caption's start. */
  fromFrame: number;
  /** Frame the word stops being active, relative to the caption's start. */
  toFrame: number;
}

export interface RemotionCaption {
  id: string;
  fromFrame: number;
  durationInFrames: number;
  text: string;
  words?: RemotionCaptionWord[];
  animation?: 'tiktok-word' | 'hormozi-bold' | 'classic' | 'karaoke' | 'none';
  position: 'top' | 'middle' | 'bottom';
  /** Normalized 0..1 center-x in canvas width. */
  positionX?: number;
  /** Normalized 0..1 top-y in canvas height. */
  positionY?: number;
  /** Fraction of canvas width the caption may occupy (0..1). */
  maxWidth?: number;
  /** Override font size, in canvas-relative px. */
  fontSize?: number;
  /** Text color (any CSS color). */
  color?: string;
  /** Background color (any CSS color, may include alpha). */
  background?: string;
  textAlign?: 'left' | 'center' | 'right';
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline';
  strokeColor?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowBlur?: number;
  fontFamily?: string;
  entranceFrames?: number;
  exitFrames?: number;
}

const DEFAULT_PREVIEW_FPS = 30;
const AUDIO_CUT_FADE_MS = 30;
const DEFAULT_AUDIO_TRANSITION_FADE_MS = 500;
const CUT_BOUNDARY_TOLERANCE_MS = 34;
const MIN_BOOKEND_FADE_MS = 33;
const MAX_BOOKEND_FADE_MS = 3000;

const ASPECT_DIMENSIONS: Record<
  VideoAspectRatio,
  { width: number; height: number }
> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

export function buildRemotionPreviewData(
  project: VideoProject,
  aspectRatio: VideoAspectRatio,
): RemotionPreviewData {
  const edl = compileProjectToEdl(project, aspectRatio);
  const timeline = getProjectTimeline(project, aspectRatio);
  const visualLayerByTrackId = new Map(
    [...timeline.tracks]
      .sort(compareTimelineTracks)
      .filter(isVisualTimelineTrack)
      .map((track, index) => [track.id, track.order + index / 1000]),
  );
  const dimensions = ASPECT_DIMENSIONS[aspectRatio];
  const fps = edl.fps || DEFAULT_PREVIEW_FPS;
  const visualClips = [...edl.segments, ...edl.overlays]
    .map((segment, index) =>
      visualClipFromSegment(
        project,
        segment,
        aspectRatio,
        fps,
        visualLayerByTrackId.get(segment.trackId) ?? index,
      ),
    )
    .sort(
      (a, b) =>
        a.layer - b.layer ||
        a.fromFrame - b.fromFrame ||
        a.id.localeCompare(b.id),
    )
    .map((clip, layer) => ({ ...clip, layer }));
  return {
    compositionWidth: dimensions.width,
    compositionHeight: dimensions.height,
    durationInFrames: Math.max(1, durationMsToFrames(edl.durationMs, fps)),
    fps,
    introFrames: bookendFrames(timeline.intro?.durationMs, edl.durationMs, fps),
    outroFrames: bookendFrames(timeline.outro?.durationMs, edl.durationMs, fps),
    visualClips,
    audioClips: edl.audioTracks.flatMap((track) =>
      track.muted
        ? []
        : track.clips.map((clip) =>
            audioClipFromEdl(project, track, clip, fps),
          ),
    ),
    captions: edl.captions.map((caption) => captionFromEdl(caption, fps)),
    vividOverlays: buildVividOverlayEntries(timeline, fps),
  };
}

export function buildRemotionPreviewDataSignature(
  project: VideoProject,
  aspectRatio: VideoAspectRatio,
): string {
  const timeline = project.timeline
    ? {
        schema: project.timeline.schema,
        durationMs: project.timeline.durationMs,
        fps: project.timeline.fps,
        intro: project.timeline.intro,
        outro: project.timeline.outro,
        tracks: project.timeline.tracks.map((track) => ({
          id: track.id,
          kind: track.kind,
          muted: track.muted,
          order: track.order,
          hidden: 'hidden' in track ? track.hidden : undefined,
          volumeDb: 'volumeDb' in track ? track.volumeDb : undefined,
          duckUnderTrackId:
            'duckUnderTrackId' in track ? track.duckUnderTrackId : undefined,
          clips: track.clips,
        })),
      }
    : undefined;
  const storyboard = project.storyboard
    ? {
        totalDurationMs: project.storyboard.totalDurationMs,
        scenes: project.storyboard.scenes.map((scene) => ({
          id: scene.id,
          durationMs: scene.durationMs,
          intent: scene.intent,
          assetPlan: scene.assetPlan,
          transition: scene.transition,
          muteAudio: scene.muteAudio,
          reframe: scene.reframe,
        })),
      }
    : undefined;
  return JSON.stringify({
    aspectRatio,
    projectId: project.id,
    assets: project.assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      path: asset.path,
      proxy: asset.proxy,
      metadata: asset.metadata,
    })),
    timeline,
    storyboard,
    autoReframeEnabled: project.settings?.autoReframeEnabled,
  });
}

export function compileProjectToEdl(
  project: VideoProject,
  aspectRatio: VideoAspectRatio = '16:9',
): VideoEditDecisionList {
  const timeline = getProjectTimeline(project, aspectRatio);
  const segments: VideoEdlSegment[] = [];
  const overlays: VideoEdlOverlay[] = [];
  const audioTracks: VideoEdlAudioTrack[] = [];
  const captions: VideoEdlCaption[] = [];

  for (const track of [...timeline.tracks].sort(compareTimelineTracks)) {
    const clips = [...track.clips].sort(compareTimelineClips);
    if (track.kind === 'video') {
      if (track.hidden) continue;
      segments.push(
        ...clips
          .filter(isVisualClip)
          .map((clip) =>
            segmentFromClip(project, aspectRatio, track.id, clip, track.muted),
          ),
      );
      continue;
    }
    if (track.kind === 'broll' || track.kind === 'overlay') {
      if (track.hidden) continue;
      const kind = track.kind;
      overlays.push(
        ...clips.filter(isVisualClip).map((clip) => ({
          ...segmentFromClip(project, aspectRatio, track.id, clip, track.muted),
          kind,
        })),
      );
      continue;
    }
    if (
      track.kind === 'audio-vo' ||
      track.kind === 'audio-music' ||
      track.kind === 'audio-sfx'
    ) {
      audioTracks.push({
        id: track.id,
        kind: track.kind,
        muted: track.muted,
        volumeDb: track.volumeDb,
        duckUnderTrackId: track.duckUnderTrackId,
        clips: clips.filter(isAudioClip).map(audioFromClip),
      });
      continue;
    }
    if (track.kind === 'caption') {
      captions.push(...clips.filter(isCaptionClip).map(captionFromClip));
    }
  }

  return {
    schema: 'neuma.video.edl.v1',
    projectId: project.id,
    fps: timeline.fps,
    durationMs: timeline.durationMs,
    segments,
    overlays,
    audioTracks: enforceSceneAudioSeamFades(audioTracks, segments),
    captions: captions.sort(
      (a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id),
    ),
  };
}

function visualClipFromSegment(
  project: VideoProject,
  segment: VideoEdlSegment | VideoEdlOverlay,
  aspectRatio: VideoAspectRatio,
  fps: number,
  layer: number,
): RemotionVisualClip {
  const resolved = resolveMediaSource(project, segment.sourceRef);
  const scene = segment.sceneId
    ? project.storyboard?.scenes.find((item) => item.id === segment.sceneId)
    : undefined;
  const trackKind = 'kind' in segment ? segment.kind : 'video';
  const sourceStartFrame = msToFrame(segment.sourceStartMs, fps);
  const durationInFrames = Math.max(
    1,
    durationMsToFrames(segment.durationMs, fps),
  );
  const sourceDurationFrames = segment.sourceDurationMs
    ? durationMsToFrames(segment.sourceDurationMs, fps)
    : undefined;
  return {
    id: segment.id,
    timelineClipId: segment.clipId,
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
    trackKind,
    label: resolved.label,
    mediaKind:
      resolved.kind === 'image' || resolved.kind === 'video'
        ? resolved.kind
        : 'placeholder',
    src: resolved.src,
    transform: segment.transforms,
    transitionToNext: segment.transitionToNext,
    audioSeamToNext: segment.audioSeamToNext,
    filters: segment.filters,
    effects: segment.effects,
    muted: segment.muted ?? scene?.muteAudio,
    playback: segment.playback,
    reframe:
      trackKind === 'video'
        ? previewReframe(
            aspectRatio,
            project.settings?.autoReframeEnabled,
            scene,
          )
        : undefined,
    imagePan:
      resolved.kind === 'image' &&
      scene?.assetPlan.kind === 'image-pan' &&
      scene.assetPlan.kenBurns
        ? scene.assetPlan.kenBurns
        : undefined,
  };
}

function previewReframe(
  aspectRatio: VideoAspectRatio,
  enabled: boolean | undefined,
  scene: VideoStoryboardScene | undefined,
): VideoReframeOverride | undefined {
  if (enabled === false) return undefined;
  const override =
    scene?.reframe?.aspect === aspectRatio ? scene.reframe : undefined;
  if (aspectRatio === '16:9' && !override) return undefined;
  if (override) return override;
  return {
    aspect: aspectRatio,
    anchor: scene?.assetPlan.kind === 'lipsync' ? 'top-third' : 'center',
  };
}

function audioClipFromEdl(
  project: VideoProject,
  track: VideoEdlAudioTrack,
  clip: VideoEdlAudioClip,
  fps: number,
): RemotionAudioClip {
  const resolved = resolveMediaSource(project, clip.sourceRef);
  const sourceStartFrame = msToFrame(clip.sourceStartMs, fps);
  const durationInFrames = Math.max(
    1,
    durationMsToFrames(clip.durationMs, fps),
  );
  return {
    id: clip.id,
    fromFrame: msToFrame(clip.timelineStartMs, fps),
    sourceStartFrame,
    sourceEndFrame: sourceEndFrameForPlayback({
      durationInFrames,
      playback: clip.playback,
      sourceStartFrame,
    }),
    durationInFrames,
    src: resolved.src,
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
  };
}

function captionFromEdl(
  caption: VideoEdlCaption,
  fps: number,
): RemotionCaption {
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
      // Frames relative to the caption's own start (the Sequence origin).
      // Clamp the ms delta first — msToFrame rejects a negative input.
      fromFrame: msToFrame(Math.max(0, word.startMs - caption.startMs), fps),
      toFrame: Math.max(
        1,
        msToFrame(Math.max(0, word.endMs - caption.startMs), fps),
      ),
    })),
    animation: caption.style?.animation,
    position: caption.style?.position ?? 'bottom',
    positionX: caption.style?.positionX,
    positionY: caption.style?.positionY,
    maxWidth: caption.style?.maxWidth,
    fontSize: caption.style?.fontSize,
    color: caption.style?.color,
    background: caption.style?.background,
    textAlign: caption.style?.textAlign,
    fontWeight: caption.style?.fontWeight,
    fontStyle: caption.style?.fontStyle,
    textDecoration: caption.style?.textDecoration,
    strokeColor: caption.style?.strokeColor,
    strokeWidth: caption.style?.strokeWidth,
    shadowColor: caption.style?.shadowColor,
    shadowOffsetX: caption.style?.shadowOffsetX,
    shadowOffsetY: caption.style?.shadowOffsetY,
    shadowBlur: caption.style?.shadowBlur,
    fontFamily: caption.style?.fontFamily,
    entranceFrames: caption.entranceMs
      ? Math.max(0, durationMsToFrames(caption.entranceMs, fps))
      : undefined,
    exitFrames: caption.exitMs
      ? Math.max(0, durationMsToFrames(caption.exitMs, fps))
      : undefined,
  };
}

function segmentFromClip(
  project: VideoProject,
  aspectRatio: VideoAspectRatio,
  trackId: string,
  clip: VideoVisualTimelineClip,
  trackMuted = false,
): VideoEdlSegment {
  const playback = clipPlaybackFromFields(clip);
  const transforms =
    clip.transforms ?? defaultTransformForClip(project, clip, aspectRatio);
  return {
    id: `edl-${clip.id}`,
    trackId,
    clipId: clip.id,
    sourceRef: clip.sourceRef,
    sceneId: clip.sceneId,
    timelineStartMs: clip.startMs,
    sourceStartMs: clip.trimStartMs,
    sourceDurationMs: clip.sourceDurationMs,
    durationMs: clip.durationMs,
    ...(playback ? { playback } : {}),
    transforms,
    transitionToNext: clip.transitionToNext,
    audioSeamToNext: clip.audioSeamToNext,
    filters: clip.filters,
    effects: clip.effects,
    muted: trackMuted || clip.muted === true ? true : clip.muted,
  };
}

function defaultTransformForClip(
  project: VideoProject,
  clip: VideoVisualTimelineClip,
  aspectRatio: VideoAspectRatio,
) {
  const { sourceRef } = clip;
  if (sourceRef.kind !== 'asset') return undefined;
  const asset = project.assets.find((item) => item.id === sourceRef.assetId);
  return asset
    ? inferDefaultVisualAssetTransform(asset, aspectRatio)
    : undefined;
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

function audioFromClip(clip: Extract<VideoTimelineClip, { kind: 'audio' }>) {
  const playback = clipPlaybackFromFields(clip);
  return {
    id: `edl-${clip.id}`,
    clipId: clip.id,
    sourceRef: clip.sourceRef,
    sceneId: clip.sceneId,
    timelineStartMs: clip.startMs,
    sourceStartMs: clip.trimStartMs,
    durationMs: clip.durationMs,
    ...(playback ? { playback } : {}),
    keyframes: clip.keyframes,
    gainDb: clip.gainDb,
    muted: clip.muted,
    fadeInMs: clip.fadeInMs,
    fadeOutMs: clip.fadeOutMs,
    fadeInCurve: clip.fadeInCurve,
    fadeOutCurve: clip.fadeOutCurve,
    audioTransitionToNext: clip.audioTransitionToNext,
    transcriptText: clip.transcriptText,
  };
}

function captionFromClip(
  clip: Extract<VideoTimelineClip, { kind: 'caption' }>,
) {
  return {
    id: `edl-${clip.id}`,
    clipId: clip.id,
    sourceRef: clip.sourceRef,
    sceneId: clip.sceneId,
    startMs: clip.startMs,
    endMs: clip.startMs + clip.durationMs,
    text: clip.text,
    words: clip.words,
    style: clip.style,
    entranceMs: clip.entranceMs,
    exitMs: clip.exitMs,
  };
}

function resolveMediaSource(
  project: VideoProject,
  sourceRef: VideoTimelineSourceRef,
): {
  kind: 'image' | 'video' | 'audio' | 'placeholder';
  label: string;
  src?: string;
} {
  if (sourceRef.kind === 'asset') {
    const asset = project.assets.find((item) => item.id === sourceRef.assetId);
    if (!asset) {
      return { kind: 'placeholder', label: sourceRef.assetId };
    }
    return assetMediaSource(project, asset);
  }
  if (sourceRef.kind === 'scene') {
    const scene = project.storyboard?.scenes.find(
      (item) => item.id === sourceRef.sceneId,
    );
    // Mirror the backend renderer (`resolveVisualAsset`): a scene-sourced clip
    // whose plan points at a concrete project asset (existing/image-pan) shows
    // that asset, not a placeholder. The stream endpoint hydrates referenced
    // (cloud) assets on demand, so this also surfaces not-yet-downloaded picks.
    const plan = scene?.assetPlan;
    if (plan && (plan.kind === 'existing' || plan.kind === 'image-pan')) {
      const asset = project.assets.find((item) => item.id === plan.assetId);
      if (asset) return assetMediaSource(project, asset);
    }
    return { kind: 'placeholder', label: scene?.intent ?? sourceRef.sceneId };
  }
  return { kind: 'placeholder', label: sourceRef.externalId };
}

function assetMediaSource(
  project: VideoProject,
  asset: VideoProject['assets'][number],
): { kind: 'image' | 'video' | 'audio'; label: string; src: string } {
  // Self-heal a mis-recorded asset kind by sniffing the file extension.
  // Stale Immich/Drive attaches (pre-fix) saved kind='image' for `.mp4`
  // bytes because the destination filename ended `…mp4.mp4` and
  // `inferKind` keyed off the wrong tail. The Remotion preview branches
  // hard on `mediaKind` — picking the wrong branch swaps `<Html5Video>`
  // for `<Img>`, which renders a poster but never plays.
  const resolvedKind = reconcileAssetKind(asset.kind, asset.path);
  return {
    kind: resolvedKind,
    label: asset.path.split('/').pop() ?? asset.id,
    src: `${API_BASE_URL}/video/projects/${encodeURIComponent(
      project.id,
    )}/assets/${encodeURIComponent(asset.id)}/stream${
      asset.proxy ? '?variant=proxy' : ''
    }`,
  };
}

const VIDEO_FILE_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'webm',
  'mkv',
  'm4v',
  'avi',
  'wmv',
  'flv',
  '3gp',
]);
const AUDIO_FILE_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'wma',
  'aiff',
]);

function reconcileAssetKind(
  recordedKind: 'image' | 'video' | 'audio',
  assetPath: string,
): 'image' | 'video' | 'audio' {
  // Strip `.mp4.mp4`-style duplicate suffixes so we sniff the real tail.
  const lower = assetPath.toLowerCase();
  const tail = lower.endsWith('.mp4.mp4')
    ? lower.slice(0, -4)
    : lower.endsWith('.mov.mov')
      ? lower.slice(0, -4)
      : lower;
  const ext = tail.slice(tail.lastIndexOf('.') + 1);
  if (VIDEO_FILE_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_FILE_EXTENSIONS.has(ext)) return 'audio';
  return recordedKind;
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

function enforceSceneAudioSeamFades(
  tracks: VideoEdlAudioTrack[],
  segments: VideoEdlSegment[],
): VideoEdlAudioTrack[] {
  const seams = visualSeams(segments);
  if (seams.length === 0) return tracks;

  return tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      if (!clip.sceneId) return clip;
      const clipEndMs = clip.timelineStartMs + clip.durationMs;
      const fadeInMs = fadeForBoundary(clip.timelineStartMs, seams);
      const fadeOutMs = fadeForBoundary(clipEndMs, seams);
      if (!fadeInMs && !fadeOutMs) return clip;
      return {
        ...clip,
        fadeInMs: fadeInMs
          ? Math.max(clip.fadeInMs ?? 0, fadeInMs)
          : clip.fadeInMs,
        fadeOutMs: fadeOutMs
          ? Math.max(clip.fadeOutMs ?? 0, fadeOutMs)
          : clip.fadeOutMs,
      };
    }),
  }));
}

function visualSeams(segments: VideoEdlSegment[]): Array<{
  atMs: number;
  fadeMs: number;
}> {
  const ordered = [...segments].sort(
    (a, b) => a.timelineStartMs - b.timelineStartMs || a.id.localeCompare(b.id),
  );
  const seams: Array<{ atMs: number; fadeMs: number }> = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const current = ordered[index]!;
    const next = ordered[index + 1]!;
    const boundaryMs = current.timelineStartMs + current.durationMs;
    if (
      Math.abs(next.timelineStartMs - boundaryMs) > CUT_BOUNDARY_TOLERANCE_MS
    ) {
      continue;
    }
    const transition = normalizeVideoTransition(current.transitionToNext);
    const followsAudio = current.audioSeamToNext !== 'cut';
    seams.push({
      atMs: boundaryMs,
      fadeMs:
        transition.kind === 'cut' || !followsAudio
          ? AUDIO_CUT_FADE_MS
          : (transition.durationMs ?? DEFAULT_AUDIO_TRANSITION_FADE_MS),
    });
  }
  return seams;
}

function fadeForBoundary(
  valueMs: number,
  seams: Array<{ atMs: number; fadeMs: number }>,
): number | undefined {
  return seams.find(
    (seam) => Math.abs(valueMs - seam.atMs) <= CUT_BOUNDARY_TOLERANCE_MS,
  )?.fadeMs;
}

function isVisualClip(
  clip: VideoTimelineClip,
): clip is VideoVisualTimelineClip {
  return (
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
  );
}

function isAudioClip(
  clip: VideoTimelineClip,
): clip is Extract<VideoTimelineClip, { kind: 'audio' }> {
  return clip.kind === 'audio';
}

function isCaptionClip(
  clip: VideoTimelineClip,
): clip is Extract<VideoTimelineClip, { kind: 'caption' }> {
  return clip.kind === 'caption';
}
