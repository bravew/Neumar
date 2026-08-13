import { useCallback, useEffect, useRef, useState } from 'react';

import {
  cancelAgentRuntimeOperation,
  getAgentRuntimeOperation,
  listAgentRuntimes,
  rescanAgentRuntimes,
  startAgentRuntimeOperation,
  testAgentRuntimeConnection,
  type AgentRuntimeStatus,
  type CatalogEntry,
  type OperationRecord,
  type RuntimeConnectionTestResult,
} from '@/shared/lib/api/agent-runtimes';

interface UseAgentRuntimesState {
  loading: boolean;
  error: string | null;
  runtimes: AgentRuntimeStatus[];
  catalog: CatalogEntry[];
  platform: string | null;
  rescanning: boolean;
  operations: Record<string, OperationRecord>;
  connectionTests: Record<string, RuntimeConnectionTestResult>;
  testingConnections: Record<string, boolean>;
}

const REVALIDATE_MS = 30_000;

export function useAgentRuntimes() {
  const [state, setState] = useState<UseAgentRuntimesState>({
    loading: true,
    error: null,
    runtimes: [],
    catalog: [],
    platform: null,
    rescanning: false,
    operations: {},
    connectionTests: {},
    testingConnections: {},
  });

  const pollersRef = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const pollAbortersRef = useRef(new Map<string, AbortController>());
  const loadAbortersRef = useRef(new Set<AbortController>());

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await listAgentRuntimes(signal);
      if (signal?.aborted) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: null,
        runtimes: data.runtimes,
        catalog: data.catalog,
        platform: data.platform,
      }));
    } catch (err) {
      if (signal?.aborted) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: (err as Error).message,
      }));
    }
  }, []);

  useEffect(() => {
    const aborters = loadAbortersRef.current;
    const initial = new AbortController();
    aborters.add(initial);
    void load(initial.signal).finally(() => aborters.delete(initial));
    const id = setInterval(() => {
      const tick = new AbortController();
      aborters.add(tick);
      void load(tick.signal).finally(() => aborters.delete(tick));
    }, REVALIDATE_MS);
    return () => {
      clearInterval(id);
      for (const c of aborters) c.abort();
      aborters.clear();
    };
  }, [load]);

  const rescan = useCallback(async () => {
    setState((prev) => ({ ...prev, rescanning: true }));
    try {
      const data = await rescanAgentRuntimes();
      setState((prev) => ({
        ...prev,
        rescanning: false,
        error: null,
        runtimes: data.runtimes,
        catalog: data.catalog,
        platform: data.platform,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        rescanning: false,
        error: (err as Error).message,
      }));
    }
  }, []);

  // Stop tracking the operation: stop polling, drop from state.
  const dropOperation = useCallback((operationId: string) => {
    const poller = pollersRef.current.get(operationId);
    if (poller) {
      clearInterval(poller);
      pollersRef.current.delete(operationId);
    }
    const aborter = pollAbortersRef.current.get(operationId);
    if (aborter) {
      aborter.abort();
      pollAbortersRef.current.delete(operationId);
    }
    setState((prev) => {
      if (!prev.operations[operationId]) return prev;
      const next = { ...prev.operations };
      delete next[operationId];
      return { ...prev, operations: next };
    });
  }, []);

  const pollOperation = useCallback((operationId: string) => {
    if (pollersRef.current.has(operationId)) return;
    const aborter = new AbortController();
    pollAbortersRef.current.set(operationId, aborter);
    const poll = async () => {
      if (aborter.signal.aborted) return;
      try {
        const { operation } = await getAgentRuntimeOperation(
          operationId,
          aborter.signal,
        );
        if (aborter.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          operations: { ...prev.operations, [operationId]: operation },
          // If the runtime was refreshed by the server, splice it in.
          runtimes: operation.refreshedStatus
            ? prev.runtimes.map((r) =>
                r.id === operation.refreshedStatus!.id
                  ? operation.refreshedStatus!
                  : r,
              )
            : prev.runtimes,
        }));
        if (
          operation.status === 'completed' ||
          operation.status === 'failed' ||
          operation.status === 'cancelled'
        ) {
          const poller = pollersRef.current.get(operationId);
          if (poller) {
            clearInterval(poller);
            pollersRef.current.delete(operationId);
          }
          pollAbortersRef.current.delete(operationId);
        }
      } catch {
        // swallow; next tick may succeed
      }
    };
    void poll();
    const id = setInterval(poll, 1500);
    pollersRef.current.set(operationId, id);
  }, []);

  const startOperation = useCallback(
    async (params: {
      agentId: string;
      intent: 'install' | 'update';
      optionId: string;
      confirmedCommandHash: string;
    }) => {
      const { operation } = await startAgentRuntimeOperation(params);
      setState((prev) => ({
        ...prev,
        operations: { ...prev.operations, [operation.id]: operation },
      }));
      pollOperation(operation.id);
      return operation;
    },
    [pollOperation],
  );

  const cancelOperation = useCallback(async (operationId: string) => {
    try {
      await cancelAgentRuntimeOperation(operationId);
    } catch {
      // ignore
    }
  }, []);

  const testConnection = useCallback(async (agentId: string) => {
    setState((prev) => ({
      ...prev,
      testingConnections: { ...prev.testingConnections, [agentId]: true },
    }));
    try {
      const { result } = await testAgentRuntimeConnection(agentId);
      setState((prev) => ({
        ...prev,
        connectionTests: { ...prev.connectionTests, [agentId]: result },
        testingConnections: { ...prev.testingConnections, [agentId]: false },
        runtimes: prev.runtimes.map((runtime) =>
          runtime.id === result.runtime.id ? result.runtime : runtime,
        ),
      }));
      return result;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        testingConnections: { ...prev.testingConnections, [agentId]: false },
      }));
      throw err;
    }
  }, []);

  useEffect(() => {
    const pollers = pollersRef.current;
    const aborters = pollAbortersRef.current;
    return () => {
      for (const poller of pollers.values()) clearInterval(poller);
      pollers.clear();
      for (const aborter of aborters.values()) aborter.abort();
      aborters.clear();
    };
  }, []);

  return {
    ...state,
    rescan,
    startOperation,
    cancelOperation,
    dropOperation,
    testConnection,
  };
}
