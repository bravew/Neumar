/**
 * Automation Runs Hook
 *
 * React hook for automation run history with auto-polling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';
import type { AutomationRun } from '@/shared/types/automation';

/** Polling interval when active runs exist */
const ACTIVE_RUN_POLL_INTERVAL_MS = 5_000;

// ============================================================================
// Types
// ============================================================================

export interface UseAutomationRunsState {
  runs: AutomationRun[];
  loading: boolean;
  error: string | null;
}

export interface UseAutomationRunsActions {
  cancel: (runId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export type UseAutomationRunsReturn = UseAutomationRunsState &
  UseAutomationRunsActions;

// ============================================================================
// Hook
// ============================================================================

export function useAutomationRuns(
  automationId: string | null,
): UseAutomationRunsReturn {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async () => {
    if (!automationId) return;
    try {
      setError(null);
      const res = await fetch(
        `${API_BASE_URL}/automation/${automationId}/runs`,
      );
      if (!res.ok) {
        setError(`Server error: ${res.status}`);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setRuns(data.data);
      } else {
        setError(data.error ?? 'Failed to fetch runs');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch runs');
    } finally {
      setLoading(false);
    }
  }, [automationId]);

  // Initial fetch
  useEffect(() => {
    if (automationId) {
      setLoading(true);
      fetchRuns();
    } else {
      setRuns([]);
      setLoading(false);
    }
  }, [automationId, fetchRuns]);

  // Derive a stable boolean to avoid re-creating the interval on every fetch
  const hasActiveRun = useMemo(
    () =>
      runs.some((r) =>
        ['queued', 'planning', 'executing', 'awaiting_approval'].includes(
          r.status,
        ),
      ),
    [runs],
  );

  // Auto-poll when there are active runs
  useEffect(() => {
    if (!hasActiveRun) return;

    pollRef.current = setInterval(fetchRuns, ACTIVE_RUN_POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [hasActiveRun, fetchRuns]);

  const cancel = useCallback(
    async (runId: string): Promise<void> => {
      const res = await fetch(
        `${API_BASE_URL}/automation/runs/${runId}/cancel`,
        {
          method: 'POST',
        },
      );
      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      // Refresh runs to get updated status
      await fetchRuns();
    },
    [fetchRuns],
  );

  return {
    runs,
    loading,
    error,
    cancel,
    refresh: fetchRuns,
  };
}
