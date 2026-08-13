import type {
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

export function findSceneIdAtPlayhead(
  tracks: VideoTimelineTrack[],
  playheadMs: number,
): string | null {
  const timeMs = Math.max(0, Math.round(playheadMs));
  const candidates = tracks.flatMap((track, trackIndex) =>
    track.clips
      .filter((clip) => clip.sceneId && containsTime(clip, timeMs))
      .map((clip) => ({
        clip,
        trackPriority: getTrackScenePriority(track, trackIndex),
      })),
  );
  candidates.sort((a, b) => {
    const startDelta = b.clip.startMs - a.clip.startMs;
    if (startDelta !== 0) return startDelta;
    const durationDelta = a.clip.durationMs - b.clip.durationMs;
    if (durationDelta !== 0) return durationDelta;
    return a.trackPriority - b.trackPriority;
  });
  return candidates[0]?.clip.sceneId ?? null;
}

function containsTime(clip: VideoTimelineClip, timeMs: number): boolean {
  const startMs = Math.max(0, clip.startMs);
  const endMs = startMs + Math.max(1, clip.durationMs);
  return timeMs >= startMs && timeMs < endMs;
}

function getTrackScenePriority(
  track: VideoTimelineTrack,
  trackIndex: number,
): number {
  if (track.kind === 'video') return trackIndex;
  if (track.kind === 'broll') return 100 + trackIndex;
  if (track.kind === 'overlay') return 200 + trackIndex;
  if (track.kind === 'caption') return 300 + trackIndex;
  return 400 + trackIndex;
}
