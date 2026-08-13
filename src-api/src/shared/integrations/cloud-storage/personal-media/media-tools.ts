import type { CloudFile, MediaMetadata } from '../types';

export interface MediaToolItem {
  id: string;
  name?: string;
  mediaMetadata?: MediaMetadata;
}

export interface MediaEventCluster {
  id: string;
  startAt?: string;
  endAt?: string;
  itemIds: string[];
  coverItemId: string;
  people: Array<{ id: string; name?: string; count: number }>;
}

export interface MediaPersonSummary {
  id: string;
  name?: string;
  count: number;
  itemIds: string[];
}

export function clusterMediaByEvent(
  items: MediaToolItem[],
  options: { maxGapHours?: number; maxDistanceKm?: number } = {},
): MediaEventCluster[] {
  const maxGapMs = (options.maxGapHours ?? 6) * 60 * 60 * 1000;
  const maxDistanceKm = options.maxDistanceKm ?? 50;
  const sorted = items
    .filter((item) => item.mediaMetadata?.takenAt)
    .sort(
      (a, b) =>
        Date.parse(a.mediaMetadata?.takenAt ?? '') -
        Date.parse(b.mediaMetadata?.takenAt ?? ''),
    );

  const clusters: MediaToolItem[][] = [];
  for (const item of sorted) {
    const lastCluster = clusters.at(-1);
    const lastItem = lastCluster?.at(-1);
    if (!lastCluster || !lastItem) {
      clusters.push([item]);
      continue;
    }

    if (
      belongsToCluster(item.mediaMetadata, lastItem.mediaMetadata, {
        maxGapMs,
        maxDistanceKm,
      })
    ) {
      lastCluster.push(item);
    } else {
      clusters.push([item]);
    }
  }

  return clusters.map((cluster, index) => toEventCluster(cluster, index));
}

export function getPeopleFromMedia(
  items: MediaToolItem[],
): MediaPersonSummary[] {
  const people = new Map<string, MediaPersonSummary>();
  for (const item of items) {
    for (const person of item.mediaMetadata?.people ?? []) {
      const existing = people.get(person.id) ?? {
        id: person.id,
        name: person.name,
        count: 0,
        itemIds: [],
      };
      existing.count += 1;
      existing.itemIds.push(item.id);
      existing.name = existing.name ?? person.name;
      people.set(person.id, existing);
    }
  }

  return Array.from(people.values()).sort((a, b) => b.count - a.count);
}

export function cloudFileToMediaToolItem(file: CloudFile): MediaToolItem {
  return {
    id: file.id,
    name: file.name,
    mediaMetadata: file.mediaMetadata,
  };
}

function belongsToCluster(
  item: MediaMetadata | undefined,
  previous: MediaMetadata | undefined,
  options: { maxGapMs: number; maxDistanceKm: number },
): boolean {
  const itemTime = Date.parse(item?.takenAt ?? '');
  const previousTime = Date.parse(previous?.takenAt ?? '');
  if (!Number.isFinite(itemTime) || !Number.isFinite(previousTime)) {
    return false;
  }
  if (itemTime - previousTime > options.maxGapMs) {
    return false;
  }

  if (item?.geo && previous?.geo) {
    return distanceKm(item.geo, previous.geo) <= options.maxDistanceKm;
  }
  return true;
}

function toEventCluster(
  cluster: MediaToolItem[],
  index: number,
): MediaEventCluster {
  const itemIds = cluster.map((item) => item.id);
  const takenTimes = cluster
    .map((item) => item.mediaMetadata?.takenAt)
    .filter((value): value is string => typeof value === 'string');

  return {
    id: `event-${index + 1}`,
    startAt: takenTimes[0],
    endAt: takenTimes.at(-1),
    itemIds,
    coverItemId: cluster[0]?.id ?? itemIds[0] ?? '',
    people: getPeopleFromMedia(cluster).map(({ id, name, count }) => ({
      id,
      name,
      count,
    })),
  };
}

function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const radiusKm = 6371;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return (
    radiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
