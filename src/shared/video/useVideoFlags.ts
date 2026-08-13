import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

// Slice K — read the video feature-flag snapshot so the UI hides the html-video
// surface when an operator flips a kill switch off. Flags are on by default, so
// the UI optimistically treats everything as enabled until told otherwise.

export type VideoFlags = Record<string, boolean>;

export interface UseVideoFlagsResult {
  flags: VideoFlags;
  loading: boolean;
}

export function useVideoFlags(): UseVideoFlagsResult {
  const [flags, setFlags] = useState<VideoFlags>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
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
      } catch {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  return { flags, loading };
}
