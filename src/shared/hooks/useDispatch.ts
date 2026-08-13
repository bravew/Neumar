/**
 * useDispatch — Background task dispatch hook.
 *
 * Starts an agent task in the background without navigating to the task page.
 * Makes a direct POST to /ag-ui/run with autoApprove flag, adds to background
 * task manager, monitors the SSE stream for completion via EventSource, and
 * lets the backend handle execution independently.
 */
import { useCallback, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { createSession, createTask } from '@/shared/db';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { buildModelOverride } from '@/shared/hooks/useAgent';
import {
  addBackgroundTask,
  updateBackgroundTaskStatus,
} from '@/shared/lib/background-tasks';
import { generateSessionId } from '@/shared/lib/session';
import { randomUUID } from '@/shared/utils/uuid';

interface UseDispatchOptions {
  workDirs: string[];
  selectedModel: string;
  profileId?: string;
  profileMcpServers?: string[];
  profileSkills?: string[];
}

interface UseDispatchReturn {
  dispatch: (
    text: string,
    attachments?: MessageAttachment[],
    mentionedMcpServers?: string[],
    pinnedSkills?: string[],
  ) => Promise<void>;
  isDispatching: boolean;
}

/**
 * Monitor an AG-UI task via EventSource for RUN_FINISHED / RUN_ERROR.
 * Automatically updates background task status and cleans up on completion.
 */
function monitorTaskCompletion(
  taskId: string,
  abortController: AbortController,
): void {
  const url = `${API_BASE_URL}/ag-ui/subscribe/${taskId}`;
  const eventSource = new EventSource(url);

  const cleanup = () => {
    eventSource.close();
  };

  abortController.signal.addEventListener('abort', cleanup, { once: true });

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'RUN_FINISHED' || data.type === 'RUN_ERROR') {
        updateBackgroundTaskStatus(taskId, false);
        cleanup();
      }
    } catch {
      // Ignore parse errors — non-JSON SSE lines are metadata
    }
  };

  eventSource.onerror = () => {
    // EventSource auto-reconnects on transient errors.
    // If the connection is permanently closed (server sent RUN_FINISHED),
    // readyState will be CLOSED and we stop monitoring.
    if (eventSource.readyState === EventSource.CLOSED) {
      updateBackgroundTaskStatus(taskId, false);
      cleanup();
    }
  };
}

export function useDispatch({
  workDirs,
  selectedModel,
  profileId,
  profileMcpServers,
  profileSkills,
}: UseDispatchOptions): UseDispatchReturn {
  const [isDispatching, setIsDispatching] = useState(false);
  const isDispatchingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const dispatch = useCallback(
    async (
      text: string,
      attachments?: MessageAttachment[],
      mentionedMcpServers?: string[],
      pinnedSkills?: string[],
    ) => {
      void attachments; // reserved for future file-upload support in dispatch mode
      const prompt = text.trim();
      if (isDispatchingRef.current || !prompt) return;

      isDispatchingRef.current = true;
      setIsDispatching(true);
      try {
        // Create session and task (same as Home handleSubmit)
        const sessionId = generateSessionId(prompt);
        await createSession({ id: sessionId, prompt });

        const taskId = randomUUID();
        await createTask({
          id: taskId,
          session_id: sessionId,
          task_index: 1,
          prompt,
          work_dir: workDirs[0] ?? undefined,
          assignee_profile_id: profileId,
        });

        // Merge profile MCP servers/skills with user-selected ones
        const mergedMcp = [
          ...new Set([
            ...(profileMcpServers ?? []),
            ...(mentionedMcpServers ?? []),
          ]),
        ];
        const mergedSkills = [
          ...new Set([...(profileSkills ?? []), ...(pinnedSkills ?? [])]),
        ];

        const abortController = new AbortController();
        abortRef.current = abortController;

        addBackgroundTask({
          taskId,
          sessionId,
          abortController,
          isRunning: true,
          prompt,
        });

        // Fire the AG-UI run — the backend runs the agent independently.
        // We don't consume the SSE response body; completion is tracked via
        // EventSource and the background task manager (DB / TaskEventBus).
        fetch(`${API_BASE_URL}/ag-ui/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            threadId: taskId,
            taskId,
            runId: randomUUID(),
            messages: [{ id: randomUUID(), role: 'user', content: prompt }],
            workDir: workDirs[0] ?? undefined,
            forwardedProps: {
              taskId,
              workDir: workDirs[0] ?? undefined,
              ...(workDirs.length > 1
                ? { additionalWorkDirs: workDirs.slice(1) }
                : {}),
              modelConfig: buildModelOverride(selectedModel),
              ...(mergedMcp.length > 0 ? { mcpServers: mergedMcp } : {}),
              ...(mergedSkills.length > 0
                ? { pinnedSkills: mergedSkills }
                : {}),
              ...(profileId ? { assigneeProfileId: profileId } : {}),
              autoApprove: true,
            },
          }),
        }).catch(() => {
          updateBackgroundTaskStatus(taskId, false);
        });

        monitorTaskCompletion(taskId, abortController);
      } finally {
        isDispatchingRef.current = false;
        setIsDispatching(false);
      }
    },
    [workDirs, selectedModel, profileId, profileMcpServers, profileSkills],
  );

  return { dispatch, isDispatching };
}
