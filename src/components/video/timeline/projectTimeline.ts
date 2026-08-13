import {
  isVisualTimelineTrack,
  type VideoAspectRatio,
  type VideoProject,
  type VideoTimeline,
  type VideoTimelineClip,
  type VideoTimelineSourceRef,
  type VideoTimelineTrack,
  type VideoVisualTimelineClip,
} from '@/shared/types/video';

import {
  inferDefaultVisualAssetTransform,
  targetAspectRatioForProject,
} from './visualAssetFit';

const DEFAULT_TIMELINE_FPS = 30;

export function getProjectTimeline(
  project: VideoProject,
  aspectRatio: VideoAspectRatio = targetAspectRatioForProject(project),
): VideoTimeline {
  return normalizeTimelineDuration(
    project.timeline ?? timelineFromStoryboard(project, aspectRatio),
  );
}

export function compareTimelineTracks(
  a: VideoTimelineTrack,
  b: VideoTimelineTrack,
): number {
  return a.order - b.order || a.id.localeCompare(b.id);
}

export function compareTimelineRows(
  a: VideoTimelineTrack,
  b: VideoTimelineTrack,
): number {
  const groupDelta = getTimelineRowGroup(a) - getTimelineRowGroup(b);
  if (groupDelta !== 0) return groupDelta;
  if (isCaptionOrVisualTrack(a) && isCaptionOrVisualTrack(b)) {
    return b.order - a.order || a.id.localeCompare(b.id);
  }
  return compareTimelineTracks(a, b);
}

export function compareTimelineClips(
  a: VideoTimelineClip,
  b: VideoTimelineClip,
): number {
  return a.startMs - b.startMs || a.id.localeCompare(b.id);
}

function getTimelineRowGroup(track: VideoTimelineTrack): number {
  if (track.kind === 'caption') return 0;
  if (isVisualTimelineTrack(track)) return 1;
  return 2;
}

function isCaptionOrVisualTrack(track: VideoTimelineTrack): boolean {
  return track.kind === 'caption' || isVisualTimelineTrack(track);
}

function normalizeTimelineDuration(timeline: VideoTimeline): VideoTimeline {
  const clipEndMs = timeline.tracks.reduce(
    (maxEndMs, track) =>
      Math.max(
        maxEndMs,
        ...track.clips.map((clip) => clip.startMs + clip.durationMs),
      ),
    0,
  );
  if (timeline.durationMs >= clipEndMs) return timeline;
  return { ...timeline, durationMs: clipEndMs };
}

function timelineFromStoryboard(
  project: VideoProject,
  aspectRatio: VideoAspectRatio,
): VideoTimeline {
  const scenes = project.storyboard?.scenes ?? [];
  const fps =
    project.assets.find((asset) => asset.metadata.frameRate)?.metadata
      .frameRate ?? DEFAULT_TIMELINE_FPS;
  let cursorMs = 0;
  const clips = scenes.map<VideoVisualTimelineClip>((scene) => {
    const sourceRef = sourceRefForScene(scene);
    const sourceAsset =
      sourceRef.kind === 'asset'
        ? project.assets.find((asset) => asset.id === sourceRef.assetId)
        : undefined;
    const sourceDurationMs =
      sourceAsset?.metadata.durationMs ?? scene.durationMs;
    const clip: VideoVisualTimelineClip = {
      id: `clip-scene-${scene.id}`,
      kind: scene.assetPlan.kind === 'ai-image' ? 'image' : 'video',
      name: scene.intent,
      sourceRef,
      sceneId: scene.id,
      startMs: cursorMs,
      durationMs: scene.durationMs,
      trimStartMs:
        scene.assetPlan.kind === 'existing'
          ? (scene.assetPlan.trimMs?.[0] ?? 0)
          : 0,
      trimEndMs:
        scene.assetPlan.kind === 'existing'
          ? (scene.assetPlan.trimMs?.[1] ??
            Math.min(sourceDurationMs, scene.durationMs))
          : scene.durationMs,
      sourceDurationMs,
      transitionToNext: scene.transition,
      muted: scene.muteAudio,
    };
    const transforms = sourceAsset
      ? inferDefaultVisualAssetTransform(sourceAsset, aspectRatio)
      : undefined;
    if (transforms) clip.transforms = transforms;
    cursorMs += scene.durationMs;
    return clip;
  });

  return {
    schema: 'neuma.video.timeline.v1',
    tracks: [
      {
        id: 'track-video-main',
        kind: 'video',
        name: 'Video 1',
        muted: false,
        locked: false,
        hidden: false,
        order: 0,
        clips,
      },
    ],
    durationMs:
      project.storyboard?.totalDurationMs ??
      scenes.reduce((total, scene) => total + scene.durationMs, 0),
    fps: Math.round(fps),
  };
}

function sourceRefForScene(
  scene: NonNullable<VideoProject['storyboard']>['scenes'][number],
): VideoTimelineSourceRef {
  if (
    scene.assetPlan.kind === 'existing' ||
    scene.assetPlan.kind === 'image-pan'
  ) {
    return { kind: 'asset', assetId: scene.assetPlan.assetId };
  }
  return { kind: 'scene', sceneId: scene.id };
}
