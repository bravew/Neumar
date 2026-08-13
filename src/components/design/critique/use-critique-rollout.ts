import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

export type CritiqueRolloutPhase = 'M0' | 'M1' | 'M2' | 'M3' | 'GA';
export type CritiqueUserOverride = 'auto' | 'on' | 'off';

export interface CritiqueRolloutState {
  phase: CritiqueRolloutPhase;
  rolloutPhase: CritiqueRolloutPhase;
  userOverride: CritiqueUserOverride;
  promotedAt: Partial<Record<CritiqueRolloutPhase, string>>;
  canPromote: boolean;
  canRollback: boolean;
  reason?: string;
  next?: CritiqueRolloutPhase;
}

const DEFAULT_ROLLOUT: CritiqueRolloutState = {
  phase: 'M0',
  rolloutPhase: 'M0',
  userOverride: 'auto',
  promotedAt: {},
  canPromote: true,
  canRollback: false,
  next: 'M1',
};

export function useCritiqueRollout() {
  const [state, setState] = useState<CritiqueRolloutState>(DEFAULT_ROLLOUT);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/design/critique/rollout`, {
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as {
      rollout?: CritiqueRolloutState;
    };
    setState(payload.rollout ?? DEFAULT_ROLLOUT);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    refresh(controller.signal)
      .catch(() => {
        if (!controller.signal.aborted) setState(DEFAULT_ROLLOUT);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);

  const promote = useCallback(async () => {
    await mutateRollout('/promote');
    await refresh();
  }, [refresh]);

  const rollback = useCallback(async () => {
    await mutateRollout('/rollback');
    await refresh();
  }, [refresh]);

  const setOverride = useCallback(
    async (userOverride: CritiqueUserOverride) => {
      const response = await fetch(
        `${API_BASE_URL}/design/critique/rollout/override`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userOverride }),
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await refresh();
    },
    [refresh],
  );

  return {
    ...state,
    storedPhase: state.rolloutPhase,
    loading,
    refresh,
    promote,
    rollback,
    setOverride,
  };
}

async function mutateRollout(path: '/promote' | '/rollback') {
  const response = await fetch(
    `${API_BASE_URL}/design/critique/rollout${path}`,
    { method: 'POST' },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
