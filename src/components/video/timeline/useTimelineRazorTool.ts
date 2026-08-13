import { useCallback, type PointerEvent } from 'react';

import type { VideoTimelineClip } from '@/shared/types/video';

import { useTimelineEditorStore } from './useTimelineEditorStore';
import { useTimelineUiStore } from './useTimelineUiStore';

const RAZOR_CURSOR =
  'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27%3E%3Cpath d=%27M4.5 19.5 14.8 9.2l5 5L9.5 21H5a.5.5 0 0 1-.5-.5v-1Z%27 fill=%27white%27 stroke=%27black%27 stroke-width=%271.8%27 stroke-linejoin=%27round%27/%3E%3Cpath d=%27m11.3 6.7 2.4-2.4 6 6-2.4 2.4-6-6Z%27 fill=%27black%27 stroke=%27white%27 stroke-width=%27.8%27/%3E%3Cpath d=%27m7 18 8.2-8.2%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.5%27 stroke-linecap=%27round%27/%3E%3C/svg%3E") 5 20, crosshair';

interface UseTimelineRazorToolOptions {
  clip: VideoTimelineClip;
  locked: boolean;
  pixelsPerSecond: number;
}

export function useTimelineRazorTool({
  clip,
  locked,
  pixelsPerSecond,
}: UseTimelineRazorToolOptions) {
  const enabled = useTimelineUiStore((state) => state.razorToolEnabled);
  const setPlayheadMs = useTimelineUiStore((state) => state.setPlayheadMs);
  const selectClip = useTimelineEditorStore((state) => state.selectClip);
  const splitSelectedClipAtPlayhead = useTimelineEditorStore(
    (state) => state.splitSelectedClipAtPlayhead,
  );

  const splitAtPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!enabled) return false;
      event.preventDefault();
      if (locked) return true;
      const atMs = getClipPointerTimeMs(event, clip, pixelsPerSecond);
      setPlayheadMs(atMs);
      selectClip(clip.id);
      splitSelectedClipAtPlayhead(atMs);
      return true;
    },
    [
      clip,
      enabled,
      locked,
      pixelsPerSecond,
      selectClip,
      setPlayheadMs,
      splitSelectedClipAtPlayhead,
    ],
  );

  return {
    enabled,
    cursor: enabled && !locked ? RAZOR_CURSOR : undefined,
    splitAtPointer,
  };
}

function getClipPointerTimeMs(
  event: PointerEvent<HTMLDivElement>,
  clip: VideoTimelineClip,
  pixelsPerSecond: number,
): number {
  const rect = event.currentTarget.getBoundingClientRect();
  const offsetMs = ((event.clientX - rect.left) / pixelsPerSecond) * 1000;
  return Math.round(
    clip.startMs + Math.max(0, Math.min(clip.durationMs, offsetMs)),
  );
}
