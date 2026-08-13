import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

import type { ConnectorDetail } from '../types';

export function useConnectorDetail(connectorId: string | null) {
  const [detail, setDetail] = useState<ConnectorDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!connectorId) {
      setDetail(null);
      setError('');
      return;
    }

    const ac = new AbortController();
    let poll: number | undefined;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE_URL}/connectors/${connectorId}`, {
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()) as ConnectorDetail;
        setDetail(next);
        if (next.status === 'pending') {
          poll = window.setTimeout(load, 2000);
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }

    void load();

    const reload = () => void load();
    window.addEventListener('focus', reload);
    window.addEventListener('connector-connection-changed', reload);

    return () => {
      ac.abort();
      window.removeEventListener('focus', reload);
      window.removeEventListener('connector-connection-changed', reload);
      if (poll) window.clearTimeout(poll);
    };
  }, [connectorId]);

  return { detail, loading, error };
}
