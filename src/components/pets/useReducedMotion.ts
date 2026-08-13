import { useEffect, useState } from 'react';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);

    function handleChange(event: MediaQueryListEvent) {
      setReduced(event.matches);
    }

    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return reduced;
}
