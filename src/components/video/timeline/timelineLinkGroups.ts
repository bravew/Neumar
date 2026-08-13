import type {
  VideoTimeline,
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

export interface TimelineLinkGroupStatus {
  linkGroupId: string;
  clipIds: string[];
  trackIds: string[];
  driftMs: number;
  syncLocked: boolean;
}

interface LinkedClipLocation {
  track: VideoTimelineTrack;
  clip: VideoTimelineClip;
}

const SYNC_TOLERANCE_MS = 1;

export function getSelectedLinkGroupIds(
  tracks: VideoTimelineTrack[],
  selectedClipIds: Set<string>,
): Set<string> {
  const linkGroupIds = new Set<string>();
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (selectedClipIds.has(clip.id) && clip.linkGroupId) {
        linkGroupIds.add(clip.linkGroupId);
      }
    }
  }
  return linkGroupIds;
}

export function findTimelineOutOfSyncGroups(
  timeline: VideoTimeline,
): TimelineLinkGroupStatus[] {
  return findTimelineLinkGroups(timeline).filter(
    (group) => group.driftMs > SYNC_TOLERANCE_MS,
  );
}

function findTimelineLinkGroups(
  timeline: VideoTimeline,
): TimelineLinkGroupStatus[] {
  const locationsByGroupId = new Map<string, LinkedClipLocation[]>();
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (!clip.linkGroupId) continue;
      locationsByGroupId.set(clip.linkGroupId, [
        ...(locationsByGroupId.get(clip.linkGroupId) ?? []),
        { track, clip },
      ]);
    }
  }
  return [...locationsByGroupId]
    .filter(([, locations]) => locations.length > 1)
    .map(([linkGroupId, locations]) => ({
      linkGroupId,
      clipIds: locations.map(({ clip }) => clip.id),
      trackIds: [...new Set(locations.map(({ track }) => track.id))],
      driftMs: groupDriftMs(locations.map(({ clip }) => clip)),
      syncLocked: locations.some(({ track }) => track.syncLocked === true),
    }))
    .sort(
      (a, b) =>
        b.driftMs - a.driftMs || a.linkGroupId.localeCompare(b.linkGroupId),
    );
}

function groupDriftMs(clips: VideoTimelineClip[]): number {
  const first = clips[0];
  if (!first) return 0;
  return clips.reduce(
    (maxDrift, clip) =>
      Math.max(
        maxDrift,
        Math.abs(clip.startMs - first.startMs),
        Math.abs(clip.durationMs - first.durationMs),
        Math.abs(clip.trimStartMs - first.trimStartMs),
        Math.abs(clip.trimEndMs - first.trimEndMs),
      ),
    0,
  );
}
