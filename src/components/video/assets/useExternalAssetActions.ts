import { useCallback } from 'react';

import { toast } from 'sonner';

import { pickLocalFolder } from '@/components/video/LinkedSourcesPanel';
import { API_BASE_URL } from '@/config';
import { grantFileReadAccess } from '@/shared/lib/tauri-scope';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

type ProjectAsset = VideoProject['assets'][number];

/**
 * The two things you do with a referenced master: take ownership of it, or
 * tell the project where it went.
 */
export function useExternalAssetActions(
  projectId: string,
  onChanged: () => void,
  onProjectUpdated?: (project: VideoProject) => void,
): {
  consolidateAsset: (assetId: string) => Promise<void>;
  relinkAsset: (asset: ProjectAsset) => Promise<void>;
} {
  const { t } = useLanguage();
  const labels = t.video.editor.assetsRail;

  const consolidateAsset = useCallback(
    async (assetId: string) => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/video/projects/${encodeURIComponent(
            projectId,
          )}/assets/${encodeURIComponent(assetId)}/consolidate`,
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
        const body = (await response.json()) as { project?: VideoProject };
        if (body.project) onProjectUpdated?.(body.project);
        toast.success(labels.consolidatedToast);
        onChanged();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [
      labels.consolidatedToast,
      labels.requestFailedToast,
      onChanged,
      onProjectUpdated,
      projectId,
    ],
  );

  const relinkAsset = useCallback(
    async (asset: ProjectAsset) => {
      try {
        const picked = await pickLocalFolder(labels.relinkAsset);
        if (!picked) return;
        await grantFileReadAccess([picked]);
        // The asset's own folder is the "from" root, so picking the folder it
        // moved to repoints every sibling in one step — which is the shape of
        // the problem: whole libraries move, not single files.
        const separatorIndex = Math.max(
          asset.path.lastIndexOf('/'),
          asset.path.lastIndexOf('\\'),
        );
        const from =
          separatorIndex >= 0 ? asset.path.slice(0, separatorIndex) : '';
        const response = await fetch(
          `${API_BASE_URL}/video/projects/${encodeURIComponent(
            projectId,
          )}/assets/relink`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to: picked }),
          },
        );
        if (!response.ok) {
          throw new Error(
            labels.requestFailedToast.replace(
              '{status}',
              String(response.status),
            ),
          );
        }
        const body = (await response.json()) as {
          project?: VideoProject;
          relinked?: number;
        };
        const relinked = body.relinked ?? 0;
        if (relinked === 0) {
          toast.warning(labels.relinkNoneToast);
          return;
        }
        if (body.project) onProjectUpdated?.(body.project);
        toast.success(
          labels.relinkedToast.replace('{count}', String(relinked)),
        );
        onChanged();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [
      labels.relinkAsset,
      labels.relinkNoneToast,
      labels.relinkedToast,
      labels.requestFailedToast,
      onChanged,
      onProjectUpdated,
      projectId,
    ],
  );

  return { consolidateAsset, relinkAsset };
}
