import {
  isVisualTimelineClip,
  isVisualTimelineTrack,
  type VideoTimeline,
  type VideoVisualTimelineClip,
  type VideoVisualTimelineTrack,
} from '@/shared/types/video';

import {
  deriveTimelineTransitionSeams,
  type TimelineTransitionSeam,
} from '../timeline/timelineTransitions';

export interface TimelineTransitionSeamContext {
  seam: TimelineTransitionSeam;
  track: VideoVisualTimelineTrack;
  fromClip: VideoVisualTimelineClip;
  toClip: VideoVisualTimelineClip;
}

export interface ClipTransitionSeamContexts {
  incoming: TimelineTransitionSeamContext | null;
  outgoing: TimelineTransitionSeamContext | null;
}

export function findTimelineTransitionSeamContext(
  timeline: VideoTimeline,
  seamId: string,
): TimelineTransitionSeamContext | null {
  for (const track of timeline.tracks) {
    if (!isVisualTimelineTrack(track)) continue;
    const seam = deriveTimelineTransitionSeams([track], timeline.fps).find(
      (candidate) => candidate.seamId === seamId,
    );
    if (!seam) continue;
    const visualClips = track.clips.filter(isVisualTimelineClip);
    const fromClip = visualClips.find((clip) => clip.id === seam.fromClipId);
    const toClip = visualClips.find((clip) => clip.id === seam.toClipId);
    if (!fromClip || !toClip) return null;
    return { seam, track, fromClip, toClip };
  }
  return null;
}

export function findClipTransitionSeamContexts(
  timeline: VideoTimeline,
  clipId: string,
): ClipTransitionSeamContexts {
  let incoming: TimelineTransitionSeamContext | null = null;
  let outgoing: TimelineTransitionSeamContext | null = null;
  for (const track of timeline.tracks) {
    if (!isVisualTimelineTrack(track)) continue;
    const seams = deriveTimelineTransitionSeams([track], timeline.fps);
    const visualClips = track.clips.filter(isVisualTimelineClip);
    for (const seam of seams) {
      if (seam.fromClipId !== clipId && seam.toClipId !== clipId) continue;
      const fromClip = visualClips.find((clip) => clip.id === seam.fromClipId);
      const toClip = visualClips.find((clip) => clip.id === seam.toClipId);
      if (!fromClip || !toClip) continue;
      const context = { seam, track, fromClip, toClip };
      if (seam.toClipId === clipId) incoming = context;
      if (seam.fromClipId === clipId) outgoing = context;
    }
  }
  return { incoming, outgoing };
}
