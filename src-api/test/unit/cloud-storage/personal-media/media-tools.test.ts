import { describe, expect, it } from 'vitest';

import {
  clusterMediaByEvent,
  getPeopleFromMedia,
  type MediaToolItem,
} from '@/shared/integrations/cloud-storage/personal-media/media-tools';

const items: MediaToolItem[] = [
  {
    id: 'a',
    mediaMetadata: {
      takenAt: '2026-05-04T10:00:00.000Z',
      geo: { latitude: 40.7128, longitude: -74.006 },
      people: [{ id: 'p1', name: 'Ava' }],
    },
  },
  {
    id: 'b',
    mediaMetadata: {
      takenAt: '2026-05-04T12:00:00.000Z',
      geo: { latitude: 40.713, longitude: -74.0062 },
      people: [
        { id: 'p1', name: 'Ava' },
        { id: 'p2', name: 'Noah' },
      ],
    },
  },
  {
    id: 'c',
    mediaMetadata: {
      takenAt: '2026-05-05T12:00:00.000Z',
      geo: { latitude: 34.0522, longitude: -118.2437 },
      people: [{ id: 'p2', name: 'Noah' }],
    },
  },
];

describe('personal media tools', () => {
  it('clusters media by event using time and location proximity', () => {
    const clusters = clusterMediaByEvent(items, {
      maxGapHours: 6,
      maxDistanceKm: 10,
    });

    expect(clusters).toEqual([
      expect.objectContaining({
        id: 'event-1',
        itemIds: ['a', 'b'],
        coverItemId: 'a',
        people: [
          { id: 'p1', name: 'Ava', count: 2 },
          { id: 'p2', name: 'Noah', count: 1 },
        ],
      }),
      expect.objectContaining({
        id: 'event-2',
        itemIds: ['c'],
      }),
    ]);
  });

  it('summarizes people across media items', () => {
    expect(getPeopleFromMedia(items)).toEqual([
      { id: 'p1', name: 'Ava', count: 2, itemIds: ['a', 'b'] },
      { id: 'p2', name: 'Noah', count: 2, itemIds: ['b', 'c'] },
    ]);
  });
});
