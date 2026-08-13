import { useEffect, type RefObject } from 'react';

import { TRACK_HEADER_WIDTH } from './timelineLayout';

export function useTimelineViewportWidth({
  scrollRef,
  setViewportWidth,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  setViewportWidth: (width: number) => void;
}) {
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const updateWidth = () => {
      setViewportWidth(Math.max(1, element.clientWidth - TRACK_HEADER_WIDTH));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRef, setViewportWidth]);
}
