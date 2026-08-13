import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent,
  type RefObject,
} from 'react';

import { pixelsToMs, snapMsToFrame } from './timelineMath';
import { useTimelineUiStore } from './useTimelineUiStore';

interface TimelineHoverPreviewOptions {
  fps: number;
  isBusy: boolean;
  pixelsPerSecond: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  timelineDurationMs: number;
  timelineWidth: number;
  trackHeaderWidth: number;
}

interface HoverMetrics {
  fps: number;
  isBusy: boolean;
  pixelsPerSecond: number;
  timelineDurationMs: number;
  timelineWidth: number;
  trackHeaderWidth: number;
}

export function useTimelineHoverPreview({
  fps,
  isBusy,
  pixelsPerSecond,
  scrollRef,
  timelineDurationMs,
  timelineWidth,
  trackHeaderWidth,
}: TimelineHoverPreviewOptions) {
  const hoverMs = useTimelineUiStore((state) => state.hoverMs);
  const setHoverMs = useTimelineUiStore((state) => state.setHoverMs);
  const frameRef = useRef<number | null>(null);
  const latestClientXRef = useRef<number | null>(null);
  const metricsRef = useRef<HoverMetrics>({
    fps,
    isBusy,
    pixelsPerSecond,
    timelineDurationMs,
    timelineWidth,
    trackHeaderWidth,
  });

  useEffect(() => {
    metricsRef.current = {
      fps,
      isBusy,
      pixelsPerSecond,
      timelineDurationMs,
      timelineWidth,
      trackHeaderWidth,
    };
  }, [
    fps,
    isBusy,
    pixelsPerSecond,
    timelineDurationMs,
    timelineWidth,
    trackHeaderWidth,
  ]);

  const cancelFrame = useCallback(() => {
    if (frameRef.current === null) return;
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const clearHover = useCallback(() => {
    latestClientXRef.current = null;
    cancelFrame();
    setHoverMs(null);
  }, [cancelFrame, setHoverMs]);

  const flushHover = useCallback(() => {
    frameRef.current = null;
    const clientX = latestClientXRef.current;
    const scrollEl = scrollRef.current;
    if (clientX === null || !scrollEl) {
      setHoverMs(null);
      return;
    }
    const {
      fps: currentFps,
      isBusy: currentIsBusy,
      pixelsPerSecond: currentPixelsPerSecond,
      timelineDurationMs: currentTimelineDurationMs,
      timelineWidth: currentTimelineWidth,
      trackHeaderWidth: currentTrackHeaderWidth,
    } = metricsRef.current;
    if (currentIsBusy) {
      setHoverMs(null);
      return;
    }
    const rect = scrollEl.getBoundingClientRect();
    const localX =
      clientX - rect.left - currentTrackHeaderWidth + scrollEl.scrollLeft;
    if (localX < 0 || localX > currentTimelineWidth) {
      setHoverMs(null);
      return;
    }
    const rawMs = pixelsToMs(localX, currentPixelsPerSecond);
    setHoverMs(snapMsToFrame(rawMs, currentFps, currentTimelineDurationMs));
  }, [scrollRef, setHoverMs]);

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (
        event.pointerType !== 'mouse' ||
        event.buttons !== 0 ||
        metricsRef.current.isBusy
      ) {
        clearHover();
        return;
      }
      latestClientXRef.current = event.clientX;
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(flushHover);
    },
    [clearHover, flushHover],
  );

  useEffect(() => {
    if (isBusy) clearHover();
  }, [clearHover, isBusy]);

  useEffect(() => clearHover, [clearHover]);

  return {
    clearHover,
    handlePointerMove,
    hoverMs,
  };
}
