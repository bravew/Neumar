import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

import type { ConnectorDetail } from '../types';

export interface ConnectorCatalogState {
  connectors: ConnectorDetail[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

export function useConnectorCatalog(): ConnectorCatalogState {
  const [connectors, setConnectors] = useState<ConnectorDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (force = false, signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const endpoint = force ? '/connectors/discovery' : '/connectors';
      const res = await fetch(`${API_BASE_URL}${endpoint}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { connectors: ConnectorDetail[] };
      setConnectors(body.connectors ?? []);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(false, ac.signal);
    return () => ac.abort();
  }, [load]);

  // Reconcile connector statuses when the window regains focus (covers the
  // OAuth-popup-closed case) and when any auth launcher signals a connection
  // change via the custom event below.
  useEffect(() => {
    const reconcile = () => void load(false);
    window.addEventListener('focus', reconcile);
    window.addEventListener('connector-connection-changed', reconcile);
    return () => {
      window.removeEventListener('focus', reconcile);
      window.removeEventListener('connector-connection-changed', reconcile);
    };
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { connectors, loading, error, refresh };
}
