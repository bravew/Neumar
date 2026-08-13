import { useEffect, type RefObject } from 'react';

interface UseResizeAutoFollowOptions {
  targetRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  shouldFollow: () => boolean;
  follow: () => void;
  onResize?: () => void;
}

export function useResizeAutoFollow({
  targetRef,
  enabled,
  shouldFollow,
  follow,
  onResize,
}: UseResizeAutoFollowOptions) {
  useEffect(() => {
    const target = targetRef.current;
    if (!enabled || !target || typeof ResizeObserver === 'undefined') return;

    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (!shouldFollow()) {
        onResize?.();
        return;
      }

      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        follow();
        onResize?.();
      });
    });

    observer.observe(target);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled, follow, onResize, shouldFollow, targetRef]);
}
