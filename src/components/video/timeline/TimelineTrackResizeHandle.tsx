import { useCallback, useRef } from 'react';

import { cn } from '@/shared/lib/utils';

interface TimelineTrackResizeHandleProps {
  currentHeight: number;
  minHeight?: number;
  maxHeight?: number;
  onResize: (nextHeight: number) => void;
  onReset?: () => void;
  label: string;
}

/**
 * Bottom-edge drag handle that resizes one timeline track row.
 * Captures the pointer so the drag continues over neighboring rows.
 */
export function TimelineTrackResizeHandle({
  currentHeight,
  minHeight = 28,
  maxHeight = 400,
  onResize,
  onReset,
  label,
}: TimelineTrackResizeHandleProps) {
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { startY: event.clientY, startHeight: currentHeight };
    },
    [currentHeight],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = event.clientY - drag.startY;
      const next = Math.max(
        minHeight,
        Math.min(maxHeight, drag.startHeight + delta),
      );
      onResize(next);
    },
    [maxHeight, minHeight, onResize],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
    },
    [],
  );

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      className={cn(
        'absolute right-0 bottom-0 left-0 z-20 h-1.5 cursor-row-resize',
        'hover:bg-primary/30 active:bg-primary/50',
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={onReset}
    />
  );
}
