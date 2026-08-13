import { useMemo } from 'react';

import type {
  VideoAspectRatio,
  VideoEditorSelectionContext,
} from '@/shared/types/video';

import { useTimelineEditorStore } from './timeline/useTimelineEditorStore';
import { useTimelineUiStore } from './timeline/useTimelineUiStore';

export function useVideoEditorSelectionContext({
  projectId,
  selectedSceneId,
  aspectRatio,
}: {
  projectId: string;
  selectedSceneId?: string;
  aspectRatio?: VideoAspectRatio;
}): VideoEditorSelectionContext | undefined {
  const timelineProjectId = useTimelineEditorStore((state) => state.projectId);
  const selectedClipIds = useTimelineEditorStore(
    (state) => state.selectedClipIds,
  );
  const playheadMs = useTimelineUiStore((state) => state.playheadMs);
  const inspectorPanel = useTimelineUiStore((state) => state.inspectorPanel);

  return useMemo(() => {
    if (timelineProjectId !== projectId) return undefined;
    const selected = [...selectedClipIds].filter(Boolean);
    const roundedPlayheadMs = Math.max(0, Math.round(playheadMs));
    if (selected.length === 0 && roundedPlayheadMs === 0 && !selectedSceneId) {
      return undefined;
    }
    return {
      playheadMs: roundedPlayheadMs,
      ...(selected.length > 0 ? { selectedClipIds: selected } : {}),
      previewFrame: {
        atMs: roundedPlayheadMs,
        ...(selectedSceneId ? { sceneId: selectedSceneId } : {}),
        ...(selected[0] ? { clipId: selected[0] } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        source: 'timeline-preview',
      },
      ...(inspectorPanel
        ? {
            activePanel: {
              kind: 'clip-inspector' as const,
              clipId: inspectorPanel.clipId,
              ...(inspectorPanel.tab ? { tab: inspectorPanel.tab } : {}),
            },
          }
        : {}),
    };
  }, [
    aspectRatio,
    inspectorPanel,
    playheadMs,
    projectId,
    selectedClipIds,
    selectedSceneId,
    timelineProjectId,
  ]);
}
