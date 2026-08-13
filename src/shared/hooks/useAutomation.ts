/**
 * Automation Hook
 *
 * React hook for automation CRUD operations.
 * Follows the useProviders.ts pattern: separate State/Actions interfaces.
 */

import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import type {
  Automation,
  CreateAutomationInput,
  UpdateAutomationInput,
} from '@/shared/types/automation';

// ============================================================================
// Types
// ============================================================================

export interface UseAutomationsState {
  automations: Automation[];
  loading: boolean;
  error: string | null;
}

export interface UseAutomationsActions {
  create: (input: CreateAutomationInput) => Promise<Automation>;
  update: (id: string, input: UpdateAutomationInput) => Promise<Automation>;
  remove: (id: string) => Promise<void>;
  toggle: (id: string, enabled: boolean) => Promise<Automation>;
  trigger: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export type UseAutomationsReturn = UseAutomationsState & UseAutomationsActions;

// ============================================================================
// Hook
// ============================================================================

export function useAutomations(): UseAutomationsReturn {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAutomations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/automation`);
      const data = await res.json();
      if (data.success) {
        setAutomations(data.data);
      } else {
        setError(data.error ?? 'Failed to fetch automations');
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch automations',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  const create = useCallback(
    async (input: CreateAutomationInput): Promise<Automation> => {
      const res = await fetch(`${API_BASE_URL}/automation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setAutomations((prev) => [...prev, data.data]);
      return data.data;
    },
    [],
  );

  const update = useCallback(
    async (id: string, input: UpdateAutomationInput): Promise<Automation> => {
      const res = await fetch(`${API_BASE_URL}/automation/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setAutomations((prev) => prev.map((a) => (a.id === id ? data.data : a)));
      return data.data;
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<void> => {
    const res = await fetch(`${API_BASE_URL}/automation/${id}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    setAutomations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const toggle = useCallback(
    async (id: string, enabled: boolean): Promise<Automation> => {
      // Optimistic update
      setAutomations((prev) =>
        prev.map((a) => (a.id === id ? { ...a, enabled } : a)),
      );

      const res = await fetch(`${API_BASE_URL}/automation/${id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      if (!data.success) {
        // Revert on failure
        setAutomations((prev) =>
          prev.map((a) => (a.id === id ? { ...a, enabled: !enabled } : a)),
        );
        throw new Error(data.error);
      }
      return data.data;
    },
    [],
  );

  const triggerRun = useCallback(async (id: string): Promise<void> => {
    const res = await fetch(`${API_BASE_URL}/automation/${id}/run`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
  }, []);

  return {
    automations,
    loading,
    error,
    create,
    update,
    remove,
    toggle,
    trigger: triggerRun,
    refresh: fetchAutomations,
  };
}
