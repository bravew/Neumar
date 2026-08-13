import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react';

import type { VideoTimelineTrack } from '@/shared/types/video';

import { RULER_HEIGHT, TRACK_HEADER_WIDTH } from './timelineLayout';
import { msToPixels } from './timelineMath';

const LASSO_DRAG_THRESHOLD_PX = 4;
const CLIP_VERTICAL_INSET_PX = 4;
const MIN_CLIP_WIDTH_PX = 24;

export interface TimelineLassoRow {
  index: number;
  start: number;
  size: number;
}

export interface TimelineLassoRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TimelineLassoCandidate {
  clipId: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface TimelineLassoSelectionOptions {
  rows: TimelineLassoRow[];
  tracks: VideoTimelineTrack[];
  pixelsPerSecond: number;
  onSelectTrack: (trackId: string) => void;
  onSelectClips: (clipIds: Iterable<string>) => void;
}

interface TimelineLassoDrag {
  pointerId: number;
  startX: number;
  startY: number;
  hasMoved: boolean;
}

export function useTimelineLassoSelection({
  rows,
  tracks,
  pixelsPerSecond,
  onSelectTrack,
  onSelectClips,
}: TimelineLassoSelectionOptions) {
  const dragRef = useRef<TimelineLassoDrag | null>(null);
  const [rect, setRect] = useState<TimelineLassoRect | null>(null);
  const candidates = useMemo(
    () => buildTimelineLassoCandidates({ rows, tracks, pixelsPerSecond }),
    [pixelsPerSecond, rows, tracks],
  );
  const clearDrag = useCallback((target: HTMLDivElement, pointerId: number) => {
    dragRef.current = null;
    setRect(null);
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  }, []);
  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.defaultPrevented) return;
      if (isInteractiveTarget(event.target)) return;
      const point = getLocalPoint(event);
      if (!isTimelineLassoStartPoint(point)) return;
      const targetTrackId =
        event.target instanceof HTMLElement
          ? event.target
              .closest<HTMLElement>('[data-timeline-track-id]')
              ?.getAttribute('data-timeline-track-id')
          : null;
      if (targetTrackId) {
        onSelectTrack(targetTrackId);
      } else {
        const row = rows.find(
          (item) => point.y >= item.start && point.y < item.start + item.size,
        );
        const track = row ? tracks[row.index] : null;
        if (track) onSelectTrack(track.id);
      }
      dragRef.current = {
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        hasMoved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [onSelectTrack, rows, tracks],
  );
  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const point = getLocalPoint(event);
      if (!drag.hasMoved && !isIntentionalLassoMove(drag, point)) return;
      drag.hasMoved = true;
      event.preventDefault();
      setRect(normalizeLassoRect(drag, point));
    },
    [],
  );
  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const point = getLocalPoint(event);
      if (drag.hasMoved || isIntentionalLassoMove(drag, point)) {
        const finalRect = normalizeLassoRect(drag, point);
        onSelectClips(getClipIdsInLasso(candidates, finalRect));
      }
      clearDrag(event.currentTarget, event.pointerId);
    },
    [candidates, clearDrag, onSelectClips],
  );
  const handlePointerCancel = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      clearDrag(event.currentTarget, event.pointerId);
    },
    [clearDrag],
  );
  return {
    rect,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  };
}

export function buildTimelineLassoCandidates({
  rows,
  tracks,
  pixelsPerSecond,
}: {
  rows: TimelineLassoRow[];
  tracks: VideoTimelineTrack[];
  pixelsPerSecond: number;
}): TimelineLassoCandidate[] {
  const candidates: TimelineLassoCandidate[] = [];
  for (const row of rows) {
    const track = tracks[row.index];
    if (!track || track.locked) continue;
    for (const clip of track.clips) {
      const left =
        TRACK_HEADER_WIDTH + msToPixels(clip.startMs, pixelsPerSecond);
      candidates.push({
        clipId: clip.id,
        left,
        top: row.start + CLIP_VERTICAL_INSET_PX,
        right:
          left +
          Math.max(
            MIN_CLIP_WIDTH_PX,
            msToPixels(clip.durationMs, pixelsPerSecond),
          ),
        bottom: row.start + row.size - CLIP_VERTICAL_INSET_PX,
      });
    }
  }
  return candidates;
}

export function getClipIdsInLasso(
  candidates: TimelineLassoCandidate[],
  rect: TimelineLassoRect,
): string[] {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  return candidates
    .filter(
      (candidate) =>
        rect.left <= candidate.right &&
        right >= candidate.left &&
        rect.top <= candidate.bottom &&
        bottom >= candidate.top,
    )
    .map((candidate) => candidate.clipId);
}

function normalizeLassoRect(
  drag: TimelineLassoDrag,
  point: { x: number; y: number },
): TimelineLassoRect {
  const left = Math.min(drag.startX, point.x);
  const top = Math.min(drag.startY, point.y);
  return {
    left,
    top,
    width: Math.abs(point.x - drag.startX),
    height: Math.abs(point.y - drag.startY),
  };
}

function getLocalPoint(event: PointerEvent<HTMLDivElement>): {
  x: number;
  y: number;
} {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function isTimelineLassoStartPoint(point: { x: number; y: number }): boolean {
  return point.x >= TRACK_HEADER_WIDTH && point.y >= RULER_HEIGHT;
}

function isIntentionalLassoMove(
  drag: TimelineLassoDrag,
  point: { x: number; y: number },
): boolean {
  return (
    Math.hypot(point.x - drag.startX, point.y - drag.startY) >=
    LASSO_DRAG_THRESHOLD_PX
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest('button,input,textarea,select,[contenteditable="true"]')
  );
}
