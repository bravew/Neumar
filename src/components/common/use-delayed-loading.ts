import { useEffect, useRef, useState } from 'react';

/** Wait this long before a skeleton appears, so fast loads never flash one. */
export const SKELETON_SHOW_DELAY_MS = 120;

/** Once a skeleton is on screen, keep it at least this long to avoid flicker. */
export const SKELETON_MIN_VISIBLE_MS = 250;

/**
 * True only while a skeleton should be painted.
 * Stays false for `delayMs` after `loading` becomes true. After it turns
 * true, it stays true for at least `minMs` even if `loading` ends sooner.
 */
export function useDelayedLoading(
  loading: boolean,
  delayMs = SKELETON_SHOW_DELAY_MS,
  minMs = SKELETON_MIN_VISIBLE_MS,
): boolean {
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (loading) {
      if (visible) return;
      const timer = window.setTimeout(() => {
        shownAtRef.current = Date.now();
        setVisible(true);
      }, delayMs);
      return () => window.clearTimeout(timer);
    }

    const shownAt = shownAtRef.current;
    if (!visible || shownAt == null) {
      shownAtRef.current = null;
      return;
    }

    const remain = Math.max(0, minMs - (Date.now() - shownAt));
    const timer = window.setTimeout(() => {
      shownAtRef.current = null;
      setVisible(false);
    }, remain);
    return () => window.clearTimeout(timer);
  }, [loading, visible, delayMs, minMs]);

  return visible;
}
