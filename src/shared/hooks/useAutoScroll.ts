/**
 * useAutoScroll — Virtuoso auto-scroll hook with user scroll detection.
 *
 * Ported from AionUi's scroll guard patterns, adapted for our AG-UI message types.
 *
 * Strategy:
 * - `followOutput` handles auto-scroll when totalCount changes (new items).
 * - A 150ms programmatic scroll guard prevents Virtuoso's internal adjustments
 *   from being misdetected as user scroll-up.
 * - ResizeObserver compensates for container layout shifts (permission dialogs,
 *   sub-agent panel appearing/disappearing).
 * - A 500ms debounced gap closer catches residual gaps after streaming ends.
 *
 * All scrolling uses Virtuoso's `scrollToIndex` API — no manual `scrollTop` writes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { VirtuosoHandle } from 'react-virtuoso';

// Ignore scroll events within this window after a programmatic scroll (ms)
const PROGRAMMATIC_SCROLL_GUARD_MS = 150;

interface UseAutoScrollOptions {
  /** Whether the agent is currently running/streaming */
  isRunning: boolean;
}

interface UseAutoScrollReturn {
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  handleScrollerRef: (ref: HTMLElement | Window | null) => void;
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  handleAtBottomStateChange: (atBottom: boolean) => void;
  handleFollowOutput: (isAtBottom: boolean) => false | 'auto';
  showScrollButton: boolean;
  scrollToBottom: (behavior?: 'smooth' | 'auto') => void;
}

export function useAutoScroll({
  isRunning,
}: UseAutoScrollOptions): UseAutoScrollReturn {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [scrollerEl, setScrollerEl] = useState<HTMLElement | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const userScrolledRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastProgrammaticScrollTimeRef = useRef(0);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const followOutputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Mirror of isRunning so atBottomStateChange (memoized once) can read the
  // current streaming state without recreating its callback identity.
  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;

  /**
   * Scroll to the last item using Virtuoso's API.
   * All scroll-to-bottom operations go through this function
   * instead of directly writing scrollTop.
   */
  const scrollToLast = useCallback((behavior: 'smooth' | 'auto' = 'auto') => {
    if (!virtuosoRef.current) return;
    lastProgrammaticScrollTimeRef.current = Date.now();
    virtuosoRef.current.scrollToIndex({
      index: 'LAST',
      behavior,
      align: 'end',
    });
  }, []);

  // Capture Virtuoso's scroll container
  const handleScrollerRef = useCallback((ref: HTMLElement | Window | null) => {
    const el = ref instanceof HTMLElement ? ref : null;
    // Clear any pending followOutput timer from the previous scroller instance
    if (followOutputTimerRef.current) {
      clearTimeout(followOutputTimerRef.current);
      followOutputTimerRef.current = null;
    }
    scrollerElRef.current = el;
    setScrollerEl(el);
  }, []);

  // ResizeObserver: when the container resizes (e.g. permission dialog appears/disappears),
  // set scroll guard so Virtuoso's adjustment isn't misdetected as user scroll-up.
  useEffect(() => {
    if (!scrollerEl) return;

    let prevHeight = scrollerEl.clientHeight;
    let growTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new ResizeObserver(() => {
      const newHeight = scrollerEl.clientHeight;
      const delta = prevHeight - newHeight;
      prevHeight = newHeight;

      if (delta !== 0 && !userScrolledRef.current) {
        lastProgrammaticScrollTimeRef.current = Date.now();

        // Container grew — scroll to true bottom after Virtuoso settles
        if (delta < 0) {
          if (growTimer) clearTimeout(growTimer);
          growTimer = setTimeout(() => {
            if (!userScrolledRef.current) {
              scrollToLast();
              growTimer = setTimeout(() => {
                if (!userScrolledRef.current) scrollToLast();
              }, 200);
            }
          }, 50);
        }
      }
    });

    observer.observe(scrollerEl);
    return () => {
      observer.disconnect();
      if (growTimer) clearTimeout(growTimer);
    };
  }, [scrollerEl, scrollToLast]);

  // Clean up debounced followOutput timer on unmount
  useEffect(() => {
    return () => {
      if (followOutputTimerRef.current)
        clearTimeout(followOutputTimerRef.current);
    };
  }, []);

  // Public scroll-to-bottom for button clicks and user message sends
  const scrollToBottom = useCallback(
    (behavior: 'smooth' | 'auto' = 'smooth') => {
      userScrolledRef.current = false;
      setShowScrollButton(false);
      scrollToLast(behavior);
    },
    [scrollToLast],
  );

  // followOutput: handles auto-scroll when new items are appended.
  // Returns 'auto' to let Virtuoso scroll, or false if user scrolled up.
  // A 500ms debounced gap closer catches residual gaps after streaming ends.
  const handleFollowOutput = useCallback(
    (_isAtBottom: boolean): false | 'auto' => {
      if (userScrolledRef.current) return false;
      lastProgrammaticScrollTimeRef.current = Date.now();
      if (followOutputTimerRef.current)
        clearTimeout(followOutputTimerRef.current);
      followOutputTimerRef.current = setTimeout(() => {
        if (!userScrolledRef.current) {
          scrollToLast();
        }
      }, 500);
      return 'auto';
    },
    [scrollToLast],
  );

  // Bottom state change: track whether user is at bottom.
  // When atBottom transitions true→false from layout shift (not user scroll),
  // scroll back to bottom — but only while streaming. Wheel/trackpad momentum
  // near the atBottomThreshold otherwise oscillates the at-bottom flag and
  // fights the user's scroll with repeated programmatic snaps.
  const handleAtBottomStateChange = useCallback(
    (atBottom: boolean) => {
      setShowScrollButton(!atBottom);

      if (atBottom) {
        // Short guard (50ms) — absorbs Virtuoso's internal rAF adjustments
        lastProgrammaticScrollTimeRef.current =
          Date.now() - (PROGRAMMATIC_SCROLL_GUARD_MS - 50);
        const el = scrollerElRef.current;
        const gap = el ? el.scrollHeight - el.clientHeight - el.scrollTop : 0;
        // Only resume auto-follow when truly pinned to the bottom. If the user
        // wheel-scrolled into the atBottomThreshold zone but there is still a
        // visible gap, leave userScrolledRef alone so a stray wheel-up event
        // (trackpad momentum oscillation) does not trigger the snap-back below.
        if (gap <= 2) {
          userScrolledRef.current = false;
        } else if (isRunningRef.current && !userScrolledRef.current) {
          // Close the residual gap during streaming follow.
          scrollToLast('auto');
        }
      } else if (!userScrolledRef.current && isRunningRef.current) {
        // Layout shift pushed us off bottom during streaming — snap back.
        // When idle, the user is just reading; do not fight their scroll.
        scrollToLast();
      }
    },
    [scrollToLast],
  );

  // Detect user scrolling up
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const currentScrollTop = target.scrollTop;

    // Ignore events within the programmatic scroll guard window
    const timeSinceGuard = Date.now() - lastProgrammaticScrollTimeRef.current;
    if (timeSinceGuard < PROGRAMMATIC_SCROLL_GUARD_MS) {
      lastScrollTopRef.current = currentScrollTop;
      return;
    }

    const delta = currentScrollTop - lastScrollTopRef.current;
    if (delta < -10) {
      userScrolledRef.current = true;
    }

    // Refresh guard during auto-follow to prevent false scroll-up detection
    if (!userScrolledRef.current && delta > 0) {
      lastProgrammaticScrollTimeRef.current = Date.now();
    }

    lastScrollTopRef.current = currentScrollTop;
  }, []);

  // When streaming ends, close any residual gap
  const prevIsRunningRef = useRef(isRunning);
  useEffect(() => {
    if (prevIsRunningRef.current && !isRunning && !userScrolledRef.current) {
      // Streaming just ended — snap to bottom after a brief delay
      const timer = setTimeout(() => {
        if (!userScrolledRef.current) {
          scrollToLast();
        }
      }, 500);
      prevIsRunningRef.current = isRunning;
      return () => clearTimeout(timer);
    }
    prevIsRunningRef.current = isRunning;
  }, [isRunning, scrollToLast]);

  return {
    virtuosoRef,
    handleScrollerRef,
    handleScroll,
    handleAtBottomStateChange,
    handleFollowOutput,
    showScrollButton,
    scrollToBottom,
  };
}
