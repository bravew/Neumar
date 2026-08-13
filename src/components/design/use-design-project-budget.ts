import { useCallback, useEffect, useState } from 'react';

import { getDesignCapabilities } from '@/shared/hooks/useDesignMode';
import type { DesignBudgetStatus } from '@/shared/types/design-mode';

export function useDesignProjectBudget(projectId: string) {
  const [budget, setBudget] = useState<DesignBudgetStatus | null>(null);

  const refreshBudget = useCallback(async () => {
    try {
      const data = await getDesignCapabilities(projectId);
      setBudget(data.budget);
    } catch {
      setBudget(null);
    }
  }, [projectId]);

  useEffect(() => {
    const ac = new AbortController();
    getDesignCapabilities(projectId, { signal: ac.signal })
      .then((data) => {
        if (!ac.signal.aborted) setBudget(data.budget);
      })
      .catch(() => {
        if (!ac.signal.aborted) setBudget(null);
      });
    return () => ac.abort();
  }, [projectId]);

  return { budget, refreshBudget };
}
