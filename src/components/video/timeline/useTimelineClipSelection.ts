import { useCallback } from 'react';

import type { VideoTimelineClip } from '@/shared/types/video';

import type { TimelineClipSelectionMode } from './useTimelineEditorStore';

interface UseTimelineClipSelectionInput {
  selectClip: (
    clipId: string,
    options?: { mode?: TimelineClipSelectionMode },
  ) => void;
  onSelectScene?: (sceneId: string) => void;
}

export function useTimelineClipSelection({
  selectClip,
  onSelectScene,
}: UseTimelineClipSelectionInput) {
  return useCallback(
    (
      clip: VideoTimelineClip,
      options?: { mode?: TimelineClipSelectionMode },
    ) => {
      selectClip(clip.id, options);
      if (clip.sceneId) onSelectScene?.(clip.sceneId);
    },
    [onSelectScene, selectClip],
  );
}
