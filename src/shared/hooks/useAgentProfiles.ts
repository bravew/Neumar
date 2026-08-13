/**
 * Hook to fetch and cache agent profiles from the backend.
 * Used by ProfileAssignment dropdown and Home page profile selector.
 */

import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import type { AgentProfile } from '@/shared/types/agent-profile';

// Module-level cache keyed by status filter — supports concurrent components
// with different filters without stomping each other.
interface CacheEntry {
  profiles: AgentProfile[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000; // 30 seconds

function getCached(filter: string): AgentProfile[] | null {
  const entry = cache.get(filter);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.profiles;
  }
  return null;
}

export function useAgentProfiles(statusFilter: string = 'active') {
  const [profiles, setProfiles] = useState<AgentProfile[]>(
    () => getCached(statusFilter) ?? [],
  );
  const [loading, setLoading] = useState(
    () => getCached(statusFilter) === null,
  );
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    const cached = getCached(statusFilter);
    if (cached) {
      setProfiles(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const ac = new AbortController();

    (async () => {
      try {
        const url = statusFilter
          ? `${API_BASE_URL}/db/agent-profiles?status=${statusFilter}`
          : `${API_BASE_URL}/db/agent-profiles`;
        const res = await fetch(url, { signal: ac.signal });
        if (cancelled || !res.ok) return;

        const list: AgentProfile[] = await res.json();
        if (cancelled) return;

        cache.set(statusFilter, { profiles: list, timestamp: Date.now() });
        setProfiles(list);
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [fetchKey, statusFilter]);

  /** Force refresh the cache for this filter and re-fetch. */
  const refresh = useCallback(() => {
    cache.delete(statusFilter);
    setFetchKey((k) => k + 1);
  }, [statusFilter]);

  return { profiles, loading, refresh };
}

/** Invalidate all cached entries from outside the hook. */
export function invalidateProfilesCache() {
  cache.clear();
}
