import type { VideoProject } from '@/shared/types/video';

export function hasRenderableTimeline(
  project: Pick<VideoProject, 'timeline'>,
): boolean {
  return (
    project.timeline?.tracks.some((track) => (track.clips?.length ?? 0) > 0) ??
    false
  );
}

export type RenderBlockedReason = 'storyboard-not-approved' | null;

/**
 * Why the server would refuse this render, or null when it would accept it.
 *
 * The API's `renderProject` gate is exactly one condition: the storyboard must
 * be `approved`. A populated timeline is not an alternative route — approval
 * is what rebuilds the timeline in the first place — so offering the button on
 * that basis only flips the status to running and back with nothing to show.
 */
export function renderBlockedReason(
  _project: Pick<VideoProject, 'timeline'>,
  storyboardApproved: boolean,
): RenderBlockedReason {
  return storyboardApproved ? null : 'storyboard-not-approved';
}

export function canRenderProject(
  project: Pick<VideoProject, 'timeline'>,
  storyboardApproved: boolean,
): boolean {
  return renderBlockedReason(project, storyboardApproved) === null;
}
