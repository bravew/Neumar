import type { VideoTimelineTrack } from '@/shared/types/video';

export function findNextOpenClipStartMs(
  track: VideoTimelineTrack,
  desiredStartMs: number,
  durationMs: number,
): number {
  const spanMs = Math.max(1, Math.round(durationMs));
  let cursorMs = Math.max(0, Math.round(desiredStartMs));
  const clips = [...track.clips].sort(
    (left, right) =>
      left.startMs - right.startMs || left.id.localeCompare(right.id),
  );
  for (const clip of clips) {
    const clipEndMs = clip.startMs + clip.durationMs;
    if (clipEndMs <= cursorMs) continue;
    if (cursorMs + spanMs <= clip.startMs) return cursorMs;
    cursorMs = clipEndMs;
  }
  return cursorMs;
}
