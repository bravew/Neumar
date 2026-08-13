import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import type { AssetSource } from '@/shared/assets/types';

interface ConnectionRow {
  provider: string;
  status?: string | null;
}

interface ConnectionsResponse {
  items?: ConnectionRow[];
}

// Asset sources that need an account/credentials before they can return
// results. Local sources (`local_fs`, `ai_gen`) and Openverse (which has a
// public unauthenticated API) are always usable, so they are excluded. Every
// other cloud or stock provider needs a connection — either OAuth (Drive,
// Box, …) or an API key (Unsplash, Pexels, Pixabay, Coverr, Videvo).
const CLOUD_CONFIG_SOURCES = new Set<AssetSource>([
  'immich',
  'photoprism',
  'google_drive',
  'dropbox',
  'box',
  'onedrive',
  's3_compatible',
  'unsplash',
  'pexels',
  'pixabay',
  'coverr',
  'videvo',
]);

export function isConfigurableSource(source: AssetSource): boolean {
  return CLOUD_CONFIG_SOURCES.has(source);
}

// Returns the set of asset sources the user has at least one active
// connection for. Reads `/cloud-storage/connections` and indexes by provider.
// `null` means we haven't loaded yet — render as "unknown", not "missing".
export function useConfiguredAssetSources(): Set<AssetSource> | null {
  const [configured, setConfigured] = useState<Set<AssetSource> | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${API_BASE_URL}/cloud-storage/connections`, { signal: ctrl.signal })
      .then((res) =>
        res.ok ? (res.json() as Promise<ConnectionsResponse>) : null,
      )
      .then((body) => {
        if (ctrl.signal.aborted) return;
        const next = new Set<AssetSource>();
        for (const item of body?.items ?? []) {
          if (item.status && item.status !== 'active') continue;
          next.add(item.provider as AssetSource);
        }
        setConfigured(next);
      })
      .catch((error) => {
        if (ctrl.signal.aborted) return;
        if (
          import.meta.env.DEV &&
          (error as { name?: string }).name !== 'AbortError'
        ) {
          console.error('Failed to load configured asset sources:', error);
        }
        setConfigured(new Set());
      });
    return () => ctrl.abort();
  }, []);

  return configured;
}
