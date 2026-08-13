import { useRef } from 'react';

const COOLDOWN_MS = 10_000;
const MAX_PER_WINDOW = 3;

interface ToastWindow {
  count: number;
  windowStart: number;
}

/**
 * Hook providing a deduplication-aware toast gating function.
 * Prevents notification floods during rapid tool loops or status changes.
 *
 * Usage:
 *   const { dedupedToast } = useNotifications();
 *   dedupedToast('task_complete', () => toast.success('Task done'));
 *
 * Allows at most MAX_PER_WINDOW (3) toasts per key within COOLDOWN_MS (10s).
 * Subsequent calls within the window are silently dropped.
 */
export function useNotifications() {
  const windowMapRef = useRef<Map<string, ToastWindow>>(new Map());

  function dedupedToast(key: string, show: () => void): void {
    const now = Date.now();
    const entry = windowMapRef.current.get(key);

    if (!entry || now - entry.windowStart > COOLDOWN_MS) {
      // Start new window
      windowMapRef.current.set(key, { count: 1, windowStart: now });
      show();
    } else if (entry.count < MAX_PER_WINDOW) {
      entry.count++;
      show();
    }
    // Silently drop — window exhausted
  }

  return { dedupedToast };
}
