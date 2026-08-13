import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

import type { ComposioConfig } from '../types';

export function useComposioConfig() {
  const [config, setConfig] = useState<ComposioConfig>({
    configured: false,
    apiKeyTail: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/connectors/composio/config`, {
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfig((await res.json()) as ComposioConfig);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const save = useCallback(async (apiKey: string | null) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/connectors/composio/config`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-neuma-admin-origin': 'desktop',
        },
        body: JSON.stringify({ apiKey }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfig((await res.json()) as ComposioConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  return { config, loading, saving, error, save, reload: load };
}
