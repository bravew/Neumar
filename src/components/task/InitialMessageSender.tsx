import { useCallback, useEffect, useRef } from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';

import {
  buildAgentPrompt,
  deriveAttachmentDirs,
  resolveAttachmentsForSubmit,
} from '@/components/task/taskV2-submit-helpers';
import {
  createMessage,
  createSession,
  createTask,
  getMessagesByTaskId,
  getSession,
  getTask,
} from '@/shared/db';
import type { Message, Task } from '@/shared/db';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { randomUUID } from '@/shared/utils/uuid';

export interface ProfileDisplayInfo {
  id: string;
  name: string;
  role?: string | null;
  avatarIcon?: string | null;
  avatarColor?: string | null;
}

export interface LocationState {
  prompt?: string;
  sessionId?: string;
  taskIndex?: number;
  workDir?: string;
  additionalWorkDirs?: string[];
  attachments?: MessageAttachment[];
  assigneeProfileId?: string;
  profileDisplay?: ProfileDisplayInfo;
  modelOverride?: {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    agentType?: string;
  };
}

const INITIAL_SEND_ALREADY_HANDLED_STATUSES = new Set<Task['status']>([
  'running',
  'completed',
  'stopped',
]);

/**
 * Module-level (not per-instance) — survives a remount of InitialMessageSender
 * for the same taskId within this page session. `location.state.prompt` stays
 * populated until `clearInitialNavigationState()`'s replace-navigate actually
 * lands, so a remount that races ahead of that (e.g. an early re-render before
 * the connection settles) would otherwise pass the DB-based
 * `hasExistingInitialRun` check before the first mount's send has persisted
 * anything, sending the initial prompt a second time. Per-instance refs
 * (`startedRef` etc.) can't catch this since a remount gets fresh refs.
 */
const dispatchedInitialSendTaskIds = new Set<string>();

/** Test-only: clears the cross-mount dispatch guard between test cases. */
export function resetInitialSendDispatchTrackingForTests(): void {
  dispatchedInitialSendTaskIds.clear();
}

function hasExistingInitialRun(
  task: Task | null,
  messages: Message[],
): boolean {
  return (
    messages.length > 0 ||
    (!!task && INITIAL_SEND_ALREADY_HANDLED_STATUSES.has(task.status))
  );
}

/** Converts V1 DB messages to AG-UI message format for agent.setMessages(). */
export function dbMessagesToAGUI(messages: Message[]) {
  type AGUIMsg =
    | { id: string; role: 'user'; content: string }
    | { id: string; role: 'assistant'; content: string };
  const result: AGUIMsg[] = [];

  for (const msg of messages) {
    const id = msg.message_id ?? String(msg.id);
    if (msg.type === 'user' && msg.content) {
      result.push({ id, role: 'user', content: msg.content });
    } else if (msg.type === 'text' && msg.content) {
      result.push({ id, role: 'assistant', content: msg.content });
    }
  }

  return result;
}

/**
 * Reads location.state on mount and sends the initial prompt via CopilotKit.
 * Creates the task in the DB and adds it to the sidebar optimistically.
 * Must be rendered inside CopilotKitProvider (via AgUiProvider).
 *
 * Waits for runtimeConnectionStatus === 'connected' before sending — ensures
 * the agent is the stable one from /info, not a provisional placeholder.
 */
export function InitialMessageSender({
  taskId,
  addTask,
  onAttachMessage,
  modelConfig,
}: {
  taskId: string;
  addTask: (task: Task) => void;
  onAttachMessage?: (msgId: string, attachments: MessageAttachment[]) => void;
  modelConfig?: Record<string, unknown>;
}) {
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();
  const location = useLocation();
  const navigate = useNavigate();
  const startedRef = useRef(false);
  const dbDoneRef = useRef(false);
  const createdTaskThisMountRef = useRef(false);
  const taskCreateFailedRef = useRef(false);
  // Always read the latest agent — avoids stale closure when async IIFE awaits
  const agentRef = useRef(agent);
  agentRef.current = agent;
  /** Resolves when Phase 1 (task creation) completes. Phase 2 awaits this. */
  const taskReadyRef = useRef<Promise<void> | null>(null);
  const taskReadyResolveRef = useRef<(() => void) | null>(null);
  const clearInitialNavigationState = useCallback(() => {
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      { replace: true, state: null },
    );
  }, [location.hash, location.pathname, location.search, navigate]);

  // Phase 1: Create task in DB (only once, regardless of agent stability)
  useEffect(() => {
    if (dbDoneRef.current) return;
    const state = location.state as LocationState | null;
    if (!state?.prompt) return;
    dbDoneRef.current = true;

    // Create a promise that Phase 2 can await
    taskReadyRef.current = new Promise<void>((resolve) => {
      taskReadyResolveRef.current = resolve;
    });

    const prompt = state.prompt;
    const sessionId = state.sessionId ?? '';
    const taskIndex = state.taskIndex ?? 1;
    const workDir = state.workDir ?? undefined;
    const additionalDirs = state.additionalWorkDirs;

    (async () => {
      try {
        const existing = await getTask(taskId).catch(() => null);
        if (!existing) {
          if (sessionId) {
            const existingSession = await getSession(sessionId).catch(
              () => null,
            );
            if (!existingSession) {
              await createSession({ id: sessionId, prompt });
            }
          }
          const newTask = await createTask({
            id: taskId,
            session_id: sessionId,
            task_index: taskIndex,
            prompt,
            work_dir: workDir,
            ...(additionalDirs?.length
              ? { additional_work_dirs: JSON.stringify(additionalDirs) }
              : {}),
            ...(state.assigneeProfileId
              ? { assignee_profile_id: state.assigneeProfileId }
              : {}),
          });
          createdTaskThisMountRef.current = true;
          addTask(newTask);
        }
      } catch (err) {
        taskCreateFailedRef.current = true;
        if (import.meta.env.DEV)
          console.warn('[TaskDetailV2] Task create:', err);
      } finally {
        // Signal Phase 2 that the task row exists
        taskReadyResolveRef.current?.();
      }
    })();
  }, [taskId, location.state, addTask]);

  // Phase 2: Send initial message once runtime is connected AND task is created.
  // runtimeConnectionStatus transitions: disconnected → connecting → connected.
  // Only fire when 'connected' — the agent from useAgent() is then the real one
  // (from copilotkit.getAgent()), not a provisional placeholder.
  useEffect(() => {
    if (startedRef.current) return;
    if (dispatchedInitialSendTaskIds.has(taskId)) return;
    if (copilotkit.runtimeConnectionStatus !== 'connected') return;
    const state = location.state as LocationState | null;
    if (!state?.prompt) return;

    startedRef.current = true;
    dispatchedInitialSendTaskIds.add(taskId);
    const attachments = state.attachments;

    if (import.meta.env.DEV && attachments?.length) {
      console.warn(
        '[InitialMessageSender] attachments from location.state:',
        attachments.map((a) => ({
          name: a.name,
          type: a.type,
          path: a.path,
          hasData: !!a.data,
          dataLen: a.data?.length ?? 0,
        })),
      );
    }

    const msgId = randomUUID();

    // Wait for Phase 1 (task creation) to complete before persisting/running.
    // This ensures the task row exists in DB so server-side AGUIEventPersister
    // can write messages without FK constraint failures.
    // Note: no cancelled flag — startedRef already guards against double execution.
    // A cancelled flag would break under React 19 StrictMode double-mount because
    // the cleanup sets cancelled=true before the async IIFE resumes from await.
    (async () => {
      if (taskReadyRef.current) {
        await taskReadyRef.current;
      }
      if (taskCreateFailedRef.current) return;

      const locState = location.state as LocationState | null;
      const taskWorkDir = locState?.workDir;
      if (!createdTaskThisMountRef.current) {
        const [existingTask, existingMessages] = await Promise.all([
          getTask(taskId).catch(() => null),
          getMessagesByTaskId(taskId).catch(() => []),
        ]);

        if (hasExistingInitialRun(existingTask, existingMessages)) {
          clearInitialNavigationState();
          return;
        }
      }

      // File-picker / paste attachments arrive with no `path`. Persist them
      // to the session folder first so buildAgentPrompt can include them in
      // the [ATTACHED FILES …] prefix.
      const resolvedAttachments = await resolveAttachmentsForSubmit(
        attachments,
        taskId,
        taskWorkDir,
      );

      if (resolvedAttachments && resolvedAttachments.length > 0) {
        onAttachMessage?.(msgId, resolvedAttachments);
      }

      const { prompt, imageBlocks } = buildAgentPrompt(
        state.prompt!,
        resolvedAttachments,
      );

      // Persist the augmented prompt (including [ATTACHED FILES …] prefix)
      // so conversation replay preserves attachment context. Display strips
      // the prefix via ATTACHED_FILES_PREFIX_RE.
      createMessage({
        task_id: taskId,
        type: 'user',
        content: prompt,
        message_id: msgId,
        ...(resolvedAttachments?.length
          ? { attachments: JSON.stringify(resolvedAttachments) }
          : {}),
      }).catch(() => {});

      // Use agentRef to avoid stale closure after async await
      const a = agentRef.current;
      a.addMessage({ id: msgId, role: 'user', content: prompt });
      const additionalDirs = locState?.additionalWorkDirs;
      const assigneeProfileId = locState?.assigneeProfileId;
      // Widen the agent's sandbox to include each dropped file's parent
      // directory so the Read tool can open them in place (no copy).
      const attachmentDirs = deriveAttachmentDirs(resolvedAttachments);
      const mergedAdditionalDirs = [
        ...(additionalDirs ?? []),
        ...attachmentDirs.filter((d) => !(additionalDirs ?? []).includes(d)),
      ];
      a.runAgent({
        forwardedProps: {
          taskId,
          ...(taskWorkDir ? { workDir: taskWorkDir } : {}),
          ...(mergedAdditionalDirs.length
            ? { additionalWorkDirs: mergedAdditionalDirs }
            : {}),
          ...(assigneeProfileId ? { assigneeProfileId } : {}),
          ...(modelConfig ? { modelConfig } : {}),
          ...(imageBlocks.length > 0 ? { images: imageBlocks } : {}),
        },
      }).catch((err) => {
        if (import.meta.env.DEV)
          console.error('[InitialMessageSender] runAgent FAILED', err);
      });
      clearInitialNavigationState();
    })();
  }, [
    copilotkit.runtimeConnectionStatus,
    clearInitialNavigationState,
    location.state,
    taskId,
    onAttachMessage,
    modelConfig,
  ]);

  // Phase 3 moved to TaskDetailV2Page — loads history into state prop

  return null;
}
