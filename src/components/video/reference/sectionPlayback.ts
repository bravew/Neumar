import type { VideoReferenceTimelineSection } from '@/shared/types/video';

/**
 * The section the playhead is inside, or null between/outside sections.
 *
 * End-exclusive so a boundary belongs to exactly one section: at the tick where
 * one section ends and the next begins, the list must not highlight both.
 */
export function activeSectionAt(
  sections: VideoReferenceTimelineSection[],
  currentMs: number,
): VideoReferenceTimelineSection | null {
  return (
    sections.find(
      (section) => currentMs >= section.startMs && currentMs < section.endMs,
    ) ?? null
  );
}

/** Whether playback clamped to `section` has run past its end. */
export function reachedSectionEnd(
  section: VideoReferenceTimelineSection | null,
  currentMs: number,
): boolean {
  return section !== null && currentMs >= section.endMs;
}

/** Volume state after dragging the slider. Zero is a mute. */
export function volumeAfterSliderChange(next: number): {
  volume: number;
  muted: boolean;
} {
  return { volume: next, muted: next === 0 };
}

/**
 * Volume state after pressing the speaker button.
 *
 * Unmuting from a zeroed slider has to restore something audible, or the
 * button appears to do nothing.
 */
export function volumeAfterMuteToggle(
  volume: number,
  muted: boolean,
  defaultVolume: number,
): { volume: number; muted: boolean } {
  const nextMuted = !muted;
  if (!nextMuted && volume === 0)
    return { volume: defaultVolume, muted: false };
  return { volume, muted: nextMuted };
}
