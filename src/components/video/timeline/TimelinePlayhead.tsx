import { type KeyboardEvent, type PointerEvent } from 'react';

import { msToPixels, pixelsToMs } from './timelineMath';

interface TimelinePlayheadProps {
  playheadMs: number;
  durationMs: number;
  headerWidth: number;
  pixelsPerSecond: number;
  ariaLabel: string;
  onSeek: (ms: number) => void;
}

const KEYBOARD_STEP_MS = 100;
const KEYBOARD_LARGE_STEP_MS = 1000;

export function TimelinePlayhead({
  playheadMs,
  durationMs,
  headerWidth,
  pixelsPerSecond,
  ariaLabel,
  onSeek,
}: TimelinePlayheadProps) {
  const seekFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const parent = event.currentTarget.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const timelineX = event.clientX - rect.left - headerWidth;
    onSeek(pixelsToMs(timelineX, pixelsPerSecond));
  };
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromPointer(event);
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    seekFromPointer(event);
  };
  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const stepMs = event.shiftKey ? KEYBOARD_LARGE_STEP_MS : KEYBOARD_STEP_MS;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onSeek(playheadMs - stepMs);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onSeek(playheadMs + stepMs);
    }
    if (event.key === 'Home') {
      event.preventDefault();
      onSeek(0);
    }
    if (event.key === 'End') {
      event.preventDefault();
      onSeek(durationMs);
    }
  };

  return (
    <div
      data-timeline-playhead
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs)}
      aria-valuenow={Math.round(playheadMs)}
      className="absolute top-0 bottom-0 z-50 w-4 -translate-x-1/2 cursor-ew-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
      style={{ left: headerWidth + msToPixels(playheadMs, pixelsPerSecond) }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
    >
      <div className="absolute top-0 left-1/2 h-3 w-3 -translate-x-1/2 rounded-b-sm bg-red-500 shadow-sm shadow-black/30" />
      <div className="absolute top-0 bottom-0 left-1/2 border-l border-red-500" />
    </div>
  );
}
