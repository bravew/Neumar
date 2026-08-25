import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import type { VideoProject } from '@/shared/types/video';

interface ExternalAssetStatus {
  assetId: string;
  path: string;
  online: boolean;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Ids of assets whose external master could not be found.
 *
 * A referenced master lives on the user's own disk, so it can be renamed,
 * moved, or sit on a volume that isn't mounted. The check is a stat per
 * external asset, and runs only for projects that actually have some.
 */
export function useExternalAssetStatus(
  projectId: string,
  assets: VideoProject['assets'],
): { offlineAssetIds: ReadonlySet<string>; refresh: () => void } {
  const [offlineAssetIds, setOfflineAssetIds] =
    useState<ReadonlySet<string>>(EMPTY);
  const [reloadKey, setReloadKey] = useState(0);
  const hasExternal = assets.some((asset) => asset.origin === 'external');

  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    if (!hasExternal) {
      setOfflineAssetIds(EMPTY);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/video/projects/${encodeURIComponent(
            projectId,
          )}/assets/external-status`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const body = (await response.json()) as {
          assets?: ExternalAssetStatus[];
        };
        if (controller.signal.aborted) return;
        setOfflineAssetIds(
          new Set(
            (body.assets ?? [])
              .filter((entry) => !entry.online)
              .map((entry) => entry.assetId),
          ),
        );
      } catch {
        // A failed check says nothing about the files; leave the last answer.
      }
    })();
    return () => controller.abort();
  }, [projectId, hasExternal, reloadKey, assets.length]);

  return { offlineAssetIds, refresh };
}
