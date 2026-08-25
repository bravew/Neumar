import { describe, expect, it } from 'vitest';

import { compareTimelineRows } from '@/components/video/timeline/projectTimeline';
import { resolveTrackDropZone } from '@/components/video/timeline/timelineNewTrackDrop';
import { insertTrackRelativeTo } from '@/components/video/timeline/timelineTrackInsertion';
import type { VideoTimelineTrack } from '@/shared/types/video';

function track(
  id: string,
  kind: VideoTimelineTrack['kind'],
  order: number,
): VideoTimelineTrack {
  return {
    id,
    kind,
    name: id,
    muted: false,
    locked: false,
    order,
    clips: [],
  } as VideoTimelineTrack;
}

/** The ids in the order the timeline actually draws them, top to bottom. */
function rowOrder(tracks: VideoTimelineTrack[]): string[] {
  return [...tracks].sort(compareTimelineRows).map((item) => item.id);
}

describe('resolveTrackDropZone', () => {
  const rect = { top: 100, height: 60 };

  it('treats the edges as insertion points and the middle as the lane', () => {
    expect(resolveTrackDropZone(102, rect)).toBe('above');
    expect(resolveTrackDropZone(130, rect)).toBe('lane');
    expect(resolveTrackDropZone(157, rect)).toBe('below');
  });

  it('keeps a short lane droppable instead of becoming all edge', () => {
    // A 20px lane with a flat 9px band would leave only 2px of "lane".
    const short = { top: 0, height: 20 };
    expect(resolveTrackDropZone(10, short)).toBe('lane');
    expect(resolveTrackDropZone(1, short)).toBe('above');
    expect(resolveTrackDropZone(19, short)).toBe('below');
  });
});

describe('insertTrackRelativeTo', () => {
  it('places a visual track above its anchor', () => {
    const tracks = [track('v1', 'video', 10), track('v2', 'video', 20)];
    // Visual rows sort descending, so v2 draws above v1.
    expect(rowOrder(tracks)).toEqual(['v2', 'v1']);

    const next = insertTrackRelativeTo(
      tracks,
      track('new', 'video', 0),
      'v1',
      'above',
    );
    expect(rowOrder(next)).toEqual(['v2', 'new', 'v1']);
  });

  it('places a visual track below its anchor', () => {
    const tracks = [track('v1', 'video', 10), track('v2', 'video', 20)];
    const next = insertTrackRelativeTo(
      tracks,
      track('new', 'video', 0),
      'v2',
      'below',
    );
    expect(rowOrder(next)).toEqual(['v2', 'new', 'v1']);
  });

  it('inserts audio the other way round, since audio rows sort ascending', () => {
    const tracks = [track('a1', 'audio-sfx', 10), track('a2', 'audio-sfx', 20)];
    expect(rowOrder(tracks)).toEqual(['a1', 'a2']);

    const next = insertTrackRelativeTo(
      tracks,
      track('new', 'audio-sfx', 0),
      'a1',
      'below',
    );
    expect(rowOrder(next)).toEqual(['a1', 'new', 'a2']);
  });

  it('leaves other families alone', () => {
    const tracks = [
      track('cap', 'caption', 10),
      track('v1', 'video', 10),
      track('a1', 'audio-sfx', 10),
    ];
    const next = insertTrackRelativeTo(
      tracks,
      track('new', 'video', 0),
      'v1',
      'above',
    );
    expect(next.find((item) => item.id === 'cap')?.order).toBe(10);
    expect(next.find((item) => item.id === 'a1')?.order).toBe(10);
    expect(rowOrder(next)).toEqual(['cap', 'new', 'v1', 'a1']);
  });

  it('appends to the family when there is no anchor', () => {
    const tracks = [track('v1', 'video', 10), track('v2', 'video', 20)];
    const next = insertTrackRelativeTo(
      tracks,
      track('new', 'video', 0),
      null,
      'below',
    );
    expect(rowOrder(next)).toEqual(['v2', 'v1', 'new']);
  });

  it('survives repeated insertion without orders colliding', () => {
    let tracks = [track('v1', 'video', 10)];
    for (let index = 0; index < 6; index += 1) {
      tracks = insertTrackRelativeTo(
        tracks,
        track(`n${index}`, 'video', 0),
        'v1',
        'above',
      );
    }
    const orders = tracks.map((item) => item.order);
    expect(new Set(orders).size).toBe(orders.length);
    expect(rowOrder(tracks)).toEqual([
      'n0',
      'n1',
      'n2',
      'n3',
      'n4',
      'n5',
      'v1',
    ]);
  });
});
