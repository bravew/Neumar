import { useEffect, type RefObject } from 'react';

import { resolveTimelineKeyboardAction } from './timelineKeyboardBindings';

interface TimelineKeyboardShortcutsOptions {
  rootRef: RefObject<HTMLElement | null>;
  hasSelectedClips: boolean;
  hasSelectedTransition: boolean;
  onSplitSelectedClip: () => void;
  onDeleteSelectedClip: (options?: { ripple?: boolean }) => void;
  onSelectAllClips: () => void;
  onCopySelection: () => void;
  onCutSelection: () => void;
  onPasteClipboard: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddMarker: () => void;
  onToggleSnapping: () => void;
  onSelectTool: () => void;
  onRazorTool: () => void;
  onStepFrames: (frames: number) => void;
}

export function useTimelineKeyboardShortcuts({
  rootRef,
  hasSelectedClips,
  hasSelectedTransition,
  onSplitSelectedClip,
  onDeleteSelectedClip,
  onSelectAllClips,
  onCopySelection,
  onCutSelection,
  onPasteClipboard,
  onUndo,
  onRedo,
  onAddMarker,
  onToggleSnapping,
  onSelectTool,
  onRazorTool,
  onStepFrames,
}: TimelineKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      const action = resolveTimelineKeyboardAction(event);
      if (!action) return;

      // Undo/redo are document-global (not gated to timeline focus) so Cmd+Z /
      // Cmd+Y also reverse edits made on the preview canvas, not just the
      // timeline — one consolidated history for the whole editor.
      if (action === 'undo' || action === 'redo') {
        event.preventDefault();
        if (action === 'undo') onUndo();
        if (action === 'redo') onRedo();
        return;
      }

      const hasDeleteSelection = hasSelectedClips || hasSelectedTransition;
      if (!isTimelineScopeActive(rootRef.current, hasDeleteSelection)) return;

      if (action === 'delete-selection' || action === 'ripple-delete') {
        if (!hasDeleteSelection) return;
        event.preventDefault();
        onDeleteSelectedClip({ ripple: action === 'ripple-delete' });
        return;
      }
      if (action === 'split-at-playhead') {
        if (!hasSelectedClips) return;
        event.preventDefault();
        onSplitSelectedClip();
        return;
      }
      if (action === 'copy' || action === 'cut') {
        if (!hasSelectedClips) return;
        event.preventDefault();
        if (action === 'copy') onCopySelection();
        if (action === 'cut') onCutSelection();
        return;
      }
      event.preventDefault();
      if (action === 'select-all') {
        onSelectAllClips();
        return;
      }
      if (action === 'add-marker') {
        onAddMarker();
        return;
      }
      if (action === 'paste') {
        onPasteClipboard();
        return;
      }
      if (action === 'toggle-snap') {
        onToggleSnapping();
        return;
      }
      if (action === 'select-tool') {
        onSelectTool();
        return;
      }
      if (action === 'razor-tool') {
        onRazorTool();
        return;
      }
      if (action === 'step-back-frame') onStepFrames(-1);
      if (action === 'step-forward-frame') onStepFrames(1);
      if (action === 'step-back-10frames') onStepFrames(-10);
      if (action === 'step-forward-10frames') onStepFrames(10);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    hasSelectedClips,
    hasSelectedTransition,
    onAddMarker,
    onCopySelection,
    onCutSelection,
    onDeleteSelectedClip,
    onPasteClipboard,
    onRedo,
    onSelectAllClips,
    onSelectTool,
    onSplitSelectedClip,
    onStepFrames,
    onRazorTool,
    onToggleSnapping,
    onUndo,
    rootRef,
  ]);
}

function isTimelineScopeActive(
  root: HTMLElement | null,
  hasSelection: boolean,
): boolean {
  if (hasSelection) return true;
  if (!root || typeof document === 'undefined') return false;
  const activeElement = document.activeElement;
  return !!activeElement && root.contains(activeElement);
}
