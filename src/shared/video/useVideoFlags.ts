import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

export type VideoFlags = Record<string, boolean>;

export interface UseVideoFlagsResult {
  flags: VideoFlags;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useVideoFlags(): UseVideoFlagsResult {
  const [flags, setFlags] = useState<VideoFlags>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/video/flags`, {
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { flags: VideoFlags };
        if (ac.signal.aborted) return;
        setFlags(json.flags);
        setLoading(false);
      } catch (caught) {
        if (ac.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [nonce]);

  return { flags, loading, error, retry };
}
