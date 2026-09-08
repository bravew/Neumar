import { useMemo } from 'react';

import { visibleClipWindow, type ClipTimeWindow } from './clipWindow';
import type { TimelineClipMoveOverlayState } from './timelineClipDrag';
import { useTimelineUiStore } from './useTimelineUiStore';

/**
 * Roughly half a viewport of margin on each side at the default zoom. Large
 * enough that a fast scroll does not outrun the render, small enough that the
 * mounted clip count still tracks the viewport rather than the timeline.
 */
export const CLIP_WINDOW_OVERSCAN_PX = 400;

interface UseTimelineClipWindowOptions {
  pixelsPerSecond: number;
  timelineDurationMs: number;
  selectedClipIds: ReadonlySet<string>;
  lastSelectedClipId: string | null;
  moveOverlay: TimelineClipMoveOverlayState | null;
}

export interface TimelineClipWindow {
  window: ClipTimeWindow;
  /**
   * Clips that must stay mounted regardless of the window: the selection, the
   * keyboard-focused clip, and anything being dragged. A clip that unmounts
   * mid-interaction takes its pointer capture with it.
   */
  pinnedClipIds: ReadonlySet<string>;
}

export function useTimelineClipWindow({
  pixelsPerSecond,
  timelineDurationMs,
  selectedClipIds,
  lastSelectedClipId,
  moveOverlay,
}: UseTimelineClipWindowOptions): TimelineClipWindow {
  const scrollX = useTimelineUiStore((state) => state.scrollX);
  const viewportWidth = useTimelineUiStore((state) => state.viewportWidth);

  const window = useMemo(
    () =>
      visibleClipWindow({
        scrollX,
        viewportWidth,
        pixelsPerSecond,
        overscanPx: CLIP_WINDOW_OVERSCAN_PX,
        durationMs: timelineDurationMs,
      }),
    [pixelsPerSecond, scrollX, timelineDurationMs, viewportWidth],
  );

  const draggedClipId = moveOverlay?.clip.id ?? null;
  const pinnedClipIds = useMemo(() => {
    const pinned = new Set(selectedClipIds);
    if (lastSelectedClipId) pinned.add(lastSelectedClipId);
    if (draggedClipId) pinned.add(draggedClipId);
    return pinned;
  }, [draggedClipId, lastSelectedClipId, selectedClipIds]);

  return { window, pinnedClipIds };
}
