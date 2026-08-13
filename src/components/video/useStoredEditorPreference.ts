import { useCallback, useState } from 'react';

export function useStoredBoolean(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return fallback;
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === 'true';
  });

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, String(next));
      }
    },
    [key],
  );

  return [value, update] as const;
}

export function useStoredNumber(key: string, fallback: number) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return fallback;
    const stored = window.localStorage.getItem(key);
    const parsed = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(parsed) ? parsed : fallback;
  });

  const update = useCallback(
    (next: number) => {
      setValue(next);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, String(next));
      }
    },
    [key],
  );

  return [value, update] as const;
}
