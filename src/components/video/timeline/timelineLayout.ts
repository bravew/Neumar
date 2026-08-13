import type { VideoTimelineTrack } from '@/shared/types/video';

import type { TimelineClientPoint } from './timelineClipDrag';

export const TRACK_HEADER_WIDTH = 144;
export const RULER_HEIGHT = 32;
export const EXTRA_TIMELINE_WIDTH = 240;

export function getTimelineTrackHeight(
  track: VideoTimelineTrack | undefined,
): number {
  if (!track) return 56;
  if (track.kind === 'caption') return 44;
  if (
    track.kind === 'audio-vo' ||
    track.kind === 'audio-music' ||
    track.kind === 'audio-sfx'
  ) {
    return 56;
  }
  return 64;
}

export function getTimelineTrackIdAtClientY({
  tracks,
  clientY,
  scrollElement,
}: {
  tracks: VideoTimelineTrack[];
  clientY: number;
  scrollElement: HTMLDivElement | null;
}): string | null {
  if (!scrollElement) return null;
  const rect = scrollElement.getBoundingClientRect();
  const localY = clientY - rect.top + scrollElement.scrollTop;
  let trackTop = RULER_HEIGHT;
  for (const track of tracks) {
    const trackHeight = getTimelineTrackHeight(track);
    if (localY >= trackTop && localY < trackTop + trackHeight) {
      return track.id;
    }
    trackTop += trackHeight;
  }
  return null;
}

export function getTimelineTrackIdAtPoint({
  tracks,
  point,
  scrollElement,
}: {
  tracks: VideoTimelineTrack[];
  point: TimelineClientPoint;
  scrollElement: HTMLDivElement | null;
}): string | null {
  if (!scrollElement) return null;
  const rect = scrollElement.getBoundingClientRect();
  const isInsideScrollElement =
    point.clientX >= rect.left &&
    point.clientX <= rect.right &&
    point.clientY >= rect.top &&
    point.clientY <= rect.bottom;
  if (!isInsideScrollElement) return null;
  const trackIdFromDom = getTimelineTrackIdFromDomPoint(point, scrollElement);
  if (trackIdFromDom) return trackIdFromDom;
  return getTimelineTrackIdAtClientY({
    tracks,
    clientY: point.clientY,
    scrollElement,
  });
}

function getTimelineTrackIdFromDomPoint(
  point: TimelineClientPoint,
  scrollElement: HTMLDivElement,
): string | null {
  if (typeof document === 'undefined') return null;
  const hit = document.elementFromPoint(point.clientX, point.clientY);
  if (!hit) return null;
  const trackElement = hit.closest<HTMLElement>('[data-timeline-track-id]');
  if (!trackElement || !scrollElement.contains(trackElement)) return null;
  return trackElement.dataset.timelineTrackId ?? null;
}
