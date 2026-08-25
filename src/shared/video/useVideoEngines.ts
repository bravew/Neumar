import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

// Runtime-selection contract (P2-6) + packaged-runtime setup surface (Phase B).
// `GET /video/engines` returns every registered engine with its honest
// tradeoffs and, when it cannot run here, the typed reason the setup prompt
// turns into install guidance.

export type VideoEngineUnavailableReason =
  | 'not-found'
  | 'version-too-old'
  | 'browser-missing';

export interface VideoEngineOption {
  id: string;
  name: string;
  version: string;
  installed: boolean;
  unavailableReason?: VideoEngineUnavailableReason;
  detectedVersion?: string;
  requiredVersion?: string;
  detail?: string;
  bestFor: string[];
  weaknesses: string[];
  outputFormats: string[];
  alpha: boolean;
  renderSpeedHint?: 'realtime' | 'faster' | 'slower';
  licensing: string;
}

export interface UseVideoEnginesResult {
  engines: VideoEngineOption[];
  recommendedEngineId?: string;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useVideoEngines(): UseVideoEnginesResult {
  const [engines, setEngines] = useState<VideoEngineOption[]>([]);
  const [recommendedEngineId, setRecommendedEngineId] = useState<
    string | undefined
  >(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((prev) => prev + 1), []);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/video/engines`, {
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          engines: VideoEngineOption[];
          recommendedEngineId?: string;
        };
        if (ac.signal.aborted) return;
        setEngines(json.engines ?? []);
        setRecommendedEngineId(json.recommendedEngineId);
        setLoading(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [nonce]);

  return { engines, recommendedEngineId, loading, error, refresh };
}
