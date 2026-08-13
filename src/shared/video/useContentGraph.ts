import { useCallback, useEffect, useRef, useState } from 'react';

import type { ContentGraph } from '@neumar/video-ir';

import { API_BASE_URL } from '@/config';

// Phase 6 M3 — fetch + persist a project's content-graph for the frames strip
// and the read-only viewer. The server owns persistence; topo ordering and
// duration are computed on the client from `@neumar/video-ir`.

export interface UseContentGraphResult {
  graph: ContentGraph | null;
  loading: boolean;
  error: string | null;
  /** Re-fetch from the server. */
  refetch: () => void;
  /** Persist an edited graph (PUT). Resolves to the saved graph. */
  save: (next: ContentGraph) => Promise<ContentGraph>;
}

export function useContentGraph(
  projectId: string | null,
): UseContentGraphResult {
  const [graph, setGraph] = useState<ContentGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // `save()` is imperative (it returns the graph to the caller), so it can't
  // use the effect's AbortController. Track the in-flight mutation so it is
  // cancelled on unmount, and guard setGraph against late resolution.
  const mountedRef = useRef(true);
  const saveAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveAbortRef.current?.abort();
    };
  }, []);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!projectId) {
      setGraph(null);
      setLoading(false);
      setError(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/content-graph`,
          { signal: ac.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { graph: ContentGraph | null };
        if (ac.signal.aborted) return;
        setGraph(json.graph);
        setLoading(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [projectId, reloadKey]);

  const save = useCallback(
    async (next: ContentGraph): Promise<ContentGraph> => {
      if (!projectId) throw new Error('No project selected');
      // Supersede any in-flight save and let unmount cancel this one.
      saveAbortRef.current?.abort();
      const ac = new AbortController();
      saveAbortRef.current = ac;
      const res = await fetch(
        `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/content-graph`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graph: next }),
          signal: ac.signal,
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { graph: ContentGraph };
      if (mountedRef.current && !ac.signal.aborted) setGraph(json.graph);
      return json.graph;
    },
    [projectId],
  );

  return { graph, loading, error, refetch, save };
}
