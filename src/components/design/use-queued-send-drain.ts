import {
  useEffect,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
} from 'react';

import {
  markQueuedDesignSendFailed,
  type QueuedDesignSend,
  retryQueuedDesignSend,
} from './queued-design-sends';

type PromptRunResult = { accepted: boolean; error?: string };

/** Ids of queued sends whose request is in flight. Never persisted. */
function createInFlightStore() {
  let ids: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => ids,
    set(id: string, inFlight: boolean) {
      if (ids.has(id) === inFlight) return;
      const next = new Set(ids);
      if (inFlight) next.add(id);
      else next.delete(id);
      ids = next;
      listeners.forEach((listener) => listener());
    },
  };
}

/**
 * Drain the persisted queued-send list one item at a time when the project is
 * idle. A card is hidden as soon as its send starts. The durable item stays
 * until the send is accepted, and a rejection restores the original draft.
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
}): ReadonlySet<string> {
  const [store] = useState(createInFlightStore);
  const sendingIds = useSyncExternalStore(store.subscribe, store.snapshot);

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
    const next = queuedSends.find(
      (item) => item.status !== 'failed' && !sendingIds.has(item.id),
    );
    if (!next) return;
    const itemId = next.id;
    drainingQueueRef.current = true;
    store.set(itemId, true);
    updateQueuedSends((prev) =>
      prev.map((item) =>
        item.id === itemId ? retryQueuedDesignSend(item) : item,
      ),
    );
    // The effect re-runs while this request is in flight, so the settled
    // request must not depend on that run. It alone resolves the durable item.
    void runPrompt(next.prompt).then(
      (result) => {
        updateQueuedSends((prev) => {
          if (!prev.some((item) => item.id === itemId)) return prev;
          if (result.accepted) {
            return prev.filter((item) => item.id !== itemId);
          }
          return prev.map((item) =>
            item.id === itemId
              ? markQueuedDesignSendFailed(
                  retryQueuedDesignSend(item),
                  result.error,
                )
              : item,
          );
        });
        store.set(itemId, false);
        drainingQueueRef.current = false;
      },
      () => {
        store.set(itemId, false);
        drainingQueueRef.current = false;
      },
    );
  }, [
    sendingIds,
    drainingQueueRef,
    activeTaskId,
    queuedSends,
    runPrompt,
    sending,
    tasksHydrated,
    isMonitoringTask,
    store,
    updateQueuedSends,
  ]);

  return sendingIds;
}
