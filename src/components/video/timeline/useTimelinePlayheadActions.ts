import { useCallback } from 'react';

import type { VideoTimeline } from '@/shared/types/video';

import { useTimelineFrameStep } from './useTimelineFrameStep';
import { useTimelineOutputRange } from './useTimelineOutputRange';

interface TimelinePlayheadEditor {
  timeline: VideoTimeline | null;
  addMarker: (timeMs: number, label: string) => string | null;
  splitSelectedClipAtPlayhead: (playheadMs: number) => void;
  setOutputRange: (
    range: { inFrame: number; outFrameExclusive: number } | null,
  ) => void;
}

interface UseTimelinePlayheadActionsOptions {
  editor: TimelinePlayheadEditor;
  activeTimeline: Pick<VideoTimeline, 'fps' | 'frameRate'>;
  playheadMs: number;
  timelineDurationMs: number;
  markerDefaultLabel: string;
  setPlayheadMs: (timeMs: number) => void;
}

/**
 * The keyboard-driven edits that all anchor on the playhead: split, marker, and
 * the In/Out points. Grouped because they share the same anchor and the same
 * staleness hazard — each must read the playhead at press time, not at the time
 * its callback was created.
 */
export function useTimelinePlayheadActions({
  editor,
  activeTimeline,
  playheadMs,
  timelineDurationMs,
  markerDefaultLabel,
  setPlayheadMs,
}: UseTimelinePlayheadActionsOptions) {
  const handleSplitSelectedClip = useCallback(() => {
    editor.splitSelectedClipAtPlayhead(playheadMs);
  }, [editor, playheadMs]);

  const handleAddMarker = useCallback(() => {
    editor.addMarker(playheadMs, markerDefaultLabel);
  }, [editor, markerDefaultLabel, playheadMs]);

  const { handleSetOutputIn, handleSetOutputOut, handleClearOutputRange } =
    useTimelineOutputRange({
      timeline: editor.timeline,
      activeTimeline,
      playheadMs,
      timelineDurationMs,
      setOutputRange: editor.setOutputRange,
    });

  const handleStepFrames = useTimelineFrameStep({
    fps: activeTimeline.fps,
    playheadMs,
    setPlayheadMs,
    timelineDurationMs,
  });

  return {
    handleStepFrames,
    handleSplitSelectedClip,
    handleAddMarker,
    handleSetOutputIn,
    handleSetOutputOut,
    handleClearOutputRange,
    // Bundled for the toolbar, which takes the whole In/Out surface as one
    // prop rather than four parallel ones.
    outputRangeControls: {
      onSetIn: handleSetOutputIn,
      onSetOut: handleSetOutputOut,
      onClear: handleClearOutputRange,
      hasRange: Boolean(editor.timeline?.outputRange),
    },
  };
}
