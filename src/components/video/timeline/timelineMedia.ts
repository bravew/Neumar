import { API_BASE_URL } from '@/config';
import type {
  VideoMediaItem,
  VideoProject,
  VideoTimelineClip,
} from '@/shared/types/video';

export function getTimelineClipMediaSrc(
  project: VideoProject,
  clip: VideoTimelineClip,
): string | undefined {
  const asset = resolveClipAsset(project, clip);
  if (!asset) return undefined;
  const variant = asset.proxy ? '?variant=proxy' : '';
  return `${API_BASE_URL}/video/projects/${encodeURIComponent(project.id)}/assets/${encodeURIComponent(asset.id)}/stream${variant}`;
}

export function resolveClipAsset(
  project: VideoProject,
  clip: VideoTimelineClip,
): VideoMediaItem | undefined {
  // Caption and effect clips carry no media of their own — they're anchored to
  // a scene for timing only (sourceRef.kind === 'scene'). Resolving the scene's
  // backing video/image here would paint that thumbnail (and its download
  // badge) onto a caption/effect clip; those should show only their own content
  // (caption text / effect icon).
  if (clip.kind === 'caption' || clip.kind === 'effect') return undefined;
  const { sourceRef } = clip;
  if (sourceRef.kind === 'asset') {
    return project.assets.find((item) => item.id === sourceRef.assetId);
  }
  // A scene-sourced clip backed by a concrete asset (existing/image-pan) shows
  // that asset — mirrors the preview resolver and backend renderer. The stream
  // endpoint hydrates referenced (cloud) assets on demand, so this also
  // surfaces and downloads not-yet-materialized picks.
  if (sourceRef.kind === 'scene') {
    const plan = project.storyboard?.scenes.find(
      (scene) => scene.id === sourceRef.sceneId,
    )?.assetPlan;
    if (plan && (plan.kind === 'existing' || plan.kind === 'image-pan')) {
      return project.assets.find((item) => item.id === plan.assetId);
    }
  }
  return undefined;
}
