import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotionPreference(): boolean {
  const [reducedMotion, setReducedMotion] = useState(
    readReducedMotionPreference,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    setReducedMotion(query.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
    };

    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return reducedMotion;
}

function readReducedMotionPreference(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
