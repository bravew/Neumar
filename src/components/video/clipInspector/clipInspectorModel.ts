import type {
  VideoAudioTimelineClip,
  VideoCaptionTimelineClip,
  VideoMediaItem,
  VideoProject,
  VideoStoryboardScene,
  VideoTimelineClip,
  VideoVisualTimelineClip,
} from '@/shared/types/video';

export function isVisualClip(
  clip: VideoTimelineClip,
): clip is VideoVisualTimelineClip {
  return (
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
  );
}

export function isAudioClip(
  clip: VideoTimelineClip,
): clip is VideoAudioTimelineClip {
  return clip.kind === 'audio';
}

export function isCaptionClip(
  clip: VideoTimelineClip,
): clip is VideoCaptionTimelineClip {
  return clip.kind === 'caption';
}

export function sourceAssetForClip(
  clip: VideoVisualTimelineClip,
  project: VideoProject,
): VideoMediaItem | undefined {
  const { sourceRef } = clip;
  if (sourceRef.kind === 'asset') {
    return project.assets.find((asset) => asset.id === sourceRef.assetId);
  }
  if (sourceRef.kind === 'scene') {
    const scene = project.storyboard?.scenes.find(
      (candidate) => candidate.id === sourceRef.sceneId,
    );
    const assetId = scene ? assetIdForScene(scene) : undefined;
    return assetId
      ? project.assets.find((asset) => asset.id === assetId)
      : undefined;
  }
  return undefined;
}

function assetIdForScene(scene: VideoStoryboardScene): string | undefined {
  if (
    scene.assetPlan.kind === 'existing' ||
    scene.assetPlan.kind === 'image-pan'
  ) {
    return scene.assetPlan.assetId;
  }
  return undefined;
}
