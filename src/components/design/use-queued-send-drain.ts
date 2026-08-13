import { useEffect, type MutableRefObject } from 'react';

import {
  markQueuedDesignSendFailed,
  type QueuedDesignSend,
  retryQueuedDesignSend,
} from './queued-design-sends';

type PromptRunResult = { accepted: boolean; error?: string };

/**
 * Drain the persisted queued-send list one item at a time when the project is
 * idle. Extracted from ProjectView to keep that component under the size
 * ceiling; behavior is unchanged.
 */
export function useQueuedSendDrain({
  drainingQueueRef,
  tasksHydrated,
  sending,
  isMonitoringTask,
  activeTaskId,
  queuedSends,
  updateQueuedSends,
  runPrompt,
}: {
  drainingQueueRef: MutableRefObject<boolean>;
  tasksHydrated: boolean;
  sending: boolean;
  isMonitoringTask: () => boolean;
  activeTaskId: string | null;
  queuedSends: QueuedDesignSend[];
  updateQueuedSends: (
    fn: (prev: QueuedDesignSend[]) => QueuedDesignSend[],
  ) => void;
  runPrompt: (prompt: string) => Promise<PromptRunResult>;
}): void {
  useEffect(() => {
    if (
      drainingQueueRef.current ||
      !tasksHydrated ||
      sending ||
      isMonitoringTask() ||
      activeTaskId ||
      queuedSends.length === 0
    ) {
      return;
    }
    const next = queuedSends.find((item) => item.status !== 'failed');
    if (!next) return;
    drainingQueueRef.current = true;
    updateQueuedSends((prev) =>
      prev.map((item) =>
        item.id === next.id ? retryQueuedDesignSend(item) : item,
      ),
    );
    void runPrompt(next.prompt)
      .then((result) => {
        updateQueuedSends((prev) => {
          if (!prev.some((item) => item.id === next.id)) return prev;
          if (result.accepted) {
            return prev.filter((item) => item.id !== next.id);
          }
          return prev.map((item) =>
            item.id === next.id
              ? markQueuedDesignSendFailed(item, result.error)
              : item,
          );
        });
      })
      .finally(() => {
        drainingQueueRef.current = false;
      });
  }, [
    drainingQueueRef,
    activeTaskId,
    queuedSends,
    runPrompt,
    sending,
    tasksHydrated,
    updateQueuedSends,
    isMonitoringTask,
  ]);
}
