import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { TRACK_HEADER_WIDTH } from './timelineLayout';
import { useTimelineScrollSync } from './useTimelineScrollSync';

interface UseTimelineAutoFitInput {
  projectId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  timelineDurationMs: number;
  tracksLength: number;
  /** Total clips across all tracks — a rise means a clip was inserted. */
  clipCount: number;
  setViewportWidth: (width: number) => void;
  zoomToFit: (durationMs: number) => void;
  resetZoom: () => void;
}

export function useTimelineAutoFit({
  projectId,
  scrollRef,
  timelineDurationMs,
  tracksLength,
  clipCount,
  setViewportWidth,
  zoomToFit,
  resetZoom,
}: UseTimelineAutoFitInput) {
  // Track the project + clip count last auto-fitted. We refit when a project
  // first loads and whenever a clip is *inserted* (count rises) so the new
  // clip's full duration is visible — but not on resize/move/zoom, which leaves
  // the user's manual zoom intact.
  const autoFitRef = useRef<{ projectId: string | null; clipCount: number }>({
    projectId: null,
    clipCount: 0,
  });
  const syncScrollLeftFromTimelineState = useTimelineScrollSync(scrollRef);

  useEffect(() => {
    if (tracksLength === 0) return;
    const element = scrollRef.current;
    if (!element || element.clientWidth <= TRACK_HEADER_WIDTH) return;

    const isNewProject = autoFitRef.current.projectId !== projectId;
    const clipInserted =
      !isNewProject && clipCount > autoFitRef.current.clipCount;
    if (!isNewProject && !clipInserted) {
      // Keep the count in sync (e.g. after a removal) without re-fitting.
      autoFitRef.current = { projectId, clipCount };
      return;
    }

    setViewportWidth(element.clientWidth - TRACK_HEADER_WIDTH);
    zoomToFit(timelineDurationMs);
    syncScrollLeftFromTimelineState();
    autoFitRef.current = { projectId, clipCount };
  }, [
    projectId,
    scrollRef,
    setViewportWidth,
    syncScrollLeftFromTimelineState,
    timelineDurationMs,
    tracksLength,
    clipCount,
    zoomToFit,
  ]);

  const handleZoomToFit = useCallback(() => {
    zoomToFit(timelineDurationMs);
    syncScrollLeftFromTimelineState();
  }, [syncScrollLeftFromTimelineState, timelineDurationMs, zoomToFit]);

  const handleResetZoom = useCallback(() => {
    resetZoom();
    syncScrollLeftFromTimelineState();
  }, [resetZoom, syncScrollLeftFromTimelineState]);

  return { handleResetZoom, handleZoomToFit };
}
