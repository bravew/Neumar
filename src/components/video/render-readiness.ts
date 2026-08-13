import type { VideoProject } from '@/shared/types/video';

export function hasRenderableTimeline(
  project: Pick<VideoProject, 'timeline'>,
): boolean {
  return (
    project.timeline?.tracks.some((track) => (track.clips?.length ?? 0) > 0) ??
    false
  );
}

export function canRenderProject(
  project: Pick<VideoProject, 'timeline'>,
  storyboardApproved: boolean,
): boolean {
  return storyboardApproved || hasRenderableTimeline(project);
}
