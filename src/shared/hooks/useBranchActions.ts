import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';

import type { AbstractAgent } from '@ag-ui/client';

import {
  createBranch,
  createEditBranch,
  getMessagesByTaskId,
  regenerateResponse,
} from '@/shared/db/database';
import { stopAgentRun } from '@/shared/hooks/useAgentActions';
import {
  dbMessagesToAGUI,
  flattenMessageTree,
  type BranchSelections,
} from '@/shared/lib/message-tree';
import { useBranchStore } from '@/shared/stores/branch-store';

/**
 * Encapsulates branch operations for TaskV2Thread:
 * edit-and-resubmit, regenerate, fork-from-here.
 *
 * Each operation follows the pattern: stop active run → branch → re-run agent.
 * All callbacks read from refs to avoid stale closures.
 */
export function useBranchActions(
  agentRef: RefObject<AbstractAgent>,
  taskIdRef: RefObject<string | undefined>,
  workDirRef: RefObject<string | undefined>,
  additionalWorkDirsRef: RefObject<string[] | undefined>,
  modelConfigRef: RefObject<Record<string, unknown> | undefined>,
  // Clears a stale error banner from a prior run — edit/regenerate start a
  // fresh run, and its outcome must not stay hidden behind an old one.
  clearRunError?: () => void,
) {
  const { addBranch, setActiveBranch, selectBranchAtFork } = useBranchStore();

  // Track whether a branch operation is in flight to prevent double-clicks
  const busyRef = useRef(false);

  /** Build common forwardedProps for agent runs. */
  const buildForwardedProps = useCallback(
    (tid: string, branchId?: string) => ({
      taskId: tid,
      ...(branchId ? { branchId } : {}),
      ...(workDirRef.current ? { workDir: workDirRef.current } : {}),
      ...(additionalWorkDirsRef.current?.length
        ? { additionalWorkDirs: additionalWorkDirsRef.current }
        : {}),
      ...(modelConfigRef.current
        ? { modelConfig: modelConfigRef.current }
        : {}),
    }),
    [workDirRef, additionalWorkDirsRef, modelConfigRef],
  );

  /**
   * Edit a user message and resubmit on a new branch.
   *
   * Flow:
   * 1. Stop any active run
   * 2. Create branch in DB (copies messages up to fork, inserts edited message)
   * 3. Reset agent message state — truncate to before the edited message,
   *    then add the edited message so the backend receives the correct prompt
   * 4. Run the agent on the new branch
   */
  const handleEditMessage = useCallback(
    async (messageId: string, newContent: string) => {
      const a = agentRef.current;
      const tid = taskIdRef.current;
      if (!a || !tid || busyRef.current) return;
      busyRef.current = true;

      try {
        stopAgentRun(agentRef, taskIdRef);

        const { branchId, messageUuid } = await createEditBranch(
          tid,
          messageId,
          newContent,
        );

        addBranch(tid, {
          branchId,
          forkPointId: messageId,
          messageCount: 0,
        });
        setActiveBranch(tid, branchId);
        selectBranchAtFork(tid, messageId, branchId);

        // Reset agent messages: keep everything before the edited message,
        // then replace with the edited content. This prevents the old
        // conversation tail from showing alongside the new branch response.
        // Use the DB-generated messageUuid so the AG-UI run handler's
        // INSERT OR IGNORE deduplicates correctly.
        const forkIdx = a.messages.findIndex((m) => m.id === messageId);
        const preceding = forkIdx >= 0 ? a.messages.slice(0, forkIdx) : [];
        const editedMsg = {
          id: messageUuid,
          role: 'user' as const,
          content: newContent,
        };
        a.setMessages([...preceding, editedMsg]);

        clearRunError?.();
        await a.runAgent({
          forwardedProps: buildForwardedProps(tid, branchId),
        });
      } catch (err) {
        console.error('[useBranchActions] editMessage failed:', err);
      } finally {
        busyRef.current = false;
      }
    },
    [
      agentRef,
      taskIdRef,
      buildForwardedProps,
      addBranch,
      setActiveBranch,
      selectBranchAtFork,
      clearRunError,
    ],
  );

  /**
   * Regenerate the assistant response after a given message.
   * Deletes existing responses on the branch, then re-runs.
   */
  const handleRegenerate = useCallback(
    async (messageId: string) => {
      const a = agentRef.current;
      const tid = taskIdRef.current;
      const activeBranchId =
        useBranchStore.getState().taskBranches[tid ?? '']?.activeBranchId ??
        'main';
      if (!a || !tid || busyRef.current) return;
      busyRef.current = true;

      try {
        stopAgentRun(agentRef, taskIdRef);

        await regenerateResponse(tid, messageId, activeBranchId);

        // Truncate agent messages to just after the target message,
        // removing old assistant responses so the regenerated one replaces them.
        const msgIdx = a.messages.findIndex((m) => m.id === messageId);
        if (msgIdx >= 0) {
          a.setMessages(a.messages.slice(0, msgIdx + 1));
        }

        clearRunError?.();
        await a.runAgent({
          forwardedProps: buildForwardedProps(tid, activeBranchId),
        });
      } catch (err) {
        console.error('[useBranchActions] regenerate failed:', err);
      } finally {
        busyRef.current = false;
      }
    },
    [agentRef, taskIdRef, buildForwardedProps, clearRunError],
  );

  /**
   * Fork the conversation from a specific message.
   * Creates a new branch and switches to it — user can then type a new prompt.
   */
  const handleForkFromHere = useCallback(
    async (messageId: string) => {
      const tid = taskIdRef.current;
      if (!tid || busyRef.current) return;
      busyRef.current = true;

      try {
        const branchId = await createBranch(tid, messageId);

        addBranch(tid, {
          branchId,
          forkPointId: messageId,
          messageCount: 0,
        });
        setActiveBranch(tid, branchId);
        selectBranchAtFork(tid, messageId, branchId);
      } catch (err) {
        console.error('[useBranchActions] forkFromHere failed:', err);
      } finally {
        busyRef.current = false;
      }
    },
    [taskIdRef, addBranch, setActiveBranch, selectBranchAtFork],
  );

  /**
   * Navigate between branches at a fork point.
   * Updates Zustand selection, then fetches DB messages and projects
   * the selected branch view onto the agent's message state.
   */
  const handleBranchNavigate = useCallback(
    async (forkPointId: string | number, direction: 'prev' | 'next') => {
      const a = agentRef.current;
      const tid = taskIdRef.current;
      if (!a || !tid) return;

      const state = useBranchStore.getState().taskBranches[tid];
      if (!state) return;

      const meta = state.branchMeta.filter(
        (m) => m.forkPointId === forkPointId,
      );
      if (meta.length === 0) return;

      const allBranches = ['main', ...meta.map((m) => m.branchId)];
      const currentBranchId = state.branchSelections[forkPointId] ?? 'main';
      const currentIdx = allBranches.indexOf(currentBranchId);
      const nextIdx =
        direction === 'next'
          ? Math.min(currentIdx + 1, allBranches.length - 1)
          : Math.max(currentIdx - 1, 0);

      if (nextIdx === currentIdx) return;

      const nextBranchId = allBranches[nextIdx];
      selectBranchAtFork(tid, forkPointId, nextBranchId);
      setActiveBranch(tid, nextBranchId);

      // Fetch all DB messages and project the selected branch view
      try {
        const dbMessages = await getMessagesByTaskId(tid);

        // Build a UUID → numeric DB row ID lookup so we can translate
        // the string AG-UI UUIDs stored in Zustand branchSelections
        // into the numeric IDs that flattenMessageTree expects.
        const uuidToNumericId = new Map<string, number>();
        for (const msg of dbMessages) {
          if (msg.message_id) {
            uuidToNumericId.set(msg.message_id, msg.id);
          }
        }

        const updatedState = useBranchStore.getState().taskBranches[tid];
        const selections: BranchSelections = new Map();
        if (updatedState) {
          for (const [fpId, bid] of Object.entries(
            updatedState.branchSelections,
          )) {
            // Resolve: try UUID lookup first, then numeric parse as fallback
            const numericId = uuidToNumericId.get(fpId) ?? Number(fpId);
            if (!Number.isNaN(numericId)) {
              selections.set(numericId, bid);
            }
          }
        }
        const projected = flattenMessageTree(dbMessages, selections);
        const aguiMessages = dbMessagesToAGUI(projected);
        a.setMessages(aguiMessages as Parameters<typeof a.setMessages>[0]);
      } catch (err) {
        console.warn('[useBranchActions] branch navigate load failed:', err);
      }
    },
    [agentRef, taskIdRef, selectBranchAtFork, setActiveBranch],
  );

  return {
    handleEditMessage,
    handleRegenerate,
    handleForkFromHere,
    handleBranchNavigate,
  };
}
