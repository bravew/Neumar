import { useRef, useState } from 'react';

import type { TranslationKeys } from '@/config/locale';
import type { VideoAspectRatio, VideoProject } from '@/shared/types/video';

import { executeAgentAction } from './agentDockActions';
import { respondToAgentPermission } from './agentDockPermissions';
import { agentActionTitle } from './agentDockViewUtils';
import { agentActionToToolCall } from './agentToolMapping';
import type { VideoProjectEditorActions } from './editorTypes';
import type { AgentActionRecord } from './useAgentDock';

interface UseAgentDockActionHandlersInput {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  aspectRatio: VideoAspectRatio;
  t: TranslationKeys;
  appendText: (role: 'assistant' | 'system', content: string) => void;
  updateAction: (id: string, patch: Partial<AgentActionRecord>) => void;
  setDraft: (value: string) => void;
  bumpDraftNonce: () => void;
}

/**
 * Approval-card and journal handlers for the Video agent dock. Extracted from
 * `AgentDock.tsx` so the component stays under the 350-line cap; the behaviour
 * is unchanged.
 */
export function useAgentDockActionHandlers({
  project,
  actions,
  aspectRatio,
  t,
  appendText,
  updateAction,
  setDraft,
  bumpDraftNonce,
}: UseAgentDockActionHandlersInput) {
  const [journalBusyId, setJournalBusyId] = useState<string | null>(null);
  // Guards against a double-click both firing before the state update from
  // the first click is visible — React state is not synchronous, so two
  // clicks in the same tick would otherwise both read `journalBusyId` as null.
  const journalBusyIdRef = useRef<string | null>(null);
  const labels = t.video.editor.agentDock;

  const acceptAction = async (action: AgentActionRecord) => {
    updateAction(action.id, { status: 'running', error: undefined });
    try {
      if (action.permissionId) {
        await respondToAgentPermission(action.permissionId, true);
        updateAction(action.id, { status: 'completed' });
        return;
      }
      const toolCall = agentActionToToolCall(action);
      if (toolCall) {
        await actions.applyAgentTool(toolCall);
      } else {
        await executeAgentAction({ action, project, actions, aspectRatio });
      }
      updateAction(action.id, { status: 'completed' });
      appendText(
        'assistant',
        labels.actionCompleted.replace(
          '{action}',
          agentActionTitle(action.name, labels.actions),
        ),
      );
    } catch (error) {
      updateAction(action.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const rejectAction = (action: AgentActionRecord) => {
    if (action.permissionId) {
      void respondToAgentPermission(action.permissionId, false);
    }
    updateAction(action.id, { status: 'rejected' });
    appendText(
      'system',
      labels.actionRejected.replace(
        '{action}',
        agentActionTitle(action.name, labels.actions),
      ),
    );
  };

  const refineAction = (action: AgentActionRecord) => {
    setDraft(labels.refinePrompt.replace('{action}', action.summary));
    bumpDraftNonce();
  };

  const cancelAction = (action: AgentActionRecord) => {
    updateAction(action.id, { status: 'cancelled' });
  };

  const runJournalAction = async (entryId: string, mode: 'undo' | 'redo') => {
    if (journalBusyIdRef.current) return;
    journalBusyIdRef.current = entryId;
    setJournalBusyId(entryId);
    try {
      if (mode === 'undo') {
        await actions.undoAgentJournalEntry(entryId);
      } else {
        await actions.redoAgentJournalEntry(entryId);
      }
    } catch (error) {
      appendText(
        'system',
        labels.journal.actionFailed.replace(
          '{error}',
          error instanceof Error ? error.message : String(error),
        ),
      );
    } finally {
      journalBusyIdRef.current = null;
      setJournalBusyId(null);
    }
  };

  return {
    journalBusyId,
    acceptAction,
    rejectAction,
    refineAction,
    cancelAction,
    runJournalAction,
  };
}
