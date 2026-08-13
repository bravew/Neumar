import { useEffect, useRef, type RefObject } from 'react';

import type {
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

import { msToPixels } from './timelineMath';
import type { TimelineSceneSelectionSource } from './TimelineTypes';

interface UseTimelineSceneSeekOptions {
  selectedSceneId?: string | null;
  selectedSceneSource?: TimelineSceneSelectionSource;
  tracks: VideoTimelineTrack[];
  pixelsPerSecond: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  setPlayheadMs: (ms: number) => void;
  selectClip: (clipId: string) => void;
}

/**
 * Seek the timeline playhead and scroll the viewport when the selected scene
 * changes (e.g. user clicked a transcript card). Guards against re-seeking
 * when only zoom or timeline data changes via a `lastSeekedScene` ref.
 */
export function useTimelineSceneSeek({
  selectedSceneId,
  selectedSceneSource = 'user',
  tracks,
  pixelsPerSecond,
  scrollRef,
  setPlayheadMs,
  selectClip,
}: UseTimelineSceneSeekOptions): void {
  const lastSeekedSceneRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedSceneId) return;
    if (lastSeekedSceneRef.current === selectedSceneId) return;
    let targetClip: VideoTimelineClip | null = null;
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.sceneId !== selectedSceneId) continue;
        if (!targetClip || clip.startMs < targetClip.startMs) {
          targetClip = clip;
        }
      }
    }
    if (!targetClip) return;
    lastSeekedSceneRef.current = selectedSceneId;
    if (selectedSceneSource === 'timeline') return;
    setPlayheadMs(targetClip.startMs);
    selectClip(targetClip.id);
    const element = scrollRef.current;
    if (element) {
      const clipLeftPx = msToPixels(targetClip.startMs, pixelsPerSecond);
      const target = Math.max(0, clipLeftPx - 48);
      if (typeof element.scrollTo === 'function') {
        element.scrollTo({ left: target, behavior: 'smooth' });
      } else {
        element.scrollLeft = target;
      }
    }
  }, [
    pixelsPerSecond,
    scrollRef,
    selectClip,
    selectedSceneId,
    selectedSceneSource,
    setPlayheadMs,
    tracks,
  ]);
}
