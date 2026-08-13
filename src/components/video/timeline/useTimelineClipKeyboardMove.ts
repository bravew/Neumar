import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import type { VideoTimelineClip } from '@/shared/types/video';

import type { TimelineClipLabels } from './TimelineLabels';

const KEYBOARD_NUDGE_MS = 100;
const KEYBOARD_NUDGE_LARGE_MS = 1000;
const KEYBOARD_NUDGE_SHORTCUTS = 'Alt+ArrowLeft Alt+ArrowRight';
const ANNOUNCEMENT_CLEAR_DELAY_MS = 1500;

interface UseTimelineClipKeyboardMoveInput {
  clip: VideoTimelineClip;
  label: string;
  labels: TimelineClipLabels;
  moveDisabled: boolean;
  onMoveClip: (
    clipId: string,
    deltaMs: number,
    baselineClip: VideoTimelineClip,
  ) => void;
  onSelect: (clip: VideoTimelineClip) => void;
}

export function useTimelineClipKeyboardMove({
  clip,
  label,
  labels,
  moveDisabled,
  onMoveClip,
  onSelect,
}: UseTimelineClipKeyboardMoveInput) {
  const [announcement, setAnnouncement] = useState('');
  const announcementClearTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const ariaLabel = moveDisabled
    ? label
    : `${label}. ${labels.keyboardMoveHint}`;
  const ariaKeyShortcuts = moveDisabled ? undefined : KEYBOARD_NUDGE_SHORTCUTS;

  const announceMove = useCallback((message: string) => {
    if (announcementClearTimeoutRef.current) {
      clearTimeout(announcementClearTimeoutRef.current);
    }
    setAnnouncement(message);
    announcementClearTimeoutRef.current = setTimeout(() => {
      setAnnouncement('');
      announcementClearTimeoutRef.current = null;
    }, ANNOUNCEMENT_CLEAR_DELAY_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (announcementClearTimeoutRef.current) {
        clearTimeout(announcementClearTimeoutRef.current);
      }
    };
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        event.altKey &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ) {
        if (moveDisabled) return;
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const deltaMs =
          direction *
          (event.shiftKey ? KEYBOARD_NUDGE_LARGE_MS : KEYBOARD_NUDGE_MS);
        onSelect(clip);
        onMoveClip(clip.id, deltaMs, clip);
        announceMove(
          labels.keyboardMoveAnnouncement
            .replace('{name}', label)
            .replace(
              '{time}',
              formatKeyboardTimelineTime(clip.startMs + deltaMs),
            ),
        );
        return;
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(clip);
      }
    },
    [
      announceMove,
      clip,
      label,
      labels.keyboardMoveAnnouncement,
      moveDisabled,
      onMoveClip,
      onSelect,
    ],
  );

  return { announcement, ariaKeyShortcuts, ariaLabel, handleKeyDown };
}

function formatKeyboardTimelineTime(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}
