import { create } from 'zustand';

/** Delete semantics: `text` never touches the timeline; `cut` edits media. */
export type TranscriptEditMode = 'text' | 'cut';

export interface TranscriptWordSelection {
  sourceId: string;
  startIndex: number;
  endIndex: number;
}

interface TranscriptSelectionState {
  mode: TranscriptEditMode;
  followPlayback: boolean;
  selection: TranscriptWordSelection | null;
  /** Anchor kept so shift-click extends from the original word. */
  anchor: { sourceId: string; index: number } | null;
  setMode: (mode: TranscriptEditMode) => void;
  setFollowPlayback: (follow: boolean) => void;
  selectWord: (sourceId: string, index: number, extend?: boolean) => void;
  selectRange: (selection: TranscriptWordSelection) => void;
  clearSelection: () => void;
}

export const useTranscriptSelectionStore = create<TranscriptSelectionState>(
  (set) => ({
    // Text is the safe default: Delete must never remove media by accident.
    mode: 'text',
    followPlayback: true,
    selection: null,
    anchor: null,
    setMode: (mode) => set({ mode }),
    setFollowPlayback: (followPlayback) => set({ followPlayback }),
    selectWord: (sourceId, index, extend = false) =>
      set((state) => {
        const anchor =
          extend && state.anchor?.sourceId === sourceId
            ? state.anchor
            : { sourceId, index };
        return {
          anchor,
          selection: {
            sourceId,
            startIndex: Math.min(anchor.index, index),
            endIndex: Math.max(anchor.index, index),
          },
        };
      }),
    selectRange: (selection) =>
      set({
        selection,
        anchor: { sourceId: selection.sourceId, index: selection.startIndex },
      }),
    clearSelection: () => set({ selection: null, anchor: null }),
  }),
);
