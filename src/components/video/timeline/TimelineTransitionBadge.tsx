import { useEffect, useRef, useState, type PointerEvent } from 'react';

import { Plus, Shuffle } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import {
  normalizeVideoTransition,
  videoTransitionRegistryEntry,
} from '@/shared/types/video';

import {
  hasTransitionDragType,
  readTransitionDrag,
  type TransitionDragPayload,
} from '../transitions/transitionDragPayload';
import { msToPixels } from './timelineMath';
import type { TimelineTransitionSeam } from './timelineTransitions';

interface TimelineTransitionBadgeLabels {
  ariaLabel: string;
  dropHere: string;
  resizeLabel: string;
}

interface TimelineTransitionBadgeProps {
  seam: TimelineTransitionSeam;
  pixelsPerSecond: number;
  label: string;
  labels: TimelineTransitionBadgeLabels;
  selected: boolean;
  ghost?: boolean;
  fps: number;
  onSelect: (seamId: string) => void;
  onRemove: (seamId: string) => void;
  onDropTransition: (seamId: string, payload: TransitionDragPayload) => void;
  onResizeTransition: (seamId: string, durationMs: number) => void;
}

interface ResizeDrag {
  pointerId: number;
  centerClientX: number;
  durationMs: number;
}

export function TimelineTransitionBadge({
  seam,
  pixelsPerSecond,
  label,
  labels,
  selected,
  ghost = false,
  fps,
  onSelect,
  onRemove,
  onDropTransition,
  onResizeTransition,
}: TimelineTransitionBadgeProps) {
  const resizeDragRef = useRef<ResizeDrag | null>(null);
  const [draftDurationMs, setDraftDurationMs] = useState<number | null>(null);
  const transition = seam.transition
    ? normalizeVideoTransition(seam.transition)
    : null;
  const transitionEntry = transition
    ? videoTransitionRegistryEntry(transition.kind)
    : null;
  const durationMs = transition
    ? (transition.durationMs ?? transitionEntry?.defaultDurationMs ?? 500)
    : Math.min(500, seam.maxDurationMs);
  const visibleDurationMs = draftDurationMs ?? durationMs;
  const minDurationMs = transitionEntry?.minDurationMs ?? 33;
  const maxDurationMs = transitionEntry
    ? Math.max(
        transitionEntry.minDurationMs,
        Math.min(transitionEntry.maxDurationMs, seam.neighborMaxDurationMs),
      )
    : seam.maxDurationMs;
  const width = Math.max(30, msToPixels(visibleDurationMs, pixelsPerSecond));
  const left = Math.max(
    0,
    msToPixels(seam.startMs, pixelsPerSecond) - width / 2,
  );
  const showText = width >= 72;
  const ariaLabel = transition
    ? labels.ariaLabel
        .replace('{name}', label)
        .replace('{duration}', String(visibleDurationMs))
    : labels.dropHere;
  useEffect(() => {
    if (!resizeDragRef.current) setDraftDurationMs(null);
  }, [durationMs, seam.seamId]);

  const handleResizePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!transition) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(seam.seamId);
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    resizeDragRef.current = {
      pointerId: event.pointerId,
      centerClientX: rect.left + rect.width / 2,
      durationMs: visibleDurationMs,
    };
  };
  const handleResizePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const durationMs = snapDurationMs(
      (Math.abs(event.clientX - drag.centerClientX) * 2 * 1000) /
        pixelsPerSecond,
      fps,
      minDurationMs,
      maxDurationMs,
    );
    drag.durationMs = durationMs;
    setDraftDurationMs(durationMs);
  };
  const handleResizePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resizeDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraftDurationMs(null);
    onResizeTransition(seam.seamId, drag.durationMs);
  };

  return (
    <div
      data-timeline-transition-seam-id={seam.seamId}
      className="absolute top-1/2 z-20 h-7 -translate-y-1/2"
      style={{ left, width }}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={ariaLabel}
        tabIndex={ghost ? -1 : 0}
        title={ariaLabel}
        className={cn(
          'flex size-full items-center justify-center gap-1 overflow-hidden rounded border px-1 text-[10px] font-medium shadow-sm transition-colors',
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-background/95 text-foreground hover:border-primary/70',
          ghost &&
            'border-primary/70 bg-primary/15 text-primary pointer-events-none shadow-none',
        )}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(seam.seamId);
        }}
        onFocus={() => onSelect(seam.seamId)}
        onContextMenu={(event) => {
          if (!transition) return;
          event.preventDefault();
          event.stopPropagation();
          onRemove(seam.seamId);
        }}
        onDragOver={(event) => {
          if (
            !seam.canAcceptTransition ||
            !hasTransitionDragType(event.dataTransfer)
          ) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          if (!seam.canAcceptTransition) return;
          const payload = readTransitionDrag(event.dataTransfer);
          if (!payload) return;
          event.preventDefault();
          event.stopPropagation();
          onDropTransition(seam.seamId, payload);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(seam.seamId);
            return;
          }
          if (event.key !== 'Delete' && event.key !== 'Backspace') return;
          event.preventDefault();
          event.stopPropagation();
          onRemove(seam.seamId);
        }}
      >
        {ghost ? (
          <Plus aria-hidden className="size-3 shrink-0" />
        ) : (
          <Shuffle aria-hidden className="size-3 shrink-0" />
        )}
        {showText ? (
          <span className="truncate">{ghost ? labels.dropHere : label}</span>
        ) : null}
      </button>
      {selected && transition ? (
        <>
          <ResizeHandle
            label={labels.resizeLabel}
            side="left"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerEnd={handleResizePointerEnd}
          />
          <ResizeHandle
            label={labels.resizeLabel}
            side="right"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerEnd={handleResizePointerEnd}
          />
        </>
      ) : null}
    </div>
  );
}

function ResizeHandle({
  label,
  side,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
}: {
  label: string;
  side: 'left' | 'right';
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerEnd: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'border-background bg-primary absolute top-1/2 h-5 w-2 -translate-y-1/2 cursor-ew-resize rounded-sm border shadow-sm',
        side === 'left' ? '-left-1' : '-right-1',
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    />
  );
}

function snapDurationMs(
  durationMs: number,
  fps: number,
  minDurationMs: number,
  maxDurationMs: number,
): number {
  const frameMs = Number.isFinite(fps) && fps > 0 ? 1000 / fps : 33;
  const snapped = Math.round(durationMs / frameMs) * frameMs;
  return Math.max(minDurationMs, Math.min(maxDurationMs, Math.round(snapped)));
}
