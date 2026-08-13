/**
 * Marketplace source hooks — catalog sources with user-assigned trust and the
 * merged Available plugin list (dev-doc/plan/07-04-plugin-system checkpoint 5).
 *
 * Backed by `/plugins/marketplaces` and `/plugins/marketplaces/available`.
 * Every fetch is AbortController-scoped for React 19 StrictMode safety.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';

export type MarketplaceSourceTrust = 'official' | 'restricted';

export interface MarketplaceSource {
  id: string;
  name: string;
  url: string;
  trust: MarketplaceSourceTrust;
  catalogVersion: string | null;
  pluginCount: number | null;
  lastRefreshedAt: string | null;
  createdAt: string;
  fetchError?: string;
}

export interface AvailableCatalogEntry {
  name: string;
  description: string;
  version?: string;
  displayName?: string;
  license?: string;
  category?: string;
  homepage?: string;
  tags?: string[];
  keywords?: string[];
  author?: string | { name: string; url?: string };
  source: string | Record<string, unknown>;
  metadata?: {
    neuma?: {
      surfaces?: string[];
      capabilitiesSummary?: string[];
    };
  };
}

export interface AvailablePluginEntry {
  sourceId: string;
  sourceName: string;
  sourceTrust: MarketplaceSourceTrust;
  sourceUrl: string;
  entry: AvailableCatalogEntry;
}

export interface PluginInspection {
  inspectable: boolean;
  skills: { name: string; description: string; path: string }[];
  evals?: { count: number; cases: string[] };
  readme?: string;
  workflow?: {
    mode?: string;
    scenario?: string;
    kind?: string;
    inputs?: string[];
    pipeline?: string[];
    capabilities?: string[];
  };
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const msg = (data.error as string) || (data.message as string);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return data as T;
}

export interface UseMarketplaceSourcesResult {
  sources: MarketplaceSource[];
  loading: boolean;
  error: string | null;
  actionPending: boolean;
  refresh: () => void;
  addSource: (input: {
    url: string;
    trust: MarketplaceSourceTrust;
    name?: string;
  }) => Promise<MarketplaceSource>;
  refreshSource: (id: string) => Promise<MarketplaceSource>;
  removeSource: (id: string) => Promise<void>;
}

export function useMarketplaceSources(): UseMarketplaceSourcesResult {
  const [sources, setSources] = useState<MarketplaceSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [tick, setTick] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/plugins/marketplaces`, {
          signal: ac.signal,
        });
        const data = await parseJsonResponse<{ sources: MarketplaceSource[] }>(
          res,
        );
        if (!cancelled) setSources(data.sources ?? []);
      } catch (err) {
        if (cancelled || ac.signal.aborted) return;
        setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const runAction = useCallback(
    async <T>(url: string, init: RequestInit): Promise<T> => {
      setActionPending(true);
      try {
        const res = await fetch(url, init);
        return await parseJsonResponse<T>(res);
      } finally {
        if (mountedRef.current) setActionPending(false);
      }
    },
    [],
  );

  const addSource = useCallback(
    async (input: {
      url: string;
      trust: MarketplaceSourceTrust;
      name?: string;
    }) => {
      const data = await runAction<{ source: MarketplaceSource }>(
        `${API_BASE_URL}/plugins/marketplaces`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      );
      refresh();
      return data.source;
    },
    [refresh, runAction],
  );

  const refreshSource = useCallback(
    async (id: string) => {
      const data = await runAction<{ source: MarketplaceSource }>(
        `${API_BASE_URL}/plugins/marketplaces/${encodeURIComponent(id)}/refresh`,
        { method: 'POST' },
      );
      refresh();
      return data.source;
    },
    [refresh, runAction],
  );

  const removeSource = useCallback(
    async (id: string) => {
      await runAction<{ ok: boolean }>(
        `${API_BASE_URL}/plugins/marketplaces/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      refresh();
    },
    [refresh, runAction],
  );

  return {
    sources,
    loading,
    error,
    actionPending,
    refresh,
    addSource,
    refreshSource,
    removeSource,
  };
}

/**
 * Fetch pre-install inspection (skills, evals, workflow, README) for a catalog
 * entry. Fetches when `sourceId`/`entryName` are set; clears otherwise.
 */
export function usePluginInspection(
  sourceId: string | null,
  entryName: string | null,
): {
  inspection: PluginInspection | null;
  loading: boolean;
  error: string | null;
} {
  const [inspection, setInspection] = useState<PluginInspection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId || !entryName) {
      setInspection(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    setInspection(null);
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/plugins/marketplaces/${encodeURIComponent(
            sourceId,
          )}/inspect?entry=${encodeURIComponent(entryName)}`,
          { signal: ac.signal },
        );
        const data = await parseJsonResponse<{ inspection: PluginInspection }>(
          res,
        );
        if (!cancelled) setInspection(data.inspection);
      } catch (err) {
        if (cancelled || ac.signal.aborted) return;
        setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [sourceId, entryName]);

  return { inspection, loading, error };
}

export interface UseAvailablePluginsResult {
  entries: AvailablePluginEntry[];
  sources: MarketplaceSource[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useAvailablePlugins(): UseAvailablePluginsResult {
  const [entries, setEntries] = useState<AvailablePluginEntry[]>([]);
  const [sources, setSources] = useState<MarketplaceSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/plugins/marketplaces/available`,
          { signal: ac.signal },
        );
        const data = await parseJsonResponse<{
          entries: AvailablePluginEntry[];
          sources: MarketplaceSource[];
        }>(res);
        if (!cancelled) {
          setEntries(data.entries ?? []);
          setSources(data.sources ?? []);
        }
      } catch (err) {
        if (cancelled || ac.signal.aborted) return;
        setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { entries, sources, loading, error, refresh };
}
