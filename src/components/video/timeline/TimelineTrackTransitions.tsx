import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';

import {
  isVisualTimelineTrack,
  normalizeVideoTransition,
  type VideoTimelineClip,
  type VideoTimelineTrack,
  type VideoTransitionKind,
  type VideoVisualTimelineClip,
} from '@/shared/types/video';

import {
  hasTransitionDragType,
  readTransitionDrag,
} from '../transitions/transitionDragPayload';
import type { TimelineTrackLabels } from './TimelineLabels';
import { pixelsToMs } from './timelineMath';
import { TimelineTransitionBadge } from './TimelineTransitionBadge';
import { resolveTimelineTransitionDropTarget } from './timelineTransitionDropTarget';
import {
  deriveTimelineTransitionSeams,
  type TimelineTransitionSeam,
  type TimelineTransitionSeamBlockedReason,
} from './timelineTransitions';
import { useTimelineEditorStore } from './useTimelineEditorStore';

interface UseTimelineTrackTransitionsInput {
  enabled: boolean;
  track: VideoTimelineTrack;
  clips: readonly VideoTimelineClip[];
  fps: number;
  pixelsPerSecond: number;
  labels: TimelineTrackLabels;
}

export function useTimelineTrackTransitions({
  enabled,
  track,
  clips,
  fps,
  pixelsPerSecond,
  labels,
}: UseTimelineTrackTransitionsInput) {
  const setTransitionOnSeam = useTimelineEditorStore(
    (state) => state.setTransitionOnSeam,
  );
  const [dragOverSeamId, setDragOverSeamId] = useState<string | null>(null);
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const noticeTimeoutRef = useRef<number | null>(null);
  const transitionSeams = useMemo(
    () =>
      enabled && isVisualTimelineTrack(track)
        ? deriveTimelineTransitionSeams([track], fps)
        : [],
    [enabled, fps, track],
  );
  const visualClips = useMemo(
    () =>
      isVisualTimelineTrack(track) ? (clips as VideoVisualTimelineClip[]) : [],
    [clips, track],
  );
  const showDropNotice = useCallback((notice: string) => {
    setDropNotice(notice);
    if (noticeTimeoutRef.current !== null) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
    noticeTimeoutRef.current = window.setTimeout(() => {
      setDropNotice(null);
      noticeTimeoutRef.current = null;
    }, 1800);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimeoutRef.current !== null) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    },
    [],
  );
  const resolveDropTargetFromEvent = useCallback(
    (event: DragEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const pointerMs = pixelsToMs(event.clientX - rect.left, pixelsPerSecond);
      return resolveTimelineTransitionDropTarget({
        clips: visualClips,
        seams: transitionSeams,
        pointerMs,
        pixelsPerSecond,
      });
    },
    [pixelsPerSecond, transitionSeams, visualClips],
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLElement>): boolean => {
      if (!enabled || !hasTransitionDragType(event.dataTransfer)) return false;
      event.preventDefault();
      const target = isVisualTimelineTrack(track)
        ? resolveDropTargetFromEvent(event)
        : null;
      setDragOverSeamId((current) =>
        current === target?.seamId ? current : (target?.seamId ?? null),
      );
      event.dataTransfer.dropEffect = target?.canAcceptTransition
        ? 'copy'
        : 'none';
      return true;
    },
    [enabled, resolveDropTargetFromEvent, track],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setDragOverSeamId(null);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>): boolean => {
      const transitionPayload = enabled
        ? readTransitionDrag(event.dataTransfer)
        : null;
      if (!transitionPayload) return false;
      event.preventDefault();
      setDragOverSeamId(null);
      const target = isVisualTimelineTrack(track)
        ? resolveDropTargetFromEvent(event)
        : null;
      if (!target) {
        showDropNotice(labels.transitionDropNoAdjacent);
        return true;
      }
      if (!target.canAcceptTransition) {
        showDropNotice(
          transitionDropBlockedReasonLabel(target.blockedReason, labels),
        );
        return true;
      }
      setTransitionOnSeam(target.seamId, transitionPayload);
      return true;
    },
    [
      enabled,
      labels,
      resolveDropTargetFromEvent,
      setTransitionOnSeam,
      showDropNotice,
      track,
    ],
  );

  return {
    dragOverSeamId,
    dropNotice,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    transitionSeams,
  };
}

interface TimelineTrackTransitionsProps {
  fps: number;
  labels: TimelineTrackLabels;
  pixelsPerSecond: number;
  seams: readonly TimelineTransitionSeam[];
  trackId: string;
  dragOverSeamId: string | null;
  onSelectTrack: (trackId: string) => void;
}

export function TimelineTrackTransitions({
  fps,
  labels,
  pixelsPerSecond,
  seams,
  trackId,
  dragOverSeamId,
  onSelectTrack,
}: TimelineTrackTransitionsProps) {
  const selectedSeamId = useTimelineEditorStore(
    (state) => state.selectedSeamId,
  );
  const selectSeam = useTimelineEditorStore((state) => state.selectSeam);
  const setTransitionOnSeam = useTimelineEditorStore(
    (state) => state.setTransitionOnSeam,
  );
  const removeTransitionFromSeam = useTimelineEditorStore(
    (state) => state.removeTransitionFromSeam,
  );

  return (
    <>
      {seams.map((seam) => {
        const ghost = dragOverSeamId === seam.seamId;
        if (!seam.transition && !ghost) return null;
        const label = seam.transition
          ? transitionLabelForKind(
              normalizeVideoTransition(seam.transition).kind,
              labels.transitionNames,
            )
          : labels.transitionDropHere;
        return (
          <TimelineTransitionBadge
            key={`${seam.seamId}${ghost ? ':ghost' : ''}`}
            seam={seam}
            pixelsPerSecond={pixelsPerSecond}
            fps={fps}
            label={label}
            labels={{
              ariaLabel: labels.transitionBadgeAriaLabel,
              dropHere: labels.transitionDropHere,
              resizeLabel: labels.transitionResize,
            }}
            selected={selectedSeamId === seam.seamId}
            ghost={ghost && !seam.transition}
            onSelect={(seamId) => {
              onSelectTrack(trackId);
              selectSeam(seamId);
            }}
            onRemove={removeTransitionFromSeam}
            onDropTransition={setTransitionOnSeam}
            onResizeTransition={(seamId, durationMs) => {
              const target = seams.find(
                (candidate) => candidate.seamId === seamId,
              );
              if (!target?.transition) return;
              const transition = normalizeVideoTransition(target.transition);
              setTransitionOnSeam(seamId, {
                kind: transition.kind,
                durationMs,
                ...(transition.direction
                  ? { direction: transition.direction }
                  : {}),
                ...(transition.params ? { params: transition.params } : {}),
                ...(transition.timing ? { timing: transition.timing } : {}),
              });
            }}
          />
        );
      })}
    </>
  );
}

function transitionLabelForKind(
  kind: VideoTransitionKind,
  labels: Record<VideoTransitionKind, string>,
): string {
  return labels[kind] ?? kind;
}

function transitionDropBlockedReasonLabel(
  reason: TimelineTransitionSeamBlockedReason | undefined,
  labels: TimelineTrackLabels,
): string {
  if (reason === 'gap') return labels.transitionDropGap;
  if (reason === 'locked-track') return labels.transitionDropLocked;
  if (reason === 'too-short') return labels.transitionDropTooShort;
  return labels.transitionDropNoAdjacent;
}
