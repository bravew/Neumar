import { clipPlaybackFromFields } from '@neumar/video-ir';

import { carryForwardSttCaptions } from './caption-retime';
import { normalizeTransition } from './types';
import type {
  AudioTimelineClip,
  AspectRatio,
  CaptionTimelineClip,
  ClipTransform,
  EditDecisionList,
  EdlAudioClip,
  EdlAudioTrack,
  EdlCaption,
  EdlOverlay,
  EdlSegment,
  MediaItem,
  StoryboardScene,
  Subtitle,
  TimelineClip,
  TimelineSourceRef,
  TimelineTrack,
  VideoProject,
  VideoTimeline,
  VisualTimelineClip,
} from './types';
import {
  inferDefaultVisualAssetTransform,
  targetAspectRatioForProject,
} from './visual-asset-fit';

const DEFAULT_TIMELINE_FPS = 30;
const TIMELINE_MIGRATION_VERSION = 1;
const AUDIO_CUT_FADE_MS = 30;
const DEFAULT_AUDIO_TRANSITION_FADE_MS = 500;
const CUT_BOUNDARY_TOLERANCE_MS = 34;
const CAPTURE_CAPTION_TRACK_ID = 'track-caption-main';

export function pictureTimelineDurationMs(tracks: TimelineTrack[]): number {
  const ends = tracks
    .filter(isPictureTimelineTrack)
    .flatMap((track) =>
      track.clips.map((clip) => clip.startMs + clip.durationMs),
    );
  return ends.length === 0 ? 0 : Math.max(0, ...ends);
}

function isPictureTimelineTrack(track: TimelineTrack): boolean {
  return (
    track.kind === 'video' || track.kind === 'broll' || track.kind === 'overlay'
  );
}

interface CompileTimelineToEdlOptions {
  aspectRatio?: AspectRatio;
}

export interface CaptureCaptionInsertInput {
  captureId: string;
  captureClipId: string;
  assetId: string;
  timelineStartMs: number;
  sourceDurationMs: number;
  sceneId?: string;
  subtitles: Subtitle[];
}

export function migrateStoryboardToTimeline(
  project: VideoProject,
): VideoProject {
  if (project.timeline) return project;
  const storyboard = project.storyboard;
  if (!storyboard?.scenes.length) return project;

  return rebuildTimelineFromStoryboard(project);
}

export function rebuildTimelineFromStoryboard(
  project: VideoProject,
): VideoProject {
  const storyboard = project.storyboard;
  if (!storyboard?.scenes.length) return project;

  return {
    ...project,
    // Carry generated STT captions across the rebuild, retimed to the new
    // clips, so they aren't wiped by an unrelated storyboard edit.
    timeline: carryForwardSttCaptions(
      project.timeline,
      buildTimelineFromStoryboard(project),
    ),
  };
}

export function compileTimelineToEdl(
  project: VideoProject,
  options: CompileTimelineToEdlOptions = {},
): EditDecisionList {
  const aspectRatio =
    options.aspectRatio ?? targetAspectRatioForProject(project);
  const timeline = project.timeline ?? buildTimelineFromStoryboard(project);
  const orderedTracks = [...timeline.tracks].sort(compareTracks);
  const segments: EdlSegment[] = [];
  const overlays: EditDecisionList['overlays'] = [];
  const audioTracks: EditDecisionList['audioTracks'] = [];
  const captions: EdlCaption[] = [];

  for (const track of orderedTracks) {
    const clips = [...track.clips].sort(compareClips);
    if (track.kind === 'video') {
      if (track.hidden) continue;
      segments.push(
        ...clips
          .filter(isVisualClip)
          .map((clip) =>
            edlSegmentFromClip(project, aspectRatio, track.id, clip),
          ),
      );
      continue;
    }

    if (track.kind === 'broll' || track.kind === 'overlay') {
      if (track.hidden) continue;
      const overlayKind = track.kind;
      overlays.push(
        ...clips
          .filter(isVisualClip)
          .map((clip) =>
            edlOverlayFromClip(
              project,
              aspectRatio,
              track.id,
              clip,
              overlayKind,
            ),
          ),
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
        clips: clips.filter(isAudioClip).map(edlAudioClipFromClip),
      });
      continue;
    }

    if (track.kind === 'caption') {
      captions.push(...clips.filter(isCaptionClip).map(edlCaptionFromClip));
    }
  }

  const durationMs =
    pictureTimelineDurationMs(orderedTracks) || timeline.durationMs;

  return {
    schema: 'neuma.video.edl.v1',
    projectId: project.id,
    fps: timeline.fps,
    durationMs,
    segments,
    overlays,
    audioTracks: enforceSceneAudioSeamFades(
      clampEdlAudioTracksToPicture(audioTracks, durationMs),
      segments,
    ),
    captions: captions.sort(
      (a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id),
    ),
  };
}

export function insertCaptureCaptionClips(
  timeline: VideoTimeline,
  input: CaptureCaptionInsertInput,
): VideoTimeline {
  const captionClips = captureCaptionClips(input);
  if (captionClips.length === 0) return timeline;

  const existingTrack = timeline.tracks.find(
    (track) => track.kind === 'caption' && !track.locked,
  );
  const captionTrack =
    existingTrack ?? buildCaptureCaptionTrack(timeline.tracks);
  const hasCaptionTrack = timeline.tracks.some(
    (track) => track.id === captionTrack.id,
  );
  const tracks = (
    hasCaptionTrack ? timeline.tracks : [...timeline.tracks, captionTrack]
  ).map((track) => {
    if (track.id !== captionTrack.id) return track;
    return {
      ...track,
      clips: [
        ...track.clips.filter(
          (clip) => clip.params?.captureId !== input.captureId,
        ),
        ...captionClips,
      ],
    } as TimelineTrack;
  });

  return {
    ...timeline,
    tracks,
    durationMs: Math.max(
      timeline.durationMs,
      pictureTimelineDurationMs(tracks),
    ),
  };
}

function buildTimelineFromStoryboard(project: VideoProject): VideoTimeline {
  const storyboard = project.storyboard;
  const scenes = storyboard?.scenes ?? [];
  const fps = deriveTimelineFps(project.assets);
  const durationMs =
    storyboard?.totalDurationMs ??
    scenes.reduce((total, scene) => total + scene.durationMs, 0);
  const videoClips: VisualTimelineClip[] = [];
  const captionClips: CaptionTimelineClip[] = [];
  const narrationClips: AudioTimelineClip[] = [];
  let cursorMs = 0;

  for (const scene of scenes) {
    videoClips.push(videoClipFromScene(project, scene, cursorMs));
    if (scene.caption?.text) {
      captionClips.push(captionClipFromScene(scene, cursorMs));
    }

    const narration = storyboard?.narration?.segments.find(
      (segment) => segment.sceneId === scene.id,
    );
    if (narration) {
      const usesStoryboardNarrationAsset = Boolean(
        storyboard?.narration?.assetId,
      );
      const narrationSourceStartMs = usesStoryboardNarrationAsset
        ? cursorMs
        : 0;
      const narrationSourceDurationMs = usesStoryboardNarrationAsset
        ? (storyboard?.totalDurationMs ?? durationMs)
        : scene.durationMs;
      narrationClips.push({
        id: `clip-narration-${scene.id}`,
        kind: 'audio',
        name: `Narration: ${scene.intent}`,
        sourceRef: storyboard?.narration?.assetId
          ? { kind: 'asset', assetId: storyboard.narration.assetId }
          : { kind: 'scene', sceneId: scene.id },
        sceneId: scene.id,
        startMs: cursorMs,
        durationMs: scene.durationMs,
        trimStartMs: narrationSourceStartMs,
        trimEndMs: narrationSourceStartMs + scene.durationMs,
        sourceDurationMs: narrationSourceDurationMs,
        transcriptText: narration.text,
        fadeInMs: 30,
        fadeOutMs: 30,
      });
    }

    cursorMs += scene.durationMs;
  }

  const tracks: TimelineTrack[] = [
    {
      id: 'track-video-main',
      kind: 'video',
      name: 'Video 1',
      muted: false,
      locked: false,
      hidden: false,
      order: 0,
      clips: videoClips,
    },
  ];

  if (narrationClips.length > 0) {
    tracks.push({
      id: 'track-audio-vo',
      kind: 'audio-vo',
      name: 'Voiceover',
      muted: false,
      locked: false,
      order: 10,
      volumeDb: 0,
      clips: narrationClips,
    });
  }

  if (storyboard?.music?.assetId) {
    const musicAsset = project.assets.find(
      (asset) => asset.id === storyboard.music?.assetId,
    );
    const sourceDurationMs = Math.max(
      1,
      musicAsset?.metadata.durationMs ?? storyboard.music.durationMs,
    );
    const clipDurationMs = Math.min(sourceDurationMs, durationMs);
    tracks.push({
      id: 'track-audio-music',
      kind: 'audio-music',
      name: 'Music',
      muted: false,
      locked: false,
      order: 20,
      volumeDb: -10,
      duckUnderTrackId:
        narrationClips.length > 0 ? 'track-audio-vo' : undefined,
      clips: [
        {
          id: 'clip-music-main',
          kind: 'audio',
          name: storyboard.music.prompt,
          sourceRef: { kind: 'asset', assetId: storyboard.music.assetId },
          startMs: 0,
          durationMs: clipDurationMs,
          trimStartMs: 0,
          trimEndMs: clipDurationMs,
          sourceDurationMs,
          gainDb: -10,
          fadeInMs: 30,
          fadeOutMs: 30,
        },
      ],
    });
  }

  if (captionClips.length > 0) {
    tracks.push({
      id: 'track-caption-main',
      kind: 'caption',
      name: 'Captions',
      muted: false,
      locked: false,
      order: 30,
      clips: captionClips,
    });
  }

  return {
    schema: 'neuma.video.timeline.v1',
    tracks,
    durationMs,
    fps,
    migration: {
      from: 'storyboard',
      version: TIMELINE_MIGRATION_VERSION,
    },
  };
}

function captureCaptionClips(
  input: CaptureCaptionInsertInput,
): CaptionTimelineClip[] {
  return input.subtitles.flatMap((subtitle, index) => {
    const localStartMs = Math.max(0, Math.round(subtitle.startMs));
    const localEndMs = Math.min(
      input.sourceDurationMs,
      Math.max(localStartMs + 100, Math.round(subtitle.endMs)),
    );
    if (localEndMs <= localStartMs) return [];
    const startMs = input.timelineStartMs + localStartMs;
    const durationMs = localEndMs - localStartMs;
    return [
      {
        id: `clip-caption-capture-${input.captureId}-${index + 1}`,
        kind: 'caption',
        name: 'Capture caption',
        sourceRef: { kind: 'asset', assetId: input.assetId },
        sceneId: input.sceneId,
        startMs,
        durationMs,
        trimStartMs: localStartMs,
        trimEndMs: localEndMs,
        sourceDurationMs: input.sourceDurationMs,
        text: subtitle.text,
        style: subtitle.style,
        params: {
          origin: 'capture',
          captureId: input.captureId,
          captureClipId: input.captureClipId,
          sourceCaptionId: subtitle.id,
        },
      },
    ];
  });
}

function buildCaptureCaptionTrack(tracks: TimelineTrack[]): TimelineTrack {
  return {
    id: uniqueTimelineTrackId(tracks, CAPTURE_CAPTION_TRACK_ID),
    kind: 'caption',
    name: 'Captions',
    muted: false,
    locked: false,
    order: Math.max(-10, ...tracks.map((track) => track.order)) + 10,
    clips: [],
  };
}

function videoClipFromScene(
  project: VideoProject,
  scene: StoryboardScene,
  startMs: number,
): VisualTimelineClip {
  const { sourceRef, sourceAsset } = visualSourceForScene(project, scene);
  const sourceDurationMs = sourceAsset?.metadata.durationMs ?? scene.durationMs;
  const trim =
    scene.assetPlan.kind === 'existing' ? scene.assetPlan.trimMs : undefined;
  const trimStartMs = trim?.[0] ?? 0;
  const trimEndMs = trim?.[1] ?? Math.min(sourceDurationMs, scene.durationMs);

  return {
    id: `clip-scene-${scene.id}`,
    kind: visualClipKind(scene, sourceAsset),
    name: scene.intent,
    sourceRef,
    sceneId: scene.id,
    startMs,
    durationMs: scene.durationMs,
    trimStartMs,
    trimEndMs,
    sourceDurationMs,
    transitionToNext: scene.transition,
    muted: scene.muteAudio,
  };
}

function captionClipFromScene(
  scene: StoryboardScene,
  startMs: number,
): CaptionTimelineClip {
  return {
    id: `clip-caption-${scene.id}`,
    kind: 'caption',
    name: `Caption: ${scene.intent}`,
    sourceRef: { kind: 'scene', sceneId: scene.id },
    sceneId: scene.id,
    startMs,
    durationMs: scene.durationMs,
    trimStartMs: 0,
    trimEndMs: scene.durationMs,
    text: scene.caption?.text ?? '',
    style: scene.caption?.style,
  };
}

function visualSourceForScene(
  project: VideoProject,
  scene: StoryboardScene,
): { sourceRef: TimelineSourceRef; sourceAsset?: MediaItem } {
  if (
    scene.assetPlan.kind === 'existing' ||
    scene.assetPlan.kind === 'image-pan'
  ) {
    const assetId =
      scene.assetPlan.kind === 'existing'
        ? scene.assetPlan.assetId
        : scene.assetPlan.assetId;
    const sourceAsset = project.assets.find((asset) => asset.id === assetId);
    return { sourceRef: { kind: 'asset', assetId }, sourceAsset };
  }

  return {
    sourceRef: { kind: 'scene', sceneId: scene.id },
  };
}

function visualClipKind(
  scene: StoryboardScene,
  sourceAsset: MediaItem | undefined,
): VisualTimelineClip['kind'] {
  if (
    sourceAsset?.kind === 'image' ||
    scene.assetPlan.kind === 'ai-image' ||
    scene.assetPlan.kind === 'image-pan'
  ) {
    return 'image';
  }
  return 'video';
}

function edlSegmentFromClip(
  project: VideoProject,
  aspectRatio: AspectRatio,
  trackId: string,
  clip: VisualTimelineClip,
): EdlSegment {
  const transforms =
    clip.transforms ?? defaultTransformForClip(project, clip, aspectRatio);
  const segment: EdlSegment = {
    id: `edl-${clip.id}`,
    trackId,
    clipId: clip.id,
    sourceRef: clip.sourceRef,
    sceneId: clip.sceneId,
    timelineStartMs: clip.startMs,
    sourceStartMs: clip.trimStartMs,
    sourceDurationMs: clip.sourceDurationMs,
    durationMs: clip.durationMs,
  };
  if (transforms) segment.transforms = transforms;
  if (clip.keyframes) segment.keyframes = clip.keyframes;
  const transition = normalizeTransition(clip.transitionToNext);
  if (transition.kind !== 'cut') segment.transitionToNext = transition;
  if (clip.audioSeamToNext) segment.audioSeamToNext = clip.audioSeamToNext;
  if (clip.filters) segment.filters = clip.filters;
  if (clip.effects) segment.effects = clip.effects;
  const playback = clipPlaybackFromFields(clip);
  if (playback) segment.playback = playback;
  if (clip.muted != null) segment.muted = clip.muted;
  if (typeof clip.entranceMs === 'number') segment.entranceMs = clip.entranceMs;
  if (typeof clip.exitMs === 'number') segment.exitMs = clip.exitMs;
  return segment;
}

function edlOverlayFromClip(
  project: VideoProject,
  aspectRatio: AspectRatio,
  trackId: string,
  clip: VisualTimelineClip,
  kind: EdlOverlay['kind'],
): EdlOverlay {
  return {
    ...edlSegmentFromClip(project, aspectRatio, trackId, clip),
    kind,
    ptsShiftMs: clip.startMs - clip.trimStartMs,
  };
}

function defaultTransformForClip(
  project: VideoProject,
  clip: VisualTimelineClip,
  aspectRatio: AspectRatio,
): ClipTransform | undefined {
  const { sourceRef } = clip;
  if (sourceRef.kind !== 'asset') return undefined;
  const asset = project.assets.find((item) => item.id === sourceRef.assetId);
  return asset
    ? inferDefaultVisualAssetTransform(asset, aspectRatio)
    : undefined;
}

function edlAudioClipFromClip(clip: AudioTimelineClip): EdlAudioClip {
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

function enforceSceneAudioSeamFades(
  tracks: EdlAudioTrack[],
  segments: EdlSegment[],
): EdlAudioTrack[] {
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

function visualSeams(segments: EdlSegment[]): Array<{
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
    const transition = normalizeTransition(current.transitionToNext);
    const followsAudio = current.audioSeamToNext !== 'cut';
    seams.push({
      atMs: boundaryMs,
      fadeMs:
        transition.kind === 'cut' || !followsAudio
          ? AUDIO_CUT_FADE_MS
          : (transition.durationMs ?? DEFAULT_AUDIO_TRANSITION_FADE_MS),
    });
  }

  return seams.sort((a, b) => a.atMs - b.atMs);
}

function fadeForBoundary(
  valueMs: number,
  seams: Array<{ atMs: number; fadeMs: number }>,
): number | undefined {
  return seams.find(
    (seam) => Math.abs(valueMs - seam.atMs) <= CUT_BOUNDARY_TOLERANCE_MS,
  )?.fadeMs;
}

function edlCaptionFromClip(clip: CaptionTimelineClip): EdlCaption {
  return {
    id: `edl-${clip.id}`,
    clipId: clip.id,
    sourceRef: clip.sourceRef,
    sceneId: clip.sceneId,
    startMs: clip.startMs,
    endMs: clip.startMs + clip.durationMs,
    text: clip.text,
    words: clip.words,
    keyframes: clip.keyframes,
    style: clip.style,
    entranceMs: clip.entranceMs,
    exitMs: clip.exitMs,
  };
}

function deriveTimelineFps(assets: MediaItem[]): number {
  const frameRate = assets.find(
    (asset) =>
      typeof asset.metadata.frameRate === 'number' &&
      Number.isFinite(asset.metadata.frameRate) &&
      asset.metadata.frameRate > 0,
  )?.metadata.frameRate;
  return frameRate ? Math.round(frameRate) : DEFAULT_TIMELINE_FPS;
}

function clampEdlAudioTracksToPicture(
  tracks: EdlAudioTrack[],
  pictureDurationMs: number,
): EdlAudioTrack[] {
  return tracks.map((track) => ({
    ...track,
    clips: track.clips
      .filter((clip) => clip.timelineStartMs < pictureDurationMs)
      .map((clip) => ({
        ...clip,
        durationMs: Math.max(
          1,
          Math.min(clip.durationMs, pictureDurationMs - clip.timelineStartMs),
        ),
      })),
  }));
}

function uniqueTimelineTrackId(
  tracks: TimelineTrack[],
  baseId: string,
): string {
  const ids = new Set(tracks.map((track) => track.id));
  if (!ids.has(baseId)) return baseId;
  let index = 2;
  while (ids.has(`${baseId}-${index}`)) index += 1;
  return `${baseId}-${index}`;
}

function compareTracks(a: TimelineTrack, b: TimelineTrack): number {
  return a.order - b.order || a.id.localeCompare(b.id);
}

function compareClips(a: TimelineClip, b: TimelineClip): number {
  return a.startMs - b.startMs || a.id.localeCompare(b.id);
}

function isVisualClip(clip: TimelineClip): clip is VisualTimelineClip {
  return (
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
  );
}

function isAudioClip(clip: TimelineClip): clip is AudioTimelineClip {
  return clip.kind === 'audio';
}

function isCaptionClip(clip: TimelineClip): clip is CaptionTimelineClip {
  return clip.kind === 'caption';
}
