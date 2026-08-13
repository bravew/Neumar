import { useEffect, useMemo } from 'react';

import { useAssetMaterializationEvents } from '@/shared/hooks/useAssetMaterializationEvents';
import type { VideoProject } from '@/shared/types/video';

import { hydratedDroppedAssetDurationPatch } from './droppedAssetClip';
import type { useTimelineEditorBindings } from './useTimelineEditorStore';

interface TimelineAssetMaterializationSyncParams {
  project: VideoProject;
  editor: ReturnType<typeof useTimelineEditorBindings>;
}

export function useTimelineAssetMaterializationSync({
  project,
  editor,
}: TimelineAssetMaterializationSyncParams) {
  // Shared per-project session id (see ProjectAssetsSection): the timeline and
  // the assets panel ride one SSE connection rather than opening two.
  const materializationSessionId = `video-materialize-${project.id}`;
  const materializationStates = useAssetMaterializationEvents(
    materializationSessionId,
  );
  const assetsById = useMemo(
    () => new Map(project.assets.map((asset) => [asset.id, asset])),
    [project.assets],
  );
  const { projectId, timeline, updateClip } = editor;

  useEffect(() => {
    if (projectId !== project.id || !timeline) return;
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.sourceRef.kind !== 'asset') continue;
        const asset = assetsById.get(clip.sourceRef.assetId);
        if (!asset) continue;
        const patch = hydratedDroppedAssetDurationPatch(clip, asset);
        if (!patch) continue;
        // One patch per run: updateClip mutates `timeline` (a dependency), so
        // the effect re-fires and resolves the next placeholder clip on the
        // following render. Converges across renders rather than patching every
        // clip from a now-stale `timeline` snapshot in a single pass.
        updateClip(clip.id, patch);
        return;
      }
    }
  }, [assetsById, project.id, projectId, timeline, updateClip]);

  return {
    materializationSessionId,
    materializationStates,
  };
}
