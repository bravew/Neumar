import { useCallback } from 'react';

import type { VideoAgentJournalEntry } from '@/shared/types/video';

import {
  resolveTimelineRedoTarget,
  resolveTimelineUndoTarget,
} from './timelineUndoArbitration';

interface TimelineUndoEditorActions {
  latestUserEditCreatedAt: string | null;
  redoUserEdit: () => void;
  undoUserEdit: () => void;
  userRedoCreatedAt: string | null;
  userUndoCreatedAt: string | null;
}

interface UseTimelineUndoArbitrationOptions {
  agentJournal: VideoAgentJournalEntry[];
  editor: TimelineUndoEditorActions;
  onRedoAgentJournalEntry?: (entryId: string) => Promise<unknown> | unknown;
  onUndoAgentJournalEntry?: (entryId: string) => Promise<unknown> | unknown;
}

export function useTimelineUndoArbitration({
  agentJournal,
  editor,
  onRedoAgentJournalEntry,
  onUndoAgentJournalEntry,
}: UseTimelineUndoArbitrationOptions) {
  const undo = useCallback(() => {
    const target = resolveTimelineUndoTarget({
      agentJournal,
      userUndoCreatedAt: editor.userUndoCreatedAt,
    });
    if (!target) return;
    if (target.kind === 'user' || !onUndoAgentJournalEntry) {
      editor.undoUserEdit();
      return;
    }
    void onUndoAgentJournalEntry(target.entryId);
  }, [agentJournal, editor, onUndoAgentJournalEntry]);

  const redo = useCallback(() => {
    const target = resolveTimelineRedoTarget({
      agentJournal,
      latestUserEditCreatedAt: editor.latestUserEditCreatedAt,
      userRedoCreatedAt: editor.userRedoCreatedAt,
    });
    if (!target) return;
    if (target.kind === 'user' || !onRedoAgentJournalEntry) {
      editor.redoUserEdit();
      return;
    }
    void onRedoAgentJournalEntry(target.entryId);
  }, [agentJournal, editor, onRedoAgentJournalEntry]);

  return { redo, undo };
}
