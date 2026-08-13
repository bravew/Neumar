import { useCallback } from 'react';
import type { RefObject } from 'react';

import type { AbstractAgent } from '@ag-ui/client';

import { API_BASE_URL } from '@/config';
import { createMessage } from '@/shared/db';
import { randomUUID } from '@/shared/utils/uuid';

/** Abort agent run and notify the backend. Shared by useAgentActions and useBranchActions. */
export function stopAgentRun(
  agentRef: RefObject<AbstractAgent>,
  taskIdRef: RefObject<string | undefined>,
): void {
  agentRef.current?.abortRun();
  const tid = taskIdRef.current;
  if (tid) {
    fetch(`${API_BASE_URL}/ag-ui/stop/${tid}`, { method: 'POST' }).catch(
      () => {},
    );
  }
}

/**
 * Extracted action handlers for TaskV2Thread — stop, send message,
 * cancel sub-agent, and cancel tool call.
 *
 * All callbacks read from refs (not state) to avoid stale closures.
 */
export function useAgentActions(
  agentRef: RefObject<AbstractAgent>,
  taskIdRef: RefObject<string | undefined>,
  historyMessagesRef: RefObject<
    Array<{ id: string; role: string; content: string }> | undefined
  >,
  forceRender: () => void,
  // Optional refs forwarded to runAgent() when an answer arrives for an
  // already-ended turn (e.g., Codex's `neuma:ask_user_question` bridge).
  // For Claude's native AskUserQuestion the SDK auto-injects the tool_result
  // and continues the same turn, so isRunning stays true and we never need
  // these — they may be omitted by callers that don't use the bridge.
  workDirRef?: RefObject<string | undefined>,
  additionalWorkDirsRef?: RefObject<string[] | undefined>,
  modelConfigRef?: RefObject<unknown>,
  // Clears a stale error banner from a prior run — this bridge kicks off a
  // fresh turn, and its outcome must not stay hidden behind an old one.
  clearRunError?: () => void,
) {
  const handleStop = useCallback(() => {
    stopAgentRun(agentRef, taskIdRef);
  }, [agentRef, taskIdRef]);

  // Record an AskUserQuestion answer.
  //
  // Two flows feed this:
  //   - Claude native AskUserQuestion: the Agent SDK pauses the turn, the host
  //     answers via tool_result, and the SAME turn keeps running. The agent
  //     is still running here, so we only need to record the answer text in
  //     the thread for transcript display.
  //   - Codex (and other adapters routed through the
  //     `neuma:ask_user_question` text-bridge): the model emits a fenced JSON
  //     block as its entire response, so the underlying turn ENDED before
  //     the user even saw the picker. The agent is not running anymore, so
  //     adding a user message is not enough — we must explicitly kick off a
  //     new turn with `runAgent` so the agent actually processes the answer.
  const handleSendMessage = useCallback(
    (text: string) => {
      const a = agentRef.current;
      if (!a || !text.trim()) return;

      const msgId = randomUUID();

      if (taskIdRef.current) {
        createMessage({
          task_id: taskIdRef.current,
          type: 'user',
          content: text.trim(),
          message_id: msgId,
          subtype: 'question_answer',
        }).catch(() => {});
      }

      // Seed agent with history so the thread doesn't lose visible messages
      // when the first inline answer is sent.
      if (a.messages.length === 0 && historyMessagesRef.current?.length) {
        for (const msg of historyMessagesRef.current) {
          a.addMessage(
            msg as { id: string; role: 'user' | 'assistant'; content: string },
          );
        }
      }

      a.addMessage({ id: msgId, role: 'user', content: text.trim() });
      forceRender();

      // Trigger a new turn only when the agent's prior turn already ended.
      // For Claude's native AskUserQuestion the SDK continues the same turn,
      // so isRunning stays true and we skip — the model is already chewing.
      if (a.isRunning) return;

      clearRunError?.();
      void a
        .runAgent({
          forwardedProps: {
            taskId: taskIdRef.current,
            ...(workDirRef?.current ? { workDir: workDirRef.current } : {}),
            ...(additionalWorkDirsRef?.current?.length
              ? { additionalWorkDirs: additionalWorkDirsRef.current }
              : {}),
            ...(modelConfigRef?.current
              ? { modelConfig: modelConfigRef.current }
              : {}),
          },
        })
        .catch((err: unknown) => {
          if (import.meta.env.DEV) {
            console.warn(
              '[useAgentActions] runAgent on AskUserQuestion answer failed',
              err,
            );
          }
        });
    },
    [
      agentRef,
      taskIdRef,
      historyMessagesRef,
      forceRender,
      workDirRef,
      additionalWorkDirsRef,
      modelConfigRef,
      clearRunError,
    ],
  );

  const handleCancelSubAgent = useCallback(
    (_agentId: string) => {
      if (taskIdRef.current) {
        fetch(`${API_BASE_URL}/ag-ui/stop/${taskIdRef.current}`, {
          method: 'POST',
        }).catch(() => {});
      }
    },
    [taskIdRef],
  );

  // Cancel a specific tool call without aborting the entire session
  const handleCancelTool = useCallback(
    async (toolUseId: string) => {
      const tid = taskIdRef.current;
      if (!tid) return;
      try {
        const res = await fetch(`${API_BASE_URL}/agent/cancel-tool`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: tid, toolUseId }),
        });
        if (!res.ok && import.meta.env.DEV) {
          console.warn('cancel-tool failed:', await res.text());
        }
      } catch {
        // Best-effort
      }
    },
    [taskIdRef],
  );

  return {
    handleStop,
    handleSendMessage,
    handleCancelSubAgent,
    handleCancelTool,
  };
}
