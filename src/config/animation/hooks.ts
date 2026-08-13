/**
 * Animation Hooks
 *
 * Custom React hooks for common animation patterns.
 */

import { useEffect, useRef, useState } from 'react';

import { useReducedMotion } from 'motion/react';

import { DURATION } from './constants';

/**
 * Hook that respects the user's `prefers-reduced-motion` setting.
 * When reduced motion is preferred, animations are simplified to
 * instant opacity transitions (no transforms, no springs).
 *
 * Usage:
 *   const prefersReduced = useAnimationPreference();
 *   // Use prefersReduced to conditionally simplify animations
 */
export function useAnimationPreference(): boolean {
  const prefersReduced = useReducedMotion();
  return prefersReduced ?? false;
}

/**
 * Returns animation props that respect reduced motion.
 * Pass these to any motion component to automatically degrade
 * gracefully when the user prefers reduced motion.
 *
 * @param normalProps - The full animation props
 * @param reducedProps - Simplified props for reduced motion (defaults to fade-only)
 */
export function useAccessibleAnimation<T extends Record<string, unknown>>(
  normalProps: T,
  reducedProps?: Partial<T>,
): T {
  const prefersReduced = useAnimationPreference();

  if (prefersReduced) {
    // Default reduced-motion behavior: instant fade, no transforms
    const defaults = {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: DURATION.instant },
    } as unknown as Partial<T>;

    return { ...normalProps, ...defaults, ...reducedProps };
  }

  return normalProps;
}

/**
 * Delays rendering of children until after mount to enable entrance animations.
 * Useful for components that need to animate in after the parent mounts.
 *
 * @param delayMs - Milliseconds to wait before showing (default: 0 = next tick)
 * @returns boolean indicating if the component should be visible
 */
export function useMountAnimation(delayMs: number = 0): boolean {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    if (delayMs === 0) {
      // Next frame
      requestAnimationFrame(() => setIsMounted(true));
    } else {
      const timer = setTimeout(() => setIsMounted(true), delayMs);
      return () => clearTimeout(timer);
    }
  }, [delayMs]);

  return isMounted;
}

/**
 * Tracks whether an element has entered the viewport at least once.
 * Useful for "animate on first scroll into view" patterns.
 *
 * @returns [ref, hasBeenSeen] — attach ref to the target element
 */
export function useFirstInView(): [
  React.RefObject<HTMLDivElement | null>,
  boolean,
] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [hasBeenSeen, setHasBeenSeen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || hasBeenSeen) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasBeenSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasBeenSeen]);

  return [ref, hasBeenSeen];
}

/**
 * Returns incrementing count for stagger animations.
 * Each time `items` length increases, new items get stagger index assigned.
 *
 * @param currentCount - Current number of items
 * @returns previousCount — the count before the latest update
 */
export function useStaggerIndex(currentCount: number): number {
  const prevCount = useRef(0);

  useEffect(() => {
    prevCount.current = currentCount;
  }, [currentCount]);

  return prevCount.current;
}
