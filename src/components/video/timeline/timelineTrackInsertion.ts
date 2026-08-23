import type { VideoTimelineTrack } from '@/shared/types/video';

import { compareTimelineRows } from './projectTimeline';

/** Gap between adjacent `order` values after a renumber. */
const ORDER_STEP = 10;

export type TrackInsertSide = 'above' | 'below';

function isVisualKind(kind: VideoTimelineTrack['kind']): boolean {
  return kind === 'video' || kind === 'broll' || kind === 'overlay';
}

/**
 * Rows are grouped caption → visual → audio, and only tracks in the same group
 * can be interleaved. Two tracks share a family when they'd sort against each
 * other by `order` rather than by group.
 */
function trackFamily(kind: VideoTimelineTrack['kind']): 0 | 1 | 2 {
  if (kind === 'caption') return 0;
  return isVisualKind(kind) ? 1 : 2;
}

/**
 * Places `newTrack` directly above or below `anchorTrackId` in the row list.
 *
 * Row position is derived from `order`, not from array position — and the two
 * families read it in opposite directions: captions and visual tracks sort
 * descending (a higher `order` draws higher up), audio ascending. Rather than
 * trying to find a free value between two neighbours, this renumbers the whole
 * family from the sequence the user asked for, which cannot collide and cannot
 * drift however many times a track is inserted.
 */
export function insertTrackRelativeTo(
  tracks: VideoTimelineTrack[],
  newTrack: VideoTimelineTrack,
  anchorTrackId: string | null,
  side: TrackInsertSide,
): VideoTimelineTrack[] {
  const family = trackFamily(newTrack.kind);
  const inFamily = tracks
    .filter((track) => trackFamily(track.kind) === family)
    .sort(compareTimelineRows);

  const anchorIndex = anchorTrackId
    ? inFamily.findIndex((track) => track.id === anchorTrackId)
    : -1;
  const insertAt =
    anchorIndex === -1
      ? inFamily.length
      : side === 'above'
        ? anchorIndex
        : anchorIndex + 1;

  const sequence = [...inFamily];
  sequence.splice(insertAt, 0, newTrack);

  // Descending for caption/visual so index 0 ends up on top; ascending for
  // audio, which reads the other way.
  const descending = family !== 2;
  const orderById = new Map(
    sequence.map((track, index) => [
      track.id,
      descending
        ? (sequence.length - index) * ORDER_STEP
        : (index + 1) * ORDER_STEP,
    ]),
  );

  const rest = tracks.filter((track) => trackFamily(track.kind) !== family);
  const renumbered = sequence.map((track) => {
    const order = orderById.get(track.id);
    return order === undefined || order === track.order
      ? track
      : { ...track, order };
  });
  return [...rest, ...renumbered];
}
