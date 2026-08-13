import { useCallback } from 'react';

import { toast } from 'sonner';

import type {
  VideoAgentToolCallInput,
  VideoTimeline,
} from '@/shared/types/video';

import { buildRemoveSelectedClipOps } from './timelineSelectionOps';

interface TimelineDeleteSelectionLabels {
  deleteClip: string;
  rippleDeleteClip: string;
}

interface TimelineDeleteSelectionEditor {
  selectedClipIds: Set<string>;
  selectedSeamId: string | null;
  clearSelection: () => void;
  deleteSelectedClip: (options?: { ripple?: boolean }) => void;
  removeTransitionFromSeam: (seamId: string) => void;
}

export function useTimelineDeleteSelection(input: {
  activeTimeline: VideoTimeline;
  editor: TimelineDeleteSelectionEditor;
  labels: TimelineDeleteSelectionLabels;
  onApplyAgentTool?: (
    input: VideoAgentToolCallInput,
  ) => Promise<unknown> | unknown;
}): (options?: { ripple?: boolean }) => void {
  const { activeTimeline, editor, labels, onApplyAgentTool } = input;
  return useCallback(
    (options?: { ripple?: boolean }) => {
      if (editor.selectedClipIds.size === 0 && editor.selectedSeamId) {
        editor.removeTransitionFromSeam(editor.selectedSeamId);
        return;
      }
      const ripple = options?.ripple ?? false;
      const ops = buildRemoveSelectedClipOps(
        activeTimeline,
        editor.selectedClipIds,
        ripple,
      );
      if (!ops.length) return;
      if (!onApplyAgentTool) {
        editor.deleteSelectedClip(options);
        return;
      }
      const summary = ripple ? labels.rippleDeleteClip : labels.deleteClip;
      void Promise.resolve(
        onApplyAgentTool({
          name: 'applyTimelineOps',
          reasoning: summary,
          args: { ops, summary },
        }),
      )
        .then(() => {
          editor.clearSelection();
        })
        .catch((error) => {
          toast.error(
            `${summary}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    },
    [activeTimeline, editor, labels, onApplyAgentTool],
  );
}
