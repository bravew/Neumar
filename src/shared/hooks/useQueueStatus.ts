/**
 * useQueueStatus — Hook that polls the queue manager for task concurrency state.
 *
 * Provides per-profile running/queued counts and whether the profile can accept
 * more tasks. Polls every 5 seconds while mounted.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';

interface QueueState {
  running: number;
  maxConcurrent: number;
  queued: number;
  runningTaskIds: string[];
}

interface GlobalQueueStats {
  totalRunning: number;
  totalQueued: number;
  perProfile: Record<string, { running: number; queued: number; max: number }>;
}

const POLL_INTERVAL = 5_000;

function usePolledFetch<T>(url: string, interval = POLL_INTERVAL) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const lastJsonRef = useRef<string>('');

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return;
      const json = (await res.json()) as { success: boolean; data: T };
      if (!json.success) return;
      const serialized = JSON.stringify(json.data);
      if (serialized === lastJsonRef.current) return;
      lastJsonRef.current = serialized;
      setData(json.data);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, interval);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetchData, interval]);

  return { data, loading, refresh: fetchData };
}

export function useQueueStatus(profileId?: string | null) {
  const params = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
  const {
    data: state,
    loading,
    refresh,
  } = usePolledFetch<QueueState>(`${API_BASE_URL}/agent/queue/status${params}`);

  const canAccept = state ? state.running < state.maxConcurrent : true;

  return { state, loading, canAccept, refresh };
}

export function useGlobalQueueStats() {
  const {
    data: stats,
    loading,
    refresh,
  } = usePolledFetch<GlobalQueueStats>(`${API_BASE_URL}/agent/queue/status`);

  return { stats, loading, refresh };
}

export type { QueueState, GlobalQueueStats };
