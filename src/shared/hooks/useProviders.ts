/**
 * Providers Hook
 *
 * React hook for managing sandbox and agent providers.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  getAgentProviders,
  getSandboxProviders,
  switchAgentProvider,
  switchSandboxProvider,
  syncSettings,
  type AgentProviderMetadata,
  type SandboxProviderMetadata,
} from '@/shared/lib/api/providers';

// ============================================================================
// Types
// ============================================================================

export interface UseProvidersState {
  /** Sandbox providers list */
  sandboxProviders: SandboxProviderMetadata[];
  /** Agent providers list */
  agentProviders: AgentProviderMetadata[];
  /** Current sandbox provider type */
  currentSandbox: string | null;
  /** Current agent provider type */
  currentAgent: string | null;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: string | null;
}

export interface UseProvidersActions {
  /** Switch sandbox provider */
  switchSandbox: (
    type: string,
    config?: Record<string, unknown>,
  ) => Promise<void>;
  /** Switch agent provider */
  switchAgent: (
    type: string,
    config?: Record<string, unknown>,
  ) => Promise<void>;
  /** Refresh provider lists */
  refresh: () => Promise<void>;
  /** Sync settings with backend */
  sync: (settings: {
    sandboxProvider?: string;
    sandboxConfig?: Record<string, unknown>;
    agentProvider?: string;
    agentConfig?: Record<string, unknown>;
  }) => Promise<void>;
}

export type UseProvidersReturn = UseProvidersState & UseProvidersActions;

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing providers
 */
export function useProviders(): UseProvidersReturn {
  const [sandboxProviders, setSandboxProviders] = useState<
    SandboxProviderMetadata[]
  >([]);
  const [agentProviders, setAgentProviders] = useState<AgentProviderMetadata[]>(
    [],
  );
  const [currentSandbox, setCurrentSandbox] = useState<string | null>(null);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch all providers
   */
  const fetchProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [sandboxData, agentData] = await Promise.all([
        getSandboxProviders(),
        getAgentProviders(),
      ]);

      setSandboxProviders(sandboxData.providers as SandboxProviderMetadata[]);
      setAgentProviders(agentData.providers as AgentProviderMetadata[]);
      setCurrentSandbox(sandboxData.current);
      setCurrentAgent(agentData.current);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch providers';
      setError(message);
      console.error('[useProviders] Error fetching providers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Switch sandbox provider
   */
  const switchSandbox = useCallback(
    async (type: string, config?: Record<string, unknown>) => {
      try {
        setError(null);
        await switchSandboxProvider(type, config);
        setCurrentSandbox(type);

        // Update the providers list to reflect the change
        setSandboxProviders((prev) =>
          prev.map((p) => ({
            ...p,
            current: p.type === type,
          })),
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to switch sandbox provider';
        setError(message);
        throw err;
      }
    },
    [],
  );

  /**
   * Switch agent provider
   */
  const switchAgent = useCallback(
    async (type: string, config?: Record<string, unknown>) => {
      try {
        setError(null);
        await switchAgentProvider(type, config);
        setCurrentAgent(type);

        // Update the providers list to reflect the change
        setAgentProviders((prev) =>
          prev.map((p) => ({
            ...p,
            current: p.type === type,
          })),
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to switch agent provider';
        setError(message);
        throw err;
      }
    },
    [],
  );

  /**
   * Sync settings with backend
   */
  const sync = useCallback(
    async (settings: {
      sandboxProvider?: string;
      sandboxConfig?: Record<string, unknown>;
      agentProvider?: string;
      agentConfig?: Record<string, unknown>;
    }) => {
      try {
        setError(null);
        const config = await syncSettings(settings);

        if (config.sandbox) {
          setCurrentSandbox(config.sandbox.type);
        }
        if (config.agent) {
          setCurrentAgent(config.agent.type);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to sync settings';
        setError(message);
        throw err;
      }
    },
    [],
  );

  /**
   * Refresh provider lists
   */
  const refresh = useCallback(async () => {
    await fetchProviders();
  }, [fetchProviders]);

  // Initial fetch
  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  return {
    sandboxProviders,
    agentProviders,
    currentSandbox,
    currentAgent,
    loading,
    error,
    switchSandbox,
    switchAgent,
    refresh,
    sync,
  };
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook for just sandbox providers
 */
export function useSandboxProviders() {
  const {
    sandboxProviders,
    currentSandbox,
    loading,
    error,
    switchSandbox,
    refresh,
  } = useProviders();

  return {
    providers: sandboxProviders,
    current: currentSandbox,
    loading,
    error,
    switchProvider: switchSandbox,
    refresh,
  };
}

/**
 * Hook for just agent providers
 */
export function useAgentProviders() {
  const { agentProviders, currentAgent, loading, error, switchAgent, refresh } =
    useProviders();

  return {
    providers: agentProviders,
    current: currentAgent,
    loading,
    error,
    switchProvider: switchAgent,
    refresh,
  };
}
