import { useCallback, useEffect, useState } from 'react';

import type { DesignMdState } from '@/shared/types/design-mode';

import { getDesignMdState } from './useDesignMode';

const INITIAL_STATE: DesignMdState = {
  exists: false,
  generatedAt: null,
  transcriptMessageCount: null,
  designSystemId: null,
  currentArtifact: null,
  isStale: false,
  staleReason: null,
};

export function useDesignMdState(projectId: string, refreshKey = 0) {
  const [state, setState] = useState<DesignMdState>(INITIAL_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const result = await getDesignMdState(projectId, { signal });
        if (signal?.aborted) return;
        setState(result.state ?? INITIAL_STATE);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setState(INITIAL_STATE);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    const ac = new AbortController();
    void refresh(ac.signal);
    return () => ac.abort();
  }, [refresh, refreshKey]);

  return { ...state, loading, error, refresh };
}
