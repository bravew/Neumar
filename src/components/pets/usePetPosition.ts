import { useCallback, useEffect, useRef, useState } from 'react';

import type { PetPosition } from '@/shared/db/settings';

const DEFAULT_POSITION = { right: 24, bottom: 24 } satisfies PetPosition;

export function usePetPosition(
  storedPosition: PetPosition | undefined,
  persistPosition: (position: PetPosition) => void,
) {
  const [position, setPositionState] = useState<PetPosition>(() =>
    clampPosition(storedPosition ?? DEFAULT_POSITION),
  );
  const positionRef = useRef(position);

  const setPosition = useCallback(
    (next: PetPosition | ((current: PetPosition) => PetPosition)) => {
      const resolved =
        typeof next === 'function'
          ? (next as (current: PetPosition) => PetPosition)(positionRef.current)
          : next;
      const clamped = clampPosition(resolved);
      positionRef.current = clamped;
      setPositionState(clamped);
    },
    [],
  );

  const persistCurrentPosition = useCallback(() => {
    persistPosition(positionRef.current);
  }, [persistPosition]);

  // Sync from stored settings only when the *value* actually changes.
  // `storedPosition` is rebuilt every parent render by `normalizePetSettings`,
  // so depending on the object reference resets local drag state on every
  // re-render and fights pointer-move updates.
  useEffect(() => {
    if (!storedPosition) return;
    if (
      storedPosition.right === positionRef.current.right &&
      storedPosition.bottom === positionRef.current.bottom
    ) {
      return;
    }
    setPosition(storedPosition);
  }, [setPosition, storedPosition?.right, storedPosition?.bottom]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function handleResize() {
      const clamped = clampPosition(positionRef.current);
      if (
        clamped.right !== positionRef.current.right ||
        clamped.bottom !== positionRef.current.bottom
      ) {
        setPosition(clamped);
      }
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setPosition]);

  return { position, positionRef, setPosition, persistCurrentPosition };
}

export function clampPosition(position: PetPosition): PetPosition {
  if (typeof window === 'undefined') return position;

  const spriteBudget = Math.max(
    96,
    Math.min(Math.round(window.innerWidth * 0.12), 160),
  );
  const maxRight = Math.max(16, window.innerWidth - spriteBudget);
  const maxBottom = Math.max(16, window.innerHeight - spriteBudget);

  return {
    right: Math.max(16, Math.min(maxRight, position.right)),
    bottom: Math.max(16, Math.min(maxBottom, position.bottom)),
  };
}
