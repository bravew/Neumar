import { useCallback } from 'react';

import { toast } from 'sonner';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

/** Opens the OS file manager on an asset's own master file. */
export function useRevealProjectAsset(
  projectId: string,
): (assetId: string) => Promise<void> {
  const { t } = useLanguage();
  const labels = t.video.editor.assetsRail;

  return useCallback(
    async (assetId: string) => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/video/projects/${encodeURIComponent(
            projectId,
          )}/assets/${encodeURIComponent(assetId)}/reveal`,
          { method: 'POST' },
        );
        if (!response.ok) {
          throw new Error(
            labels.requestFailedToast.replace(
              '{status}',
              String(response.status),
            ),
          );
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [labels.requestFailedToast, projectId],
  );
}
