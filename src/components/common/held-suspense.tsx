import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  SKELETON_MIN_VISIBLE_MS,
  SKELETON_SHOW_DELAY_MS,
} from '@/components/common/use-delayed-loading';

interface ShownAtValue {
  shownAt: number | null;
  markShown: (at: number) => void;
}

const ShownAtContext = createContext<ShownAtValue | null>(null);

/**
 * Suspense fallback that stays blank for the show delay, then holds the
 * skeleton for the minimum visible time after the lazy page resolves.
 */
export function HeldSuspense({
  fallback,
  children,
  delayMs = SKELETON_SHOW_DELAY_MS,
  minMs = SKELETON_MIN_VISIBLE_MS,
}: {
  fallback: ReactNode;
  children: ReactNode;
  delayMs?: number;
  minMs?: number;
}) {
  const [shownAt, setShownAt] = useState<number | null>(null);
  const markShown = useCallback((at: number) => {
    setShownAt((current) => current ?? at);
  }, []);
  const value = useMemo(() => ({ shownAt, markShown }), [shownAt, markShown]);

  return (
    <ShownAtContext.Provider value={value}>
      <Suspense
        fallback={
          <DelayedFallback delayMs={delayMs}>{fallback}</DelayedFallback>
        }
      >
        <HoldContent minMs={minMs} fallback={fallback}>
          {children}
        </HoldContent>
      </Suspense>
    </ShownAtContext.Provider>
  );
}

function DelayedFallback({
  delayMs,
  children,
}: {
  delayMs: number;
  children: ReactNode;
}) {
  const markShown = useContext(ShownAtContext)?.markShown;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      markShown?.(Date.now());
      setVisible(true);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, markShown]);

  if (!visible) {
    return (
      <div
        className="bg-background min-h-svh"
        data-testid="route-pending"
        aria-busy="true"
      />
    );
  }

  return children;
}

function HoldContent({
  minMs,
  fallback,
  children,
}: {
  minMs: number;
  fallback: ReactNode;
  children: ReactNode;
}) {
  const shownAt = useContext(ShownAtContext)?.shownAt ?? null;
  const [holding, setHolding] = useState(() => {
    if (shownAt == null) return false;
    return Date.now() - shownAt < minMs;
  });

  useEffect(() => {
    if (!holding || shownAt == null) return;
    const remain = Math.max(0, shownAt + minMs - Date.now());
    const timer = window.setTimeout(() => setHolding(false), remain);
    return () => window.clearTimeout(timer);
  }, [holding, shownAt, minMs]);

  if (holding) return fallback;
  return children;
}
