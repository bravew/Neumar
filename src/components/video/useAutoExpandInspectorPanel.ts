import { useEffect, useRef } from 'react';

import { usePanelRef } from 'react-resizable-panels';

import { useTimelineEditorStore } from './timeline/useTimelineEditorStore';

/**
 * Width the Inspector column opens at — both as the Panel's `defaultSize` and
 * as the width it is restored to after being collapsed. Kept in one place so
 * the two cannot drift apart.
 */
export const INSPECTOR_PANEL_DEFAULT_SIZE = '28%';

/**
 * The Preview step's Inspector lives in its own resizable column, and that
 * column is collapsible to 0%. Once collapsed there was no way back: the side
 * rail hides its Inspector tab on this step, so selecting a clip had nowhere
 * to show its properties and Transform/Style/Animate/Effects were unreachable
 * until a full page reload.
 *
 * Reopen the column whenever the user makes a *new* clip or transition
 * selection — keyed on the selection's identity, so clicking a different clip
 * counts, not just going from nothing to something. Scene selection is
 * excluded on purpose: a scene is almost always selected, so reacting to it
 * would make the column impossible to keep collapsed.
 */
export function useAutoExpandInspectorPanel() {
  const panelRef = usePanelRef();
  const selectionKey = useTimelineEditorStore((state) => {
    const clipIds = [...state.selectedClipIds].sort().join(',');
    const seam = state.timeline ? (state.selectedSeamId ?? '') : '';
    return clipIds || seam ? `${clipIds}|${seam}` : '';
  });
  const lastKey = useRef(selectionKey);

  useEffect(() => {
    const previous = lastKey.current;
    lastKey.current = selectionKey;
    // Only a fresh, non-empty selection reopens the column. Clearing the
    // selection leaves it as the user left it.
    if (!selectionKey || selectionKey === previous) return;
    const panel = panelRef.current;
    if (!panel?.isCollapsed()) return;
    // `expand()` restores the *most recent* size, which after a
    // drag-to-collapse is a few unusable pixels. Resize instead, so the
    // inspector always reopens wide enough to actually use.
    panel.resize(INSPECTOR_PANEL_DEFAULT_SIZE);
  }, [selectionKey, panelRef]);

  return panelRef;
}
