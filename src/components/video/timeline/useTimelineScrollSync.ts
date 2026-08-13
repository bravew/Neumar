import { useCallback, type RefObject } from 'react';

import { useTimelineUiStore } from './useTimelineUiStore';

export function useTimelineScrollSync(
  scrollRef: RefObject<HTMLDivElement | null>,
) {
  return useCallback(() => {
    const sync = () => {
      const element = scrollRef.current;
      if (!element) return;
      const nextScrollX = useTimelineUiStore.getState().scrollX;
      if (Math.abs(element.scrollLeft - nextScrollX) > 1) {
        element.scrollLeft = nextScrollX;
      }
    };
    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      window.requestAnimationFrame(sync);
      return;
    }
    sync();
  }, [scrollRef]);
}
