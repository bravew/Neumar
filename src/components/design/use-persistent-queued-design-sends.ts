import { useCallback, useEffect, useState } from 'react';

import {
  loadQueuedDesignSends,
  persistQueuedDesignSends,
  type QueuedDesignSend,
} from './queued-design-sends';

export function usePersistentQueuedDesignSends(projectId: string) {
  const [state, setState] = useState<{
    projectId: string;
    items: QueuedDesignSend[];
  }>(() => ({
    projectId,
    items: loadQueuedDesignSends(projectId),
  }));

  const queuedSends = state.projectId === projectId ? state.items : [];

  useEffect(() => {
    setState((prev) => {
      if (prev.projectId === projectId) return prev;
      return {
        projectId,
        items: loadQueuedDesignSends(projectId),
      };
    });
  }, [projectId]);

  useEffect(() => {
    if (state.projectId !== projectId) return;
    persistQueuedDesignSends(projectId, state.items);
  }, [projectId, state]);

  const updateQueuedSends = useCallback(
    (updater: (prev: QueuedDesignSend[]) => QueuedDesignSend[]) => {
      setState((prev) => {
        const current =
          prev.projectId === projectId
            ? prev.items
            : loadQueuedDesignSends(projectId);
        return { projectId, items: updater(current) };
      });
    },
    [projectId],
  );

  return { queuedSends, updateQueuedSends };
}
