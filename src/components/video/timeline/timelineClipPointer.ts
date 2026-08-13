import type { PointerEvent } from 'react';

import type { TimelineClipSelectionMode } from './useTimelineEditorStore';

export function isIntentionalMove(deltaX: number, deltaY: number): boolean {
  return Math.hypot(deltaX, deltaY) >= 4;
}

export function getSelectionMode(
  event: PointerEvent<HTMLDivElement>,
): TimelineClipSelectionMode {
  if (event.shiftKey) return 'range';
  if (event.metaKey || event.ctrlKey) return 'toggle';
  return 'replace';
}

export function applyDocumentMoveFeedback(): () => void {
  if (typeof document === 'undefined') return () => {};
  const body = document.body;
  const previousUserSelect = body.style.userSelect;
  const previousCursor = body.style.cursor;
  body.style.userSelect = 'none';
  body.style.cursor = 'grabbing';
  return () => {
    body.style.userSelect = previousUserSelect;
    body.style.cursor = previousCursor;
  };
}
