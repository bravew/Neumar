import type {
  VideoTimeline,
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';

import { getTimelineDurationMs } from './timelineMath';

export const TIMELINE_CLIPBOARD_PREFIX = 'neuma-clipboard:v1:';

export interface TimelineClipboardItem {
  trackId: string;
  trackKind: VideoTimelineTrack['kind'];
  offsetMs: number;
  clip: VideoTimelineClip;
}

export interface TimelineClipboardPayload {
  schema: 'neuma.timeline.clipboard.v1';
  copiedAt: string;
  clips: TimelineClipboardItem[];
}

let inMemoryClipboard: TimelineClipboardPayload | null = null;

export function getInMemoryTimelineClipboard(): TimelineClipboardPayload | null {
  return inMemoryClipboard;
}

export function setInMemoryTimelineClipboard(
  payload: TimelineClipboardPayload,
): void {
  inMemoryClipboard = payload;
}

export function encodeTimelineClipboardPayload(
  payload: TimelineClipboardPayload,
): string {
  return `${TIMELINE_CLIPBOARD_PREFIX}${JSON.stringify(payload)}`;
}

export function decodeTimelineClipboardPayload(
  value: string,
): TimelineClipboardPayload | null {
  if (!value.startsWith(TIMELINE_CLIPBOARD_PREFIX)) return null;
  try {
    const payload = JSON.parse(
      value.slice(TIMELINE_CLIPBOARD_PREFIX.length),
    ) as TimelineClipboardPayload;
    return payload.schema === 'neuma.timeline.clipboard.v1' &&
      Array.isArray(payload.clips)
      ? payload
      : null;
  } catch {
    return null;
  }
}

export function buildTimelineClipboardPayload(
  timeline: VideoTimeline,
  selectedClipIds: Set<string>,
): TimelineClipboardPayload | null {
  const clips = timeline.tracks
    .flatMap((track) =>
      track.clips
        .filter((clip) => selectedClipIds.has(clip.id))
        .map((clip) => ({ clip, track })),
    )
    .sort(
      (a, b) =>
        a.clip.startMs - b.clip.startMs ||
        a.track.order - b.track.order ||
        a.clip.id.localeCompare(b.clip.id),
    );
  if (clips.length === 0) return null;
  const firstStartMs = clips[0]!.clip.startMs;
  return {
    schema: 'neuma.timeline.clipboard.v1',
    copiedAt: new Date().toISOString(),
    clips: clips.map(({ clip, track }) => ({
      trackId: track.id,
      trackKind: track.kind,
      offsetMs: clip.startMs - firstStartMs,
      clip: cloneTimelineClip(clip),
    })),
  };
}

export function pasteTimelineClipboardPayload(input: {
  timeline: VideoTimeline;
  payload: TimelineClipboardPayload;
  startMs: number;
}): { timeline: VideoTimeline; insertedClipIds: string[] } | null {
  const insertedClipIds: string[] = [];
  const insertionsByTrackId = new Map<string, VideoTimelineClip[]>();
  const linkGroupIds = remappedClipboardLinkGroups(input.payload);
  for (const item of input.payload.clips) {
    const targetTrack = findPasteTargetTrack(input.timeline.tracks, item);
    if (!targetTrack) continue;
    const linkGroupId = item.clip.linkGroupId
      ? linkGroupIds.get(item.clip.linkGroupId)
      : undefined;
    const clip = {
      ...cloneTimelineClip(item.clip),
      id: `clip-${randomUUID()}`,
      startMs: Math.max(0, Math.round(input.startMs + item.offsetMs)),
      ...(linkGroupId ? { linkGroupId } : {}),
    } as VideoTimelineClip;
    insertedClipIds.push(clip.id);
    insertionsByTrackId.set(targetTrack.id, [
      ...(insertionsByTrackId.get(targetTrack.id) ?? []),
      clip,
    ]);
  }
  if (insertedClipIds.length === 0) return null;

  const tracks = input.timeline.tracks.map((track) => {
    const insertions = insertionsByTrackId.get(track.id);
    return insertions
      ? ({
          ...track,
          clips: [...track.clips, ...insertions],
        } as VideoTimelineTrack)
      : track;
  });
  return {
    timeline: {
      ...input.timeline,
      tracks,
      durationMs: getTimelineDurationMs(tracks),
    },
    insertedClipIds,
  };
}

function remappedClipboardLinkGroups(
  payload: TimelineClipboardPayload,
): Map<string, string | undefined> {
  const counts = new Map<string, number>();
  for (const { clip } of payload.clips) {
    if (!clip.linkGroupId) continue;
    counts.set(clip.linkGroupId, (counts.get(clip.linkGroupId) ?? 0) + 1);
  }
  const result = new Map<string, string | undefined>();
  for (const [linkGroupId, count] of counts) {
    result.set(linkGroupId, count > 1 ? `link-${randomUUID()}` : undefined);
  }
  return result;
}

function findPasteTargetTrack(
  tracks: VideoTimelineTrack[],
  item: TimelineClipboardItem,
): VideoTimelineTrack | undefined {
  const originalTrack = tracks.find((track) => track.id === item.trackId);
  if (
    originalTrack &&
    !originalTrack.locked &&
    timelineTrackAcceptsClip(originalTrack, item.clip)
  ) {
    return originalTrack;
  }
  return tracks.find(
    (track) =>
      !track.locked &&
      track.kind === item.trackKind &&
      timelineTrackAcceptsClip(track, item.clip),
  );
}

function cloneTimelineClip(clip: VideoTimelineClip): VideoTimelineClip {
  return structuredClone(clip);
}

function timelineTrackAcceptsClip(
  track: VideoTimelineTrack,
  clip: VideoTimelineClip,
): boolean {
  if (
    track.kind === 'video' ||
    track.kind === 'broll' ||
    track.kind === 'overlay'
  ) {
    if (track.kind === 'overlay' && clip.kind === 'effect') return true;
    return (
      clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
    );
  }
  if (
    track.kind === 'audio-vo' ||
    track.kind === 'audio-music' ||
    track.kind === 'audio-sfx'
  ) {
    return clip.kind === 'audio';
  }
  return track.kind === 'caption' && clip.kind === 'caption';
}
