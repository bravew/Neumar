import { useCallback, useMemo, useState } from 'react';

import { toast } from 'sonner';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject, VideoTimeline } from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';
import { getProjectTimeline } from '../timeline/projectTimeline';
import { useTimelineEditorStore } from '../timeline/useTimelineEditorStore';
import { targetAspectRatioForProject } from '../timeline/visualAssetFit';
import { ProjectAssetDeleteDialog } from './ProjectAssetDeleteDialog';
import { projectAssetDisplayName } from './projectAssetMedia';

type ProjectAsset = VideoProject['assets'][number];

interface PendingDelete {
  asset: ProjectAsset;
  clipCount: number;
}

/**
 * Guards project-asset deletion: warns before removing an asset that is placed
 * on the timeline, then cascades the removal to the live timeline editor store
 * (the backend strips the persisted clips; this keeps the in-memory editor —
 * which may hold unsaved edits the server response can't overwrite — in sync).
 */
export function useProjectAssetDeletion({
  project,
  actions,
}: {
  project: VideoProject;
  actions: VideoProjectEditorActions;
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.assetsRail.deleteConfirm;
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const editorProjectId = useTimelineEditorStore((state) => state.projectId);
  const editorTimeline = useTimelineEditorStore((state) => state.timeline);
  const removeClipsForAssets = useTimelineEditorStore(
    (state) => state.removeClipsForAssets,
  );
  const aspectRatio = useMemo(
    () => targetAspectRatioForProject(project),
    [project],
  );
  const activeTimeline = useMemo(
    () =>
      editorProjectId === project.id && editorTimeline
        ? editorTimeline
        : getProjectTimeline(project, aspectRatio),
    [aspectRatio, editorProjectId, editorTimeline, project],
  );

  const runDelete = useCallback(
    async (asset: ProjectAsset) => {
      setDeleting(true);
      try {
        await actions.deleteAsset(asset.id);
        // Backend already dropped the persisted clips; mirror that in the live
        // editor store so a timeline with unsaved edits updates immediately.
        removeClipsForAssets([asset.id]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(labels.failed.replace('{message}', message));
      } finally {
        setDeleting(false);
        setPending(null);
      }
    },
    [actions, labels.failed, removeClipsForAssets],
  );

  const requestDelete = useCallback(
    (assetId: string) => {
      const asset = project.assets.find((item) => item.id === assetId);
      if (!asset) return;
      const clipCount = countAssetClips(activeTimeline, assetId);
      if (clipCount === 0) {
        void runDelete(asset);
        return;
      }
      setPending({ asset, clipCount });
    },
    [activeTimeline, project.assets, runDelete],
  );

  const dialog = (
    <ProjectAssetDeleteDialog
      pending={
        pending
          ? {
              assetName: projectAssetDisplayName(pending.asset),
              clipCount: pending.clipCount,
            }
          : null
      }
      deleting={deleting}
      onConfirm={() => pending && void runDelete(pending.asset)}
      onCancel={() => setPending(null)}
    />
  );

  return { requestDelete, dialog };
}

function countAssetClips(timeline: VideoTimeline, assetId: string): number {
  let count = 0;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (
        clip.sourceRef.kind === 'asset' &&
        clip.sourceRef.assetId === assetId
      ) {
        count += 1;
      }
    }
  }
  return count;
}
