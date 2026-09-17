import { useEffect } from 'react';

import type { VideoReferenceRun } from '@/shared/types/video';

import { runIsActive, useReferenceStudyStore } from './useReferenceStudyStore';

const POLL_INTERVAL_MS = 2000;

interface UseReferenceRunPollingInput {
  referenceIds: string[];
  getRun: (referenceId: string) => Promise<VideoReferenceRun | null>;
  /** Re-reads every known run once the agent stops streaming. */
  agentStreaming: boolean;
}

/**
 * Keeps the Reference tab's run state live.
 *
 * System steps advance server-side and agent steps advance through the chat's
 * tool calls, so neither writes back to this panel on its own — the panel polls
 * while a run is active and re-reads once an agent turn ends.
 */
export function useReferenceRunPolling({
  referenceIds,
  getRun,
  agentStreaming,
}: UseReferenceRunPollingInput) {
  const runs = useReferenceStudyStore((state) => state.runs);
  const setRun = useReferenceStudyStore((state) => state.setRun);
  // Join to primitives so the effects restart only when the id sets really
  // change, not on every poll that replaces the runs object.
  const activeKey = referenceIds
    .filter((id) => runIsActive(runs[id]))
    .join(',');
  const knownKey = referenceIds.join(',');

  useEffect(() => {
    if (!activeKey) return;
    let cancelled = false;
    const ids = activeKey.split(',');
    const tick = () => {
      for (const referenceId of ids) {
        void getRun(referenceId).then((run) => {
          if (!cancelled && run) setRun(run);
        });
      }
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeKey, getRun, setRun]);

  useEffect(() => {
    if (agentStreaming || !knownKey) return;
    let cancelled = false;
    for (const referenceId of knownKey.split(',')) {
      void getRun(referenceId).then((run) => {
        if (!cancelled && run) setRun(run);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [agentStreaming, knownKey, getRun, setRun]);
}
