import { useCallback, useEffect, useRef, useState } from 'react';

import { API_PORT } from '@/config';
import {
  createMessage,
  createTask,
  deleteMessagesAfter,
  getMessagesByTaskId,
  getTask,
  updateMessageContent,
  updateTask,
  type Task,
} from '@/shared/db';
import { getSettings } from '@/shared/db/settings';
import { useRuntimeContext } from '@/shared/hooks/useRuntimeContext';
import {
  loadAttachments,
  resolveFileAttachments,
  saveAttachments,
  type AttachmentReference,
} from '@/shared/lib/attachments';
import {
  addBackgroundTask,
  getBackgroundTask,
  removeBackgroundTask,
  subscribeToBackgroundTasks,
  updateBackgroundTaskStatus,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { appendInlineAttachmentContext } from '@/shared/lib/byok-attachment-inliner';
import { notifyAgentEvent } from '@/shared/lib/notifications';
import { getAppDataDir } from '@/shared/lib/paths';
import { normalizeAgentQuestions } from '@/shared/questions/question-policy';
import type { RunContextEnvelopeDto } from '@/shared/types/run-context';
import {
  extractStructuredDirectAnswer,
  parseStructuredEnvelope,
} from '@/shared/utils/structured-envelope';
import { randomUUID } from '@/shared/utils/uuid';

import { prependAttachmentSourceContext } from './agent-attachment-context';
import {
  ATTACHMENT_LOAD_CONCURRENCY,
  BACKGROUND_TASK_REMOVAL_DELAY,
  DEFERRED_DB_RELOAD_DELAY,
  MAX_STUCK_POLL_COUNT,
  MESSAGE_POLLING_INTERVAL,
  PLANNING_STREAM_IDLE_TIMEOUT,
} from './agent-constants';
import { extractAndSaveFiles, extractFilesFromText } from './agent-files';
import {
  buildConversationHistory,
  mapDbMessageToAgentMessage,
  mergeConsecutiveTextMessages,
  observeTaskStream,
  preserveLoadedAttachments,
  restorePlanFromMessages,
  restoreQuestionFromMessages,
} from './agent-messages';
import {
  answerBackendAgentQuestion,
  createBackendAgentQuestion,
} from './agent-questions';
import { autoGenerateTitle } from './agent-title';
import type {
  AgentMessage,
  AgentPhase,
  ContinueConversationOptions,
  MessageAttachment,
  ModelOverride,
  PendingQuestion,
  PermissionRequest,
  PlanStep,
  SessionInfo,
  TaskPlan,
  UseAgentReturn,
} from './agent-types';
import {
  AGENT_SERVER_URL,
  applyModelOverride,
  fetchWithRetry,
  formatFetchError,
  getAgentRequestConfig,
  getTaskMessages,
  isConversationalPrompt,
  resolveEffectiveWorkDir,
} from './agent-utils';

// Re-export all types and utilities for backward compatibility
export type {
  AgentMessage,
  AgentPhase,
  AttachmentSourceContext,
  CloudStorageAttachmentSourceContext,
  AgentQuestion,
  ContinueConversationOptions,
  ConversationMessage,
  MessageAttachment,
  ModelOverride,
  PendingQuestion,
  PermissionRequest,
  PlanStep,
  QuestionOption,
  SessionInfo,
  TaskObserverContext,
  TaskPlan,
  UseAgentReturn,
} from './agent-types';
export {
  DETECTABLE_FILE_EXT,
  DETECTABLE_FILE_EXT_WITH_HTML,
} from './agent-constants';
export { buildModelOverride } from './agent-utils';

const PLAN_PERSIST_DEBOUNCE_MS = 500;

/** Tools that write/modify files — used to trigger working-files refresh. */
const fileWritingTools = ['Write', 'Edit', 'Bash', 'NotebookEdit'];

/** Detects MCP tool outputs that report a saved-to-disk path. */
const MCP_SAVED_TO_RE = /Saved to:\s*\//;

function createTaskRunContext(
  taskId: string,
  supplementalSkillIds: readonly string[] = [],
): RunContextEnvelopeDto {
  return {
    mode: 'task',
    projectId: null,
    conversationId: taskId,
    clientRequestId: randomUUID(),
    messageId: randomUUID(),
    supplementalSkillIds: [...supplementalSkillIds],
  };
}

function getRetryTarget(
  messages: AgentMessage[],
  reply: string,
): { messages: AgentMessage[]; attachments?: MessageAttachment[] } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type !== 'user') continue;
    if ((message.content ?? '') !== reply) return null;
    return {
      messages: messages.slice(0, i + 1),
      attachments: message.attachments,
    };
  }
  return null;
}

async function deletePersistedRetryTail(
  taskId: string,
  reply: string,
): Promise<void> {
  const dbMessages = await getMessagesByTaskId(taskId);
  for (let i = dbMessages.length - 1; i >= 0; i--) {
    const message = dbMessages[i];
    if (message.type !== 'user') continue;
    // Mirror getRetryTarget: only the latest user turn is retryable. Stop at
    // the first user message from the end and delete its tail only when that
    // turn is the one being retried — never reach back past it. The `return`
    // is intentionally unconditional so cleanup stays consistent with which
    // turn getRetryTarget selected.
    if ((message.content ?? '') === reply) {
      await deleteMessagesAfter(taskId, message.id);
    }
    return;
  }
}

if (import.meta.env.DEV) {
  console.warn(`[API] Environment: development, Port: ${API_PORT}`);
}

// All type definitions, constants, and utility functions have been extracted to:
//   agent-types.ts, agent-constants.ts, agent-title.ts,
//   agent-utils.ts, agent-files.ts, agent-messages.ts
// Re-exports above preserve backward compatibility for all consumers.

export function useAgent(): UseAgentReturn {
  const { context: runtimeContext } = useRuntimeContext();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [initialPrompt, setInitialPrompt] = useState<string>('');
  const [pendingPermission, setPendingPermission] =
    useState<PermissionRequest | null>(null);
  const [pendingQuestion, setPendingQuestion] =
    useState<PendingQuestion | null>(null);
  const [phase, setPhase] = useState<AgentPhase>('idle');
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  // Whether the current plan was loaded from a previous session (not freshly generated).
  // Used to prevent auto-execute from firing on session restore and to show
  // manual approval buttons instead of "Auto-starting..." in the UI.
  const [isPlanRestored, setIsPlanRestored] = useState<boolean>(false);
  // Session management
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
  const [currentTaskIndex, setCurrentTaskIndex] = useState<number>(1);
  // Track file changes to trigger refresh in UI
  const [filesVersion, setFilesVersion] = useState<number>(0);
  const [sessionFolder, setSessionFolder] = useState<string | null>(null);
  const [taskWorkDir, setTaskWorkDir] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null); // Backend session ID for API calls
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeTaskIdRef = useRef<string | null>(null); // Track which task is currently active (for message isolation)
  // Ref mirror of phase — always current, safe to read in useCallback without stale closure
  const phaseRef = useRef<AgentPhase>('idle');
  phaseRef.current = phase;
  // Stores per-task model override set by runAgent; consumed by approvePlan + continueConversation
  const modelOverrideRef = useRef<ModelOverride | undefined>(undefined);
  // Stores per-task MCP server selections set by runAgent; consumed by approvePlan (execute phase)
  const mentionedMcpServersRef = useRef<string[] | undefined>(undefined);
  // Stores per-task pinned skills set by runAgent; consumed by approvePlan + continueConversation
  const pinnedSkillsRef = useRef<string[] | undefined>(undefined);
  // Stores the agent profile ID assigned to the current task (tasks.assignee_profile_id)
  const agentProfileIdRef = useRef<string | undefined>(undefined);
  // Stores the latest provider/agent runtime session ID for resume.
  const agentSessionIdRef = useRef<string | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null); // For polling messages when restored from background
  const observerAbortRef = useRef<AbortController | null>(null); // For observer SSE subscription from another client
  // Use refs to track current values for callbacks (to avoid stale closures)
  const taskIdRef = useRef<string | null>(null);
  const isRunningRef = useRef<boolean>(false);
  const initialPromptRef = useRef<string>('');
  // Ref mirror of isPlanRestored for use in async callbacks (avoids stale closures)
  const isPlanRestoredRef = useRef<boolean>(false);
  // Ref mirror of messages — read in async callbacks without triggering re-renders
  const messagesRef = useRef<AgentMessage[]>([]);
  // Ref mirror of sessionFolder for use in async callbacks (avoids stale closures)
  const sessionFolderRef = useRef<string | null>(null);
  // Track plan message_id for persisting step progress to DB
  const planMessageIdRef = useRef<string | null>(null);
  const planUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync with state (for use in callbacks to avoid stale closures)
  useEffect(() => {
    taskIdRef.current = taskId;
  }, [taskId]);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    initialPromptRef.current = initialPrompt;
  }, [initialPrompt]);

  useEffect(() => {
    isPlanRestoredRef.current = isPlanRestored;
  }, [isPlanRestored]);

  useEffect(() => {
    sessionFolderRef.current = sessionFolder;
  }, [sessionFolder]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Helper to set session info
  const setSessionInfo = useCallback((sessionId: string, taskIndex: number) => {
    setCurrentSessionId(sessionId);
    setCurrentTaskIndex(taskIndex);
  }, []);

  // Load existing task from database
  // This function handles task switching (moving running task to background)
  // and loading task metadata. Message loading and background restoration is done by loadMessages.
  const loadTask = useCallback(async (id: string): Promise<Task | null> => {
    // If there's a running task, move it to background instead of aborting
    // Use refs to get current values (avoid stale closures)
    const currentTaskId = taskIdRef.current;
    const currentIsRunning = isRunningRef.current;
    const currentPrompt = initialPromptRef.current;

    if (
      abortControllerRef.current &&
      currentTaskId &&
      currentIsRunning &&
      currentTaskId !== id
    ) {
      if (import.meta.env.DEV) {
        console.warn('[useAgent] Moving task to background:', currentTaskId);
      }
      addBackgroundTask({
        taskId: currentTaskId,
        sessionId: sessionIdRef.current || '',
        abortController: abortControllerRef.current,
        isRunning: true,
        prompt: currentPrompt,
      });
      // Clear refs but don't abort - task continues in background
      abortControllerRef.current = null;
      sessionIdRef.current = null;
    }

    // Always clear UI state when switching to a different task
    if (currentTaskId && currentTaskId !== id) {
      setMessages([]);
      setPendingPermission(null);
      setPendingQuestion(null);
      setPlan(null);
      setIsPlanRestored(false);
    }

    // Stop any existing polling from previous task
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }

    // Abort any observer SSE subscription from previous task
    if (observerAbortRef.current) {
      observerAbortRef.current.abort();
      observerAbortRef.current = null;
    }

    // Set this as the active task
    activeTaskIdRef.current = id;

    // Note: Background restoration and running state is handled by loadMessages
    // Don't set isRunning here - let loadMessages determine the correct state

    try {
      const task = await getTask(id);
      if (task) {
        setInitialPrompt(task.prompt);

        // Restore per-task workDir from database
        setTaskWorkDir(task.work_dir || null);

        // Restore assigned agent profile for context injection
        agentProfileIdRef.current = task.assignee_profile_id ?? undefined;
        agentSessionIdRef.current = task.agent_session_id ?? null;
        setAgentSessionId(task.agent_session_id ?? null);

        // Set session info if available from the task
        if (task.session_id) {
          setCurrentSessionId(task.session_id);
          setCurrentTaskIndex(task.task_index || 1);

          // Compute session folder — honour user-configured workDir
          try {
            const baseDir = getSettings().workDir || (await getAppDataDir());
            const computedSessionFolder = `${baseDir}/sessions/${task.session_id}`;
            setSessionFolder(computedSessionFolder);
            if (import.meta.env.DEV)
              console.warn(
                '[useAgent] Loaded sessionFolder from task:',
                computedSessionFolder,
              );
          } catch (error) {
            if (import.meta.env.DEV)
              console.error('Failed to compute session folder:', error);
          }
        }
      }
      return task;
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to load task:', error);
      return null;
    }
  }, []);

  // Load existing messages from database
  const loadMessages = useCallback(async (id: string): Promise<void> => {
    // Note: Task switching logic is handled by loadTask, not here
    // This function just loads messages for the specified task

    // Check if the task we're loading is running in background
    const backgroundTask = getBackgroundTask(id);
    const isRestoringFromBackground =
      backgroundTask && backgroundTask.isRunning;

    // Get task status to determine if plan should be restored
    const task = await getTask(id);
    const taskIsCompleted = task && task.status === 'completed';
    const taskIsStopped = task && task.status === 'stopped';

    if (import.meta.env.DEV)
      console.warn('[useAgent] loadMessages:', {
        taskId: id,
        taskStatus: task?.status,
        taskIsCompleted,
        hasBackgroundTask: !!backgroundTask,
        backgroundTaskIsRunning: backgroundTask?.isRunning,
        isRestoringFromBackground,
      });

    if (isRestoringFromBackground) {
      if (import.meta.env.DEV)
        console.warn(
          '[useAgent] Task is running in background (loadMessages), restoring:',
          id,
        );
      abortControllerRef.current = backgroundTask.abortController;
      sessionIdRef.current = backgroundTask.sessionId;

      // Check if the abort controller is still valid (stream still running)
      if (abortControllerRef.current.signal.aborted) {
        if (import.meta.env.DEV)
          console.warn(
            '[useAgent] Background task was already completed/aborted',
          );
        setIsRunning(false);
        setPhase('idle');
        abortControllerRef.current = null;
        removeBackgroundTask(id);
      } else {
        setIsRunning(true);
        isRunningRef.current = true; // Sync update ref immediately to avoid race condition
        // Delay removal from background tasks to avoid UI flicker
        // This ensures isRunning state is updated before task is removed from backgroundTasks
        setTimeout(() => {
          removeBackgroundTask(id);
        }, BACKGROUND_TASK_REMOVAL_DELAY);

        // Immediately load messages from DB so the thread isn't empty while
        // we wait for the first polling tick. Without this, users see a blank
        // thread for ~1 second after switching back to a background task.
        try {
          const dbMessages = await getMessagesByTaskId(id);
          if (activeTaskIdRef.current === id) {
            const freshMessages = mergeConsecutiveTextMessages(
              dbMessages.map(mapDbMessageToAgentMessage),
            );
            setMessages((prev) =>
              prev.length > 0
                ? preserveLoadedAttachments(freshMessages, prev)
                : freshMessages,
            );

            // Restore correct phase from plan state instead of hardcoding 'executing'.
            // Pass isRestoringFromBackground=false so the function actually scans
            // messages — the "live stream handles them" assumption doesn't hold
            // after a task switch since the UI lost the in-memory phase state.
            await restorePlanFromMessages(id, freshMessages, dbMessages, {
              isRestoringFromBackground: false,
              taskIsCompleted: false,
              taskIsStopped: false,
              setPlan,
              setPhase,
              setIsPlanRestored,
            });

            // If restorePlanFromMessages didn't set a phase (no plan message
            // found in DB), infer the correct phase from the message content.
            // Without this, the phase would be undefined and no status
            // indicator would show.
            const hasPlanMsg = freshMessages.some(
              (m) => m.type === 'plan' && m.plan,
            );
            if (!hasPlanMsg) {
              const hasToolUse = dbMessages.some((m) => m.type === 'tool_use');
              setPhase(hasToolUse ? 'executing' : 'planning');
            }

            // Restore pending question (e.g. AskUserQuestion) that may have
            // arrived while the task was in the background
            restoreQuestionFromMessages(dbMessages, {
              taskIsCompleted: false,
              isRestoringFromBackground: false, // treat as normal restore so questions are recovered
              setPendingQuestion,
            });
          }
        } catch (error) {
          if (import.meta.env.DEV)
            console.error(
              '[useAgent] Failed to load initial messages for background task:',
              error,
            );
        }

        // Start polling for new messages (first batch already loaded above)
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
        }
        const pollingTaskId = id;
        let lastMessageCount = 0;
        let stuckCount = 0; // Count how many polls without new messages
        // Long timeout for stuck detection - tools like Bash can take minutes
        const MAX_STUCK_COUNT = MAX_STUCK_POLL_COUNT; // Stop after ~10 minutes of no progress

        refreshIntervalRef.current = setInterval(async () => {
          const isStillActive = activeTaskIdRef.current === pollingTaskId;

          // Check abort signal
          if (
            !abortControllerRef.current ||
            abortControllerRef.current.signal.aborted
          ) {
            if (refreshIntervalRef.current) {
              clearInterval(refreshIntervalRef.current);
              refreshIntervalRef.current = null;
            }
            if (isStillActive) {
              setIsRunning(false);
              setPhase('idle');
            }
            return;
          }

          // Also check task status in database - it might have completed
          try {
            const taskStatus = await getTask(pollingTaskId);
            if (
              taskStatus &&
              ['completed', 'error', 'stopped'].includes(taskStatus.status)
            ) {
              if (import.meta.env.DEV)
                console.warn(
                  '[useAgent] Task completed in database, stopping poll:',
                  taskStatus.status,
                );
              if (refreshIntervalRef.current) {
                clearInterval(refreshIntervalRef.current);
                refreshIntervalRef.current = null;
              }
              if (isStillActive) {
                setIsRunning(false);
                setPhase('idle');
              }
              return;
            }
          } catch (error) {
            if (import.meta.env.DEV)
              console.error('[useAgent] Failed to check task status:', error);
          }

          if (isStillActive) {
            // Refresh messages from database, preserving loaded attachments
            try {
              const dbMessages = await getMessagesByTaskId(pollingTaskId);
              const freshMessages = mergeConsecutiveTextMessages(
                dbMessages.map(mapDbMessageToAgentMessage),
              );
              setMessages((prev) =>
                preserveLoadedAttachments(freshMessages, prev),
              );

              // Check if there are pending tools (tool_use without matching tool_result)
              const toolUseIds = new Set<string>();
              const toolResultIds = new Set<string>();
              for (const msg of dbMessages) {
                if (msg.type === 'tool_use' && msg.tool_use_id) {
                  toolUseIds.add(msg.tool_use_id);
                } else if (msg.type === 'tool_result' && msg.tool_use_id) {
                  toolResultIds.add(msg.tool_use_id);
                }
              }
              const hasPendingTools = [...toolUseIds].some(
                (id) => !toolResultIds.has(id),
              );

              // Check if we're stuck (no new messages for too long AND no pending tools)
              if (dbMessages.length === lastMessageCount) {
                // Only count as stuck if there are no pending tools
                if (!hasPendingTools) {
                  // Check if task was recently touched (heartbeat during thinking)
                  const taskInfo = await getTask(pollingTaskId);
                  if (taskInfo?.updated_at) {
                    const updatedAt = new Date(taskInfo.updated_at).getTime();
                    if (Date.now() - updatedAt < 60_000) {
                      stuckCount = 0; // Reset — task is still alive
                    } else {
                      stuckCount++;
                    }
                  } else {
                    stuckCount++;
                  }
                  if (stuckCount >= MAX_STUCK_COUNT) {
                    if (import.meta.env.DEV) {
                      console.warn(
                        '[useAgent] Task appears stuck, stopping poll after',
                        MAX_STUCK_COUNT,
                        'seconds',
                      );
                    }
                    if (refreshIntervalRef.current) {
                      clearInterval(refreshIntervalRef.current);
                      refreshIntervalRef.current = null;
                    }
                    setIsRunning(false);
                    setPhase('idle');
                    return;
                  }
                } else {
                  // Tools are pending, reset stuck counter
                  stuckCount = 0;
                }
              } else {
                // Got new messages, reset stuck counter
                stuckCount = 0;
                lastMessageCount = dbMessages.length;
              }
            } catch (error) {
              if (import.meta.env.DEV) {
                console.error('[useAgent] Failed to refresh messages:', error);
              }
            }
          }
        }, MESSAGE_POLLING_INTERVAL);
      }
    } else if (task && task.status === 'running') {
      // Task is running in ANOTHER client (not in our background tasks).
      // Subscribe to the backend event bus to observe live progress.
      if (import.meta.env.DEV)
        console.warn(
          '[useAgent] Task is running in another client, subscribing to live updates:',
          id,
        );

      // Abort any previous observer subscription
      if (observerAbortRef.current) {
        observerAbortRef.current.abort();
        observerAbortRef.current = null;
      }

      setIsRunning(true);
      isRunningRef.current = true;
      // Don't set phase to 'executing' — let the observer/recovery
      // determine the correct phase (e.g. 'awaiting_approval' for plans).

      // Stop any existing polling
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }

      const observerAbort = new AbortController();
      observerAbortRef.current = observerAbort;

      // Set task state before starting observer — the subscribe endpoint
      // replays all buffered messages then delivers live events, so the
      // observer will populate messages via setMessages.
      // Note: activeTaskIdRef is already set by loadTask — don't overwrite it here
      setTaskId(id);

      observeTaskStream(id, observerAbort, {
        activeTaskIdRef,
        isRunningRef,
        setIsRunning,
        setPhase,
        setMessages,
        setPlan,
      }).catch(() => {
        // Error already handled inside observeTaskStream
      });

      // Observer handles messages via SSE — skip DB loading below
      return;
    } else {
      // Task is NOT running — it's completed/stopped/error
      if (import.meta.env.DEV)
        console.warn('[useAgent] Loading messages for completed task:', id);
      setIsRunning(false);
      setPhase('idle');
      abortControllerRef.current = null;

      // Abort any observer subscription
      if (observerAbortRef.current) {
        observerAbortRef.current.abort();
        observerAbortRef.current = null;
      }

      // Stop any existing polling
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    }

    // Note: activeTaskIdRef is already set by loadTask — don't overwrite it here

    try {
      const dbMessages = await getMessagesByTaskId(id);

      // First pass: identify user messages with attachments that need loading
      const attachmentLoadTasks: {
        index: number;
        refs: AttachmentReference[];
      }[] = [];

      for (let i = 0; i < dbMessages.length; i++) {
        const msg = dbMessages[i];
        if (msg.type === 'user' && msg.attachments) {
          try {
            const refs = JSON.parse(msg.attachments) as AttachmentReference[];
            // Check if it's the new format (has path)
            if (refs.length > 0 && 'path' in refs[0]) {
              attachmentLoadTasks.push({ index: i, refs });
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // Build agent messages immediately with placeholder attachments
      const agentMessages: AgentMessage[] = [];
      for (let i = 0; i < dbMessages.length; i++) {
        const msg = dbMessages[i];
        if (msg.type === 'user') {
          // Check if this message has attachments to load
          const loadTask = attachmentLoadTasks.find((t) => t.index === i);
          let attachments: MessageAttachment[] | undefined;

          if (loadTask) {
            // Create placeholder attachments (loading state)
            attachments = loadTask.refs.map((ref) => ({
              id: ref.id,
              type: ref.type,
              name: ref.name,
              data: '', // Empty data, will be loaded later
              mimeType: ref.mimeType,
              path: ref.path,
              isLoading: true,
            }));
          } else if (msg.attachments) {
            // Try old format
            try {
              const refs = JSON.parse(msg.attachments) as AttachmentReference[];
              if (refs.length > 0 && !('path' in refs[0])) {
                attachments = refs as unknown as MessageAttachment[];
              }
            } catch {
              // Ignore parse errors
            }
          }

          agentMessages.push({
            type: 'user' as const,
            content: msg.content || undefined,
            subtype: msg.subtype as AgentMessage['subtype'],
            attachments,
          });
        } else if (msg.type === 'text') {
          agentMessages.push({
            type: 'text' as const,
            content: msg.content || undefined,
          });
        } else if (msg.type === 'tool_use') {
          agentMessages.push({
            type: 'tool_use' as const,
            name: msg.tool_name || undefined,
            input: msg.tool_input ? JSON.parse(msg.tool_input) : undefined,
          });
        } else if (msg.type === 'tool_result') {
          agentMessages.push({
            type: 'tool_result' as const,
            toolUseId: msg.tool_use_id || undefined,
            output: msg.tool_output || undefined,
          });
        } else if (msg.type === 'result') {
          const resultMsg: AgentMessage = {
            type: 'result' as const,
            subtype: msg.subtype || undefined,
          };
          if (msg.cost != null) resultMsg.cost = msg.cost;
          if (
            msg.usage_input != null ||
            msg.usage_output != null ||
            msg.usage_cache_read != null ||
            msg.usage_cache_creation != null
          ) {
            resultMsg.usage = {
              input_tokens: msg.usage_input ?? undefined,
              output_tokens: msg.usage_output ?? undefined,
              cache_read_input_tokens: msg.usage_cache_read ?? undefined,
              cache_creation_input_tokens:
                msg.usage_cache_creation ?? undefined,
            };
          }
          if (msg.model) resultMsg.model = msg.model;
          agentMessages.push(resultMsg);
        } else if (msg.type === 'error') {
          agentMessages.push({
            type: 'error' as const,
            message: msg.error_message || undefined,
          });
        } else if (msg.type === 'plan') {
          // Restore plan message with parsed plan data
          try {
            const planData = msg.content
              ? (JSON.parse(msg.content) as TaskPlan)
              : undefined;
            if (planData) {
              // Track plan message_id for future persistence
              planMessageIdRef.current = msg.message_id || null;
              // Determine how to mark plan steps based on task status
              let restoredPlan: TaskPlan;
              if (taskIsStopped && !isRestoringFromBackground) {
                // Task was stopped — mark incomplete steps as cancelled,
                // but preserve completed steps so progress isn't lost.
                restoredPlan = {
                  ...planData,
                  steps: planData.steps.map((s) => ({
                    ...s,
                    status:
                      s.status === 'completed'
                        ? ('completed' as const)
                        : ('cancelled' as const),
                  })),
                };
              } else if (taskIsCompleted && !isRestoringFromBackground) {
                // Task completed - mark steps as completed
                restoredPlan = {
                  ...planData,
                  steps: planData.steps.map((s) => ({
                    ...s,
                    status: 'completed' as const,
                  })),
                };
              } else {
                // Task in progress or awaiting approval - keep original status
                restoredPlan = planData;
              }
              agentMessages.push({
                type: 'plan' as const,
                plan: restoredPlan,
              });
            }
          } catch {
            // Ignore parse errors
          }
        } else {
          agentMessages.push({ type: msg.type as AgentMessage['type'] });
        }
      }

      // Bail out if user switched to a different task during our async work
      if (activeTaskIdRef.current !== id) return;

      // Set messages — preserve already-loaded attachment data from in-memory
      // messages to avoid the brief flash of empty images when re-loading
      setMessages((prev) =>
        prev.length > 0
          ? preserveLoadedAttachments(agentMessages, prev)
          : agentMessages,
      );
      setTaskId(id);

      // Restore plan state (e.g. awaiting_approval) from loaded messages
      await restorePlanFromMessages(id, agentMessages, dbMessages, {
        isRestoringFromBackground: !!isRestoringFromBackground,
        taskIsCompleted: !!taskIsCompleted,
        taskIsStopped: !!taskIsStopped,
        setPlan,
        setPhase,
        setIsPlanRestored,
      });

      // Restore pending question from messages (if agent was paused for AskUserQuestion)
      restoreQuestionFromMessages(dbMessages, {
        taskIsCompleted: !!taskIsCompleted,
        isRestoringFromBackground: !!isRestoringFromBackground,
        setPendingQuestion,
      });

      // Bail out if user switched to a different task during plan restoration
      if (activeTaskIdRef.current !== id) return;

      // Load attachments asynchronously in background
      if (attachmentLoadTasks.length > 0) {
        // Use setTimeout to ensure this runs after the initial render
        setTimeout(async () => {
          // Check if we're still on the same task
          if (activeTaskIdRef.current !== id) return;

          const MESSAGE_CONCURRENCY = ATTACHMENT_LOAD_CONCURRENCY;

          for (
            let i = 0;
            i < attachmentLoadTasks.length;
            i += MESSAGE_CONCURRENCY
          ) {
            // Check again if task changed
            if (activeTaskIdRef.current !== id) return;

            const batch = attachmentLoadTasks.slice(i, i + MESSAGE_CONCURRENCY);
            const results = await Promise.all(
              batch.map(async ({ index, refs }) => {
                const attachments = await loadAttachments(refs);
                return { index, attachments };
              }),
            );

            // Update messages with loaded attachments
            setMessages((prevMessages) => {
              // Check if still on same task
              if (activeTaskIdRef.current !== id) return prevMessages;

              const newMessages = [...prevMessages];
              for (const { index, attachments } of results) {
                // Find user message with loading attachments that matches this index
                const task = attachmentLoadTasks.find((t) => t.index === index);
                if (!task) continue;

                for (let j = 0; j < newMessages.length; j++) {
                  const msg = newMessages[j];
                  if (
                    msg.type === 'user' &&
                    msg.attachments?.some((a) => a.isLoading) &&
                    msg.attachments?.length === task.refs.length &&
                    // Match by first attachment id
                    msg.attachments[0]?.id === task.refs[0]?.id
                  ) {
                    // Match found, update attachments
                    newMessages[j] = {
                      ...msg,
                      attachments: attachments.map((a) => ({
                        ...a,
                        isLoading: false,
                      })),
                    };
                    break;
                  }
                }
              }
              return newMessages;
            });
          }
        }, 0);
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to load messages:', error);
    }
  }, []);

  // Process SSE stream
  const processStream = useCallback(
    async (
      response: Response,
      currentTaskId: string,
      _abortController: AbortController,
    ): Promise<{ pausedForQuestion: boolean }> => {
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      // Track pending tool_use messages to match with tool_result
      const pendingToolUses: Map<
        string,
        { name: string; input: Record<string, unknown> }
      > = new Map();

      // Track tool execution progress for updating plan steps
      let completedToolCount = 0;
      let totalToolCount = 0;
      let pausedForQuestion = false;

      // Helper to check if this stream is still for the active task
      const isActiveTask = () => activeTaskIdRef.current === currentTaskId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Note: We no longer cancel the reader when task switches.
        // Background tasks continue to process the stream and save to database.
        // UI updates are skipped for inactive tasks via isActiveTask() checks below.

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as AgentMessage;

              // Check if this is the active task for UI updates
              const isActive = isActiveTask();

              if (data.type === 'session') {
                if (isActive) {
                  sessionIdRef.current = data.sessionId || null;
                }
                const durableSessionId = data.resumeSessionId ?? data.sessionId;
                if (durableSessionId) {
                  agentSessionIdRef.current = durableSessionId;
                  setAgentSessionId(durableSessionId);
                  await updateTask(currentTaskId, {
                    agent_session_id: durableSessionId,
                  }).catch(() => null);
                }
              } else if (data.type === 'done') {
                // Update background task status (always, even if not active)
                updateBackgroundTaskStatus(currentTaskId, false);

                // Notify user when app is not focused (gated by notifyOnCompletion setting)
                const taskT = getTaskMessages();
                getTask(currentTaskId)
                  .then((task) => {
                    if (!task) return;
                    const label =
                      task.title ||
                      task.prompt?.slice(0, 60) ||
                      taskT.notificationTaskDefault;
                    const failed = task.status === 'error';
                    void notifyAgentEvent({
                      runId: currentTaskId,
                      kind: failed ? 'failed' : 'succeeded',
                      title: failed
                        ? taskT.notificationTaskFailed
                        : taskT.notificationTaskCompleted,
                      body: label,
                      link: `/task-v2/${currentTaskId}`,
                      source: 'agent-stream',
                    });
                  })
                  .catch(() => {});

                // Cancel any pending debounced plan persist
                if (planUpdateTimerRef.current) {
                  clearTimeout(planUpdateTimerRef.current);
                  planUpdateTimerRef.current = null;
                }

                // UI updates only for active task
                if (isActive) {
                  // Stream ended - mark all plan steps as completed
                  setPendingPermission(null);
                  const endMsgId = planMessageIdRef.current;
                  setPlan((currentPlan) => {
                    if (!currentPlan) return currentPlan;
                    const finalPlan = {
                      ...currentPlan,
                      steps: currentPlan.steps.map((step) => ({
                        ...step,
                        status: 'completed' as const,
                      })),
                    };
                    // Persist final all-completed plan to DB (via microtask to avoid side effect in updater)
                    if (endMsgId) {
                      queueMicrotask(() => {
                        updateMessageContent(
                          endMsgId,
                          JSON.stringify(finalPlan),
                        );
                      });
                    }
                    return finalPlan;
                  });
                }
              } else if (data.type === 'permission_request') {
                // Handle permission request - only for active task
                if (isActive && data.permission) {
                  setPendingPermission(data.permission);
                  setMessages((prev) => [...prev, data]);
                }
              } else {
                // UI update only for active task
                if (isActive) {
                  // Accumulate consecutive text deltas into one message
                  // so the message-grouping logic in TaskDetail doesn't
                  // discard intermediate streaming chunks.
                  // Deduplicate: skip if the new content is already at the
                  // end of the accumulated text (Codex can emit identical
                  // agent_message items for the same turn).
                  if (data.type === 'text' && data.content) {
                    const content =
                      extractStructuredDirectAnswer(data.content) ??
                      data.content;
                    setMessages((prev) => {
                      const last = prev[prev.length - 1];
                      if (last && last.type === 'text') {
                        const existing = last.content || '';
                        // Skip exact duplicate (full message repeated)
                        if (content.length > 20 && existing.endsWith(content)) {
                          return prev;
                        }
                        const merged = {
                          ...last,
                          content: existing + content,
                        };
                        return [...prev.slice(0, -1), merged];
                      }
                      return [...prev, { ...data, content }];
                    });
                  } else if (data.type !== 'user') {
                    // Skip user messages from the stream — the frontend already
                    // added the user bubble before the API call. The backend
                    // emits { type: 'user' } only for DB persistence (non-Claude
                    // adapters), not for UI rendering.
                    setMessages((prev) => [...prev, data]);
                  }
                }

                // Extract file paths from text messages
                if (data.type === 'text' && data.content) {
                  await extractFilesFromText(
                    currentTaskId,
                    data.content,
                    sessionFolderRef.current || undefined,
                  );
                }

                // Track tool_use messages for file extraction
                if (data.type === 'tool_use' && data.name) {
                  const toolUseId =
                    (data as { id?: string }).id || `tool_${randomUUID()}`;
                  pendingToolUses.set(toolUseId, {
                    name: data.name,
                    input: (data.input as Record<string, unknown>) || {},
                  });
                  totalToolCount++;

                  // Handle AskUserQuestion tool - show question UI and pause execution
                  // Only handle for active task to avoid affecting wrong task's UI
                  if (
                    isActive &&
                    data.name === 'AskUserQuestion' &&
                    data.input
                  ) {
                    const questions = normalizeAgentQuestions(data.input);
                    if (questions.length > 0) {
                      let questionId = `question_${randomUUID()}`;
                      if (currentTaskId && sessionIdRef.current) {
                        const backendQuestionId =
                          await createBackendAgentQuestion({
                            sessionId: sessionIdRef.current,
                            taskId: currentTaskId,
                            toolUseId,
                            questions,
                          }).catch(() => null);
                        questionId = backendQuestionId ?? questionId;
                      }
                      setPendingQuestion({
                        id: questionId,
                        toolUseId,
                        questions,
                      });
                      // Stop agent execution and wait for user response
                      // The user's answer will be sent via continueConversation
                      if (import.meta.env.DEV) {
                        console.warn(
                          '[useAgent] AskUserQuestion detected, pausing execution',
                        );
                      }
                      setIsRunning(false);
                      if (abortControllerRef.current) {
                        abortControllerRef.current.abort();
                        abortControllerRef.current = null;
                      }
                      // Also stop backend agent
                      if (sessionIdRef.current) {
                        fetch(
                          `${AGENT_SERVER_URL}/agent/stop/${sessionIdRef.current}`,
                          {
                            method: 'POST',
                          },
                        ).catch(() => {});
                      }
                      // Update task status so restoration loads from DB, not SSE
                      pausedForQuestion = true;
                      if (currentTaskId) {
                        updateTask(currentTaskId, {
                          status: 'stopped',
                        }).catch(() => {});
                      }
                      reader.cancel();
                      return { pausedForQuestion }; // Stop processing this stream
                    }
                  }
                }

                // When we get a tool_result, extract files from the matched tool_use
                if (data.type === 'tool_result' && data.toolUseId) {
                  const toolUse = pendingToolUses.get(data.toolUseId);
                  if (toolUse) {
                    await extractAndSaveFiles(
                      currentTaskId,
                      toolUse.name,
                      toolUse.input,
                      data.output,
                      sessionFolderRef.current || undefined,
                    );
                    pendingToolUses.delete(data.toolUseId);

                    // Refresh files for file-writing tools and MCP tools that
                    // wrote to disk (emit "Saved to: …").
                    const mcpSavedToDisk =
                      toolUse.name.startsWith('mcp__') &&
                      typeof data.output === 'string' &&
                      MCP_SAVED_TO_RE.test(data.output);
                    if (
                      fileWritingTools.includes(toolUse.name) ||
                      toolUse.name.includes('sandbox') ||
                      mcpSavedToDisk
                    ) {
                      setFilesVersion((v) => v + 1);
                    }
                  }

                  // Update plan step progress
                  completedToolCount++;
                  setPlan((currentPlan) => {
                    if (!currentPlan || !currentPlan.steps.length)
                      return currentPlan;

                    const stepCount = currentPlan.steps.length;
                    // Calculate how many steps should be completed based on tool progress
                    // Use a heuristic: distribute tool completions across steps
                    const progressRatio =
                      completedToolCount /
                      Math.max(totalToolCount, stepCount * 2);
                    const completedSteps = Math.min(
                      Math.floor(progressRatio * stepCount),
                      stepCount - 1, // Keep at least one step as in_progress until done
                    );

                    const updatedSteps = currentPlan.steps.map(
                      (step, index) => {
                        if (index < completedSteps) {
                          return { ...step, status: 'completed' as const };
                        } else if (index === completedSteps) {
                          return { ...step, status: 'in_progress' as const };
                        }
                        return { ...step, status: 'pending' as const };
                      },
                    );

                    // Debounced persist of plan progress to DB
                    const updated = { ...currentPlan, steps: updatedSteps };
                    const msgId = planMessageIdRef.current;
                    if (msgId) {
                      if (planUpdateTimerRef.current) {
                        clearTimeout(planUpdateTimerRef.current);
                      }
                      planUpdateTimerRef.current = setTimeout(() => {
                        planUpdateTimerRef.current = null;
                        updateMessageContent(msgId, JSON.stringify(updated));
                      }, PLAN_PERSIST_DEBOUNCE_MS);
                    }

                    return updated;
                  });
                }

                // Note: Backend now saves agent messages to database via createSSEStream.
                // Clients only display messages; no need to save here to avoid duplicates.
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      return { pausedForQuestion };
    },
    [],
  );

  // Phase 1: Planning - get a plan from the agent
  const runAgent = useCallback(
    async (
      prompt: string,
      existingTaskId?: string,
      sessionInfo?: SessionInfo,
      attachments?: MessageAttachment[],
      workDir?: string,
      modelOverride?: ModelOverride,
      mentionedMcpServers?: string[],
      pinnedSkills?: string[],
    ): Promise<string> => {
      // Persist model override for the entire task lifecycle (plan + execute + replies)
      modelOverrideRef.current = modelOverride;
      // Persist MCP server selections for the plan → execute lifecycle
      mentionedMcpServersRef.current = mentionedMcpServers;
      // Persist pinned skills for the plan → execute lifecycle
      pinnedSkillsRef.current = pinnedSkills;

      // If there's already a running task, move it to background
      // Use refs to get current values (avoid stale closures from dep array)
      const prevTaskId = taskIdRef.current;
      const currentIsRunning = isRunningRef.current;
      const currentPrompt = initialPromptRef.current;
      if (currentIsRunning && abortControllerRef.current && prevTaskId) {
        if (import.meta.env.DEV) {
          console.warn(
            '[useAgent] Moving current task to background before starting new:',
            prevTaskId,
          );
        }
        addBackgroundTask({
          taskId: prevTaskId,
          sessionId: sessionIdRef.current || '',
          abortController: abortControllerRef.current,
          isRunning: true,
          prompt: currentPrompt,
        });
        abortControllerRef.current = null;
        sessionIdRef.current = null;
      }

      setIsRunning(true);
      isRunningRef.current = true; // Sync update ref immediately
      setMessages([]);
      setInitialPrompt(prompt);
      setPhase('planning');
      setPlan(null);
      setIsPlanRestored(false);
      agentSessionIdRef.current = null;
      setAgentSessionId(null);

      // Reset plan persistence refs for new task
      planMessageIdRef.current = null;
      if (planUpdateTimerRef.current) {
        clearTimeout(planUpdateTimerRef.current);
        planUpdateTimerRef.current = null;
      }

      // Set per-task workDir (reset to null when not provided so a
      // previous task's directory doesn't leak into the new one)
      setTaskWorkDir(workDir || null);

      // Handle session info
      const sessId = sessionInfo?.sessionId || currentSessionId || '';
      const taskIdx = sessionInfo?.taskIndex || currentTaskIndex;

      if (sessionInfo) {
        setCurrentSessionId(sessionInfo.sessionId);
        setCurrentTaskIndex(sessionInfo.taskIndex);
      }

      // Compute session folder path — honour user-configured workDir
      let computedSessionFolder: string | null = null;
      if (sessId) {
        try {
          const baseDir = getSettings().workDir || (await getAppDataDir());
          computedSessionFolder = `${baseDir}/sessions/${sessId}`;
          setSessionFolder(computedSessionFolder);
        } catch (error) {
          if (import.meta.env.DEV) {
            console.error('Failed to compute session folder:', error);
          }
        }
      }

      // Create or use existing task
      const currentTaskId = existingTaskId || randomUUID();
      setTaskId(currentTaskId);
      activeTaskIdRef.current = currentTaskId; // Set as active task for stream isolation

      // Save task to database - check if task exists first
      try {
        const existingTask = await getTask(currentTaskId);
        if (!existingTask) {
          await createTask({
            id: currentTaskId,
            session_id: sessId,
            task_index: taskIdx,
            prompt,
            work_dir: workDir,
          });
          if (import.meta.env.DEV) {
            console.warn(
              '[useAgent] Created new task:',
              currentTaskId,
              'in session:',
              sessId,
            );
          }
        } else {
          if (import.meta.env.DEV) {
            console.warn('[useAgent] Task already exists:', currentTaskId);
          }
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('Failed to create task:', error);
        }
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Prepare images for API (only send image attachments with actual data)
      const images = attachments
        ?.filter((a) => a.type === 'image' && a.data && a.data.length > 0)
        .map((a) => ({
          data: a.data,
          mimeType: a.mimeType || 'image/png',
        }));

      const hasImages = images && images.length > 0;
      const planMode = getSettings().planMode ?? 'on';

      // Debug logging for image attachments
      if (import.meta.env.DEV && attachments && attachments.length > 0) {
        console.warn('[useAgent] Attachments received:', attachments.length);
        attachments.forEach((a, i) => {
          if (import.meta.env.DEV)
            console.warn(
              `[useAgent] Attachment ${i}: type=${a.type}, hasData=${!!a.data}, dataLength=${a.data?.length || 0}`,
            );
        });
        if (import.meta.env.DEV)
          console.warn('[useAgent] Valid images for API:', images?.length || 0);
      }

      try {
        // If images are attached or plan mode is off, use direct execution (skip planning)
        // because images need to be processed during execution, not planning
        if (hasImages || planMode === 'off') {
          if (import.meta.env.DEV) {
            console.warn(
              '[useAgent] Skipping planning (images or planMode=off), using direct execution',
            );
          }
          setPhase('executing');

          // Add user message with attachments to UI
          const userMessage: AgentMessage = {
            type: 'user',
            content: prompt,
            attachments: attachments,
          };
          setMessages([userMessage]);

          // Save user message to database (save attachments to files first)
          let savedRefs: AttachmentReference[] = [];
          try {
            let attachmentRefs: string | undefined;
            if (
              attachments &&
              attachments.length > 0 &&
              computedSessionFolder
            ) {
              savedRefs = await resolveFileAttachments(
                attachments,
                computedSessionFolder,
                workDir || undefined,
                { taskId: currentTaskId, workDir: workDir || undefined },
              );
              if (savedRefs.length > 0) {
                attachmentRefs = JSON.stringify(savedRefs);
                setFilesVersion((v) => v + 1);
              }
            }
            await createMessage({
              task_id: currentTaskId,
              type: 'user',
              content: prompt,
              attachments: attachmentRefs,
            });
          } catch (error) {
            if (import.meta.env.DEV)
              console.error('Failed to save user message:', error);
          }

          // Augment prompt with non-image file paths so the agent
          // knows about attached files alongside the images.
          let execPrompt = prompt;
          const fileRefs = savedRefs.filter((r) => r.type === 'file');
          if (fileRefs.length > 0) {
            const fileList = fileRefs
              .map((r) => `- ${r.name}: ${r.path}`)
              .join('\n');
            execPrompt = `[ATTACHED FILES — READ permission granted (exempt from workspace isolation). Use the Read tool directly:\n${fileList}]\n\n${prompt}`;
          }
          execPrompt = prependAttachmentSourceContext(
            execPrompt,
            savedRefs.length > 0 ? savedRefs : attachments,
          );
          execPrompt = await appendInlineAttachmentContext(
            execPrompt,
            attachments,
          );

          // Resolve effective workspace directory — prefer session folder
          // to prevent the backend from creating a duplicate session-{taskId} folder
          const effectiveWorkDir =
            computedSessionFolder ||
            (await resolveEffectiveWorkDir(workDir || null, null));

          const config = applyModelOverride(
            getAgentRequestConfig(runtimeContext, 'execution'),
            modelOverrideRef.current,
          );
          const response = await fetchWithRetry(`${AGENT_SERVER_URL}/agent`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              prompt: execPrompt,
              workDir: effectiveWorkDir,
              userWorkspaceDir: workDir || undefined,
              taskId: currentTaskId,
              images,
              mentionedMcpServers:
                mentionedMcpServers && mentionedMcpServers.length > 0
                  ? mentionedMcpServers
                  : undefined,
              runContext: createTaskRunContext(currentTaskId, pinnedSkills),
              agentProfileId: agentProfileIdRef.current,
              ...config,
            }),
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
          }

          const streamResult = await processStream(
            response,
            currentTaskId,
            abortController,
          );

          // Skip post-stream work if paused for a question
          if (!streamResult?.pausedForQuestion) {
            // Auto-generate title for image-attached direct execution
            autoGenerateTitle(currentTaskId, prompt, undefined, (title) => {
              window.dispatchEvent(
                new CustomEvent('task-title-updated', {
                  detail: { taskId: currentTaskId, title },
                }),
              );
            });
          }

          return currentTaskId;
        }

        // Phase 1: Request planning (no images)

        // Save non-image file attachments before planning so the agent
        // knows about attached files (e.g. video to transcode).
        let planPrompt = prompt;
        let savedFileRefs: AttachmentReference[] = [];
        if (attachments && attachments.length > 0 && computedSessionFolder) {
          const fileAttachments = attachments.filter((a) => a.type === 'file');
          if (fileAttachments.length > 0) {
            savedFileRefs = await resolveFileAttachments(
              fileAttachments,
              computedSessionFolder,
              workDir || undefined,
              { taskId: currentTaskId, workDir: workDir || undefined },
            );
            if (savedFileRefs.length > 0) {
              setFilesVersion((v) => v + 1);
            }
            const fileList = savedFileRefs
              .map((r) => `- ${r.name}: ${r.path}`)
              .join('\n');
            planPrompt = `[ATTACHED FILES — READ permission granted (exempt from workspace isolation). Use the Read tool directly:\n${fileList}]\n\n${prompt}`;
            // Update initialPrompt so the execution phase (Phase 2) also
            // receives the file references — otherwise the agent won't know
            // where the attached files are on disk.
            setInitialPrompt(planPrompt);
          }
        }
        planPrompt = prependAttachmentSourceContext(
          planPrompt,
          savedFileRefs.length > 0 ? savedFileRefs : attachments,
        );
        planPrompt = await appendInlineAttachmentContext(
          planPrompt,
          attachments,
        );
        if (planPrompt !== prompt) {
          setInitialPrompt(planPrompt);
        }

        // Save initial user message to database so it appears first
        // when messages are reloaded after restart (ORDER BY id ASC).
        try {
          await createMessage({
            task_id: currentTaskId,
            type: 'user',
            content: prompt,
            attachments:
              savedFileRefs.length > 0
                ? JSON.stringify(savedFileRefs)
                : undefined,
          });
        } catch (error) {
          if (import.meta.env.DEV) {
            console.error('Failed to save initial user message:', error);
          }
        }

        // Resolve effective workspace directory — prefer session folder
        // to prevent the backend from creating a duplicate session-{taskId} folder
        const effectiveWorkDir =
          computedSessionFolder ||
          (await resolveEffectiveWorkDir(workDir || null, null));
        const config = applyModelOverride(
          getAgentRequestConfig(runtimeContext, 'planning'),
          modelOverrideRef.current,
        );
        const response = await fetchWithRetry(
          `${AGENT_SERVER_URL}/agent/plan`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              prompt: planPrompt,
              sessionId: sessId || undefined,
              taskId: currentTaskId,
              workDir: effectiveWorkDir,
              mentionedMcpServers:
                mentionedMcpServers && mentionedMcpServers.length > 0
                  ? mentionedMcpServers
                  : undefined,
              pinnedSkills:
                pinnedSkills && pinnedSkills.length > 0
                  ? pinnedSkills
                  : undefined,
              agentProfileId: agentProfileIdRef.current,
              ...config,
            }),
            signal: abortController.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }

        // Process planning stream
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        // Track Codex-style direct_answer (no inline content — text streams separately).
        // Used to defer title generation until the text stream is complete.
        let directAnswerWithNoContent = false;
        let accumulatedDirectAnswerText = '';

        // Helper to check if this stream is still for the active task
        const isActiveTask = () => activeTaskIdRef.current === currentTaskId;

        // Guard against a hung backend: if no data arrives within the
        // idle timeout, abort the stream so the UI doesn't stay stuck
        // on "Thinking..." indefinitely (e.g. due to memory pressure
        // or a stalled upstream API call).
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        const readWithIdleTimeout = (): Promise<
          ReadableStreamReadResult<Uint8Array>
        > => {
          if (idleTimer) clearTimeout(idleTimer);
          return new Promise((resolve, reject) => {
            idleTimer = setTimeout(() => {
              reader.cancel('Planning stream idle timeout').catch(() => {});
              reject(
                new Error(
                  'No response from server — the planning request may have stalled. Please try again.',
                ),
              );
            }, PLANNING_STREAM_IDLE_TIMEOUT);
            reader.read().then(
              (result) => {
                if (idleTimer) clearTimeout(idleTimer);
                resolve(result);
              },
              (err) => {
                if (idleTimer) clearTimeout(idleTimer);
                reject(err);
              },
            );
          });
        };

        while (true) {
          const { done, value } = await readWithIdleTimeout();
          if (done) break;

          // Note: We no longer cancel the reader when task switches.
          // Planning streams continue in background, UI updates are skipped for inactive tasks.

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as AgentMessage;

                // Check if this task is still active for UI updates
                const isActive = isActiveTask();

                if (data.type === 'session') {
                  if (isActive) {
                    sessionIdRef.current = data.sessionId || null;
                  }
                } else if (data.type === 'planning_status') {
                  // Planning heartbeat — shows status text and elapsed time
                  // while Claude is thinking/reasoning before producing text.
                  if (isActive) {
                    setMessages((prev) => {
                      const withoutStatus = prev.filter(
                        (m) =>
                          m.type !== 'planning_status' && m.type !== 'thinking',
                      );
                      return [...withoutStatus, data];
                    });
                  }
                } else if (data.type === 'thinking') {
                  // Planning progress indicator — add to messages so
                  // RunningIndicator can show "Planning..." instead of
                  // generic "Thinking..."
                  if (isActive) {
                    setMessages((prev) => {
                      // Keep only the latest thinking/status message to avoid bloat
                      const withoutThinking = prev.filter(
                        (m) =>
                          m.type !== 'thinking' && m.type !== 'planning_status',
                      );
                      return [...withoutThinking, data];
                    });
                  }
                } else if (data.type === 'direct_answer') {
                  // Simple question - direct answer, no plan needed.
                  // If content is provided (Claude-style), render it inline.
                  // If no content (Codex-style), text events follow — just clear
                  // thinking indicators and transition to idle so text renders cleanly.
                  if (import.meta.env.DEV) {
                    console.warn(
                      '[useAgent] Received direct answer, no plan needed',
                    );
                  }
                  // Extract actual answer if content is JSON-wrapped
                  let actualContent: string | undefined = data.content;
                  if (actualContent) {
                    actualContent =
                      extractStructuredDirectAnswer(actualContent) ??
                      actualContent;
                  }

                  if (isActive) {
                    if (actualContent) {
                      setMessages((prev) => [
                        ...prev.filter(
                          (m) =>
                            m.type !== 'thinking' &&
                            m.type !== 'planning_status',
                        ),
                        { type: 'text', content: actualContent },
                      ]);
                    } else {
                      // No content — text will stream in next; just clear thinking
                      setMessages((prev) =>
                        prev.filter(
                          (m) =>
                            m.type !== 'thinking' &&
                            m.type !== 'planning_status',
                        ),
                      );
                    }
                    setPlan(null); // Clear any plan when we get a direct answer
                    setPhase('idle');
                  }

                  // Backend saves messages; only update task status here
                  if (actualContent) {
                    try {
                      await updateTask(currentTaskId, { status: 'completed' });
                    } catch (dbError) {
                      if (import.meta.env.DEV) {
                        console.error('Failed to update task status:', dbError);
                      }
                    }
                  }

                  // Auto-generate a descriptive title from the direct answer.
                  // Claude-style: content is inline → generate now.
                  // Codex-style: no content, text streams next → set flag and
                  // generate on `done` once all text has been accumulated.
                  if (actualContent) {
                    autoGenerateTitle(
                      currentTaskId,
                      prompt,
                      actualContent.slice(0, 300),
                      (title) => {
                        window.dispatchEvent(
                          new CustomEvent('task-title-updated', {
                            detail: { taskId: currentTaskId, title },
                          }),
                        );
                      },
                    );
                  } else {
                    directAnswerWithNoContent = true;
                  }
                } else if (data.type === 'plan' && data.plan) {
                  // Complex task - received the plan, wait for approval
                  // UI updates only for active task
                  if (isActive) {
                    // Mark as freshly generated (not restored) so auto-execute can fire
                    setIsPlanRestored(false);
                    setPlan(data.plan);
                    setPhase('awaiting_approval');
                    setMessages((prev) => [
                      ...prev.filter(
                        (m) =>
                          m.type !== 'thinking' && m.type !== 'planning_status',
                      ),
                      data,
                    ]);
                  }

                  // Auto-generate a descriptive title from the plan.
                  // Include BOTH goal and step descriptions for rich context.
                  const planParts: string[] = [];
                  if (data.plan.goal) {
                    planParts.push(`Goal: ${data.plan.goal}`);
                  }
                  if (data.plan.steps?.length) {
                    const stepDescs = data.plan.steps
                      .map((s: PlanStep) => s.description)
                      .join('; ');
                    planParts.push(`Steps: ${stepDescs}`);
                  }
                  const planContext = planParts.join('\n') || '';
                  autoGenerateTitle(
                    currentTaskId,
                    prompt,
                    planContext,
                    (title) => {
                      window.dispatchEvent(
                        new CustomEvent('task-title-updated', {
                          detail: { taskId: currentTaskId, title },
                        }),
                      );
                    },
                  );

                  // Backend saves plan messages
                } else if (data.type === 'text') {
                  const content = data.content || '';
                  const envelope = parseStructuredEnvelope(content);
                  const structuredPlan =
                    envelope?.type === 'plan'
                      ? (envelope.value as unknown as TaskPlan)
                      : null;
                  const displayContent =
                    envelope?.type === 'direct_answer'
                      ? envelope.answer
                      : content;

                  if (structuredPlan) {
                    if (isActive) {
                      setIsPlanRestored(false);
                      setPlan(structuredPlan);
                      setPhase('awaiting_approval');
                      setMessages((prev) => [
                        ...prev.filter(
                          (m) =>
                            m.type !== 'thinking' &&
                            m.type !== 'planning_status',
                        ),
                        { type: 'plan', plan: structuredPlan },
                      ]);
                    }
                  } else if (isActive) {
                    // Accumulate consecutive text deltas into one message.
                    // Deduplicate: skip if exact content is already at the end
                    // (Codex SDK can emit identical agent_message items per turn).
                    setMessages((prev) => {
                      const last = prev[prev.length - 1];
                      if (last && last.type === 'text') {
                        const existing = last.content || '';
                        if (
                          displayContent.length > 20 &&
                          existing.endsWith(displayContent)
                        ) {
                          return prev;
                        }
                        const merged = {
                          ...last,
                          content: existing + displayContent,
                        };
                        return [...prev.slice(0, -1), merged];
                      }
                      return [...prev, { ...data, content: displayContent }];
                    });
                  }
                  // Accumulate for deferred title generation (Codex conversational path)
                  if (directAnswerWithNoContent && !structuredPlan) {
                    accumulatedDirectAnswerText += displayContent;
                  }
                } else if (data.type === 'user') {
                  // Skip user messages — non-Claude adapters inject these for
                  // DB persistence; the frontend already shows displayMessage.
                } else if (data.type === 'done') {
                  // Planning done — ensure phase is idle (handles cases where
                  // no explicit direct_answer/plan event was received)
                  if (isActive) {
                    setPhase((prev) => (prev === 'planning' ? 'idle' : prev));
                  }
                  // Deferred title generation: Codex sent direct_answer with no content;
                  // text streamed separately and is now fully accumulated.
                  if (
                    directAnswerWithNoContent &&
                    accumulatedDirectAnswerText
                  ) {
                    autoGenerateTitle(
                      currentTaskId,
                      prompt,
                      accumulatedDirectAnswerText.slice(0, 300),
                      (title) => {
                        window.dispatchEvent(
                          new CustomEvent('task-title-updated', {
                            detail: { taskId: currentTaskId, title },
                          }),
                        );
                      },
                    );
                  }
                } else if (data.type === 'error') {
                  if (isActive) {
                    setMessages((prev) => [...prev, data]);
                    setPhase('idle');
                  }
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          const errorMessage = formatFetchError(error, '/agent/plan');
          if (import.meta.env.DEV) {
            console.error('[useAgent] Request failed:', error);
          }

          // UI updates only for active task
          if (activeTaskIdRef.current === currentTaskId) {
            setMessages((prev) => [
              ...prev,
              { type: 'error', message: errorMessage },
            ]);
            setPhase('idle');
          }

          // Save client-side fetch error to DB (backend never sees these)
          try {
            await createMessage({
              task_id: currentTaskId,
              type: 'error',
              error_message: errorMessage,
            });
            await updateTask(currentTaskId, { status: 'error' });
          } catch (dbError) {
            if (import.meta.env.DEV) {
              console.error('Failed to save error:', dbError);
            }
          }
        }
      } finally {
        // Only update running state if this is still the active task
        if (activeTaskIdRef.current === currentTaskId) {
          setIsRunning(false);
          abortControllerRef.current = null;
        }
      }

      return currentTaskId;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isRunning, processStream], // Other deps intentionally omitted to keep callback stable
  );

  // Phase 2: Execute the approved plan
  const approvePlan = useCallback(async (): Promise<void> => {
    const currentTaskId = taskIdRef.current;
    if (!plan || !currentTaskId || phase !== 'awaiting_approval') return;

    // Ensure this task is the active one before execution
    activeTaskIdRef.current = currentTaskId;

    setIsRunning(true);
    isRunningRef.current = true; // Sync update ref immediately
    setPhase('executing');

    // Initialize plan steps as pending in UI
    const updatedPlan: TaskPlan = {
      ...plan,
      steps: plan.steps.map((s) => ({ ...s, status: 'pending' as const })),
    };
    setPlan(updatedPlan);

    // Note: Plan message is already saved by the backend during the planning
    // phase via saveMessageToDatabase — no need to save again here.

    // Capture plan message_id from DB for persisting step progress
    if (!planMessageIdRef.current) {
      try {
        const dbMessages = await getMessagesByTaskId(currentTaskId);
        const planMsg = dbMessages.find((m) => m.type === 'plan');
        planMessageIdRef.current = planMsg?.message_id || null;
      } catch {
        // Non-critical — persistence will be skipped if message_id is unavailable
      }
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let executionFailed = false;
    let pausedForQuestion = false;
    try {
      // Resolve effective workspace directory — prefer session folder
      // to prevent the backend from creating a duplicate session-{taskId} folder
      const currentSessionFolder = sessionFolderRef.current;
      const currentInitialPrompt = initialPromptRef.current;
      const workDir =
        currentSessionFolder ||
        (await resolveEffectiveWorkDir(taskWorkDir, null));

      const config = applyModelOverride(
        getAgentRequestConfig(runtimeContext, 'execution'),
        modelOverrideRef.current,
      );
      const response = await fetchWithRetry(
        `${AGENT_SERVER_URL}/agent/execute`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            planId: plan.id,
            sessionId: sessionIdRef.current || undefined,
            prompt: currentInitialPrompt,
            conversation: buildConversationHistory(
              currentInitialPrompt,
              messagesRef.current,
            ),
            workDir,
            userWorkspaceDir: taskWorkDir || undefined,
            taskId: currentTaskId,
            mentionedMcpServers:
              mentionedMcpServersRef.current &&
              mentionedMcpServersRef.current.length > 0
                ? mentionedMcpServersRef.current
                : undefined,
            runContext: createTaskRunContext(
              currentTaskId,
              pinnedSkillsRef.current,
            ),
            agentProfileId: agentProfileIdRef.current,
            ...config,
          }),
          signal: abortController.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const streamResult = await processStream(
        response,
        currentTaskId,
        abortController,
      );
      if (streamResult?.pausedForQuestion) {
        pausedForQuestion = true;
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        executionFailed = true;
        const errorMessage = formatFetchError(error, '/agent/execute');
        if (import.meta.env.DEV) {
          console.error('[useAgent] Execute failed:', error);
        }

        // UI updates only for active task
        if (activeTaskIdRef.current === currentTaskId) {
          setMessages((prev) => [
            ...prev,
            { type: 'error', message: errorMessage },
          ]);
        }

        // Save client-side error to DB (fetch/stream failures the backend never sees)
        try {
          await createMessage({
            task_id: currentTaskId,
            type: 'error',
            error_message: errorMessage,
          });
          await updateTask(currentTaskId, { status: 'error' });
        } catch (dbError) {
          if (import.meta.env.DEV)
            console.error('Failed to save error:', dbError);
        }
      }
    } finally {
      // Persist task status to DB — only mark as completed if execution didn't fail
      // and wasn't paused for a user question
      if (!executionFailed && !pausedForQuestion) {
        try {
          await updateTask(currentTaskId, { status: 'completed' });
        } catch (dbError) {
          if (import.meta.env.DEV)
            console.error('Failed to mark task as completed:', dbError);
        }
      }

      // Reset plan-restored flag
      setIsPlanRestored(false);

      // Only update UI state if this is still the active task
      if (activeTaskIdRef.current === currentTaskId) {
        // Don't clear running/plan UI when paused for a question —
        // the question UI is already displayed by processStream
        if (!pausedForQuestion) {
          setIsRunning(false);
          setPhase('idle');
          setPlan(null); // Clear plan state to prevent showing confirmation box again
          abortControllerRef.current = null;

          // Reload messages from database to ensure all are displayed
          // (in case some were missed during streaming)
          try {
            const dbMessages = await getMessagesByTaskId(currentTaskId);
            const agentMessages = mergeConsecutiveTextMessages(
              dbMessages.map((msg) => {
                const mapped = mapDbMessageToAgentMessage(msg);
                if (mapped.type === 'plan' && mapped.plan) {
                  return {
                    ...mapped,
                    plan: {
                      ...mapped.plan,
                      steps: mapped.plan.steps.map((s) => ({
                        ...s,
                        status: 'completed' as const,
                      })),
                    },
                  };
                }
                return mapped;
              }),
            );
            // Preserve already-loaded attachment data from in-memory messages
            setMessages((prev) =>
              preserveLoadedAttachments(agentMessages, prev),
            );
          } catch (reloadError) {
            if (import.meta.env.DEV)
              console.error(
                '[useAgent] Failed to reload messages after execution:',
                reloadError,
              );
          }
        }
      }
    }
  }, [plan, phase, processStream, taskWorkDir, runtimeContext]);

  // Reject the plan
  const rejectPlan = useCallback(async (): Promise<void> => {
    setIsPlanRestored(false);
    setPlan(null);
    setPhase('idle');
    const cancelledMessage = getTaskMessages().planCancelledMessage;
    setMessages((prev) => [
      ...prev,
      { type: 'text', content: cancelledMessage },
    ]);

    // Save rejection to database so it won't be restored when switching back
    const currentTaskId = taskIdRef.current;
    if (currentTaskId) {
      try {
        // Mark task as stopped (cancelled)
        await updateTask(currentTaskId, { status: 'stopped' });
        // Save the cancellation message
        await createMessage({
          task_id: currentTaskId,
          type: 'text',
          content: cancelledMessage,
        });
      } catch (error) {
        if (import.meta.env.DEV)
          console.error('Failed to save plan rejection:', error);
      }
    }
  }, []);

  // Auto-execute plan when setting is enabled — only for freshly generated plans,
  // never for plans restored from a previous session (prevents re-execution on task switch)
  useEffect(() => {
    if (phase === 'awaiting_approval' && plan && !isPlanRestored) {
      const settings = getSettings();
      if ((settings.planMode ?? 'on') === 'auto') {
        approvePlan();
      }
    }
  }, [phase, plan, isPlanRestored, approvePlan]);

  // Send a follow-up reply to the agent while it's still running
  const replyToRunningAgent = useCallback(
    async (
      reply: string,
      attachments?: MessageAttachment[],
      /** Optional subtype tag for the user message (e.g. 'question_answer') */
      subtype?: string,
    ): Promise<void> => {
      // Read from refs to avoid stale closures during rapid task switches
      const currentTaskId = taskIdRef.current;
      if (!currentTaskId) return;

      // Show user message in chat immediately (optimistic UI)
      const userMessage: AgentMessage = {
        type: 'user',
        content: reply,
        subtype,
        attachments:
          attachments && attachments.length > 0 ? attachments : undefined,
      };
      setMessages((prev) => [...prev, userMessage]);

      // Save attachments to file system if any, and collect refs for persistence
      const currentSessionFolder = sessionFolderRef.current;
      let attachmentRefsJson: string | undefined;
      try {
        if (attachments && attachments.length > 0 && currentSessionFolder) {
          const refs = await saveAttachments(currentSessionFolder, attachments);
          attachmentRefsJson = JSON.stringify(refs);
          setFilesVersion((v) => v + 1);
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('Failed to save attachments for mid-run reply:', error);
        }
      }

      // POST to the reply endpoint (include attachment refs so backend persists them)
      try {
        const response = await fetchWithRetry(
          `${AGENT_SERVER_URL}/agent/reply/${currentTaskId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: reply,
              ...(attachmentRefsJson && { attachments: attachmentRefsJson }),
              ...(subtype && { subtype }),
            }),
            signal: abortControllerRef.current?.signal,
          },
        );
        if (!response.ok) {
          if (import.meta.env.DEV) {
            const detail = await response.text().catch(() => '');
            console.error(
              `[useAgent] Mid-run reply delivery failed: ${response.status}`,
              detail,
            );
          }
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('[useAgent] Failed to send mid-run reply:', error);
        }
      }
    },
    [], // Uses refs only — no stale closure risk
  );

  // Continue conversation with context
  const continueConversation = useCallback(
    async (
      reply: string,
      attachments?: MessageAttachment[],
      modelOverride?: ModelOverride,
      mentionedMcpServers?: string[],
      pinnedSkills?: string[],
      options?: ContinueConversationOptions,
    ): Promise<void> => {
      const currentTaskId = taskIdRef.current;
      const currentSessionFolder = sessionFolderRef.current;
      const currentInitialPrompt = initialPromptRef.current;
      if (!currentTaskId) return;
      const subtype = options?.subtype;

      // Route to mid-run reply when agent is actively processing
      // Read from ref to avoid stale closure — isRunning state may be outdated
      if (isRunningRef.current) {
        await replyToRunningAgent(reply, attachments, subtype);
        return;
      }

      // Update stored override if caller supplies a new one (e.g. user switched model mid-task)
      if (modelOverride !== undefined) {
        modelOverrideRef.current = modelOverride;
      }

      const retryTarget = options?.retry
        ? getRetryTarget(messagesRef.current, reply)
        : null;
      const resumeSessionId = options?.resumeSessionId;
      const effectiveAttachments = attachments ?? retryTarget?.attachments;

      if (retryTarget) {
        // Retry reuses the existing user turn. Trim failed assistant/error
        // state so the new stream replaces it instead of appending after it.
        messagesRef.current = retryTarget.messages;
        setMessages(retryTarget.messages);
      } else {
        // Add user message to UI immediately (with attachments if any)
        const userMessage: AgentMessage = {
          type: 'user',
          content: reply,
          subtype,
          attachments:
            effectiveAttachments && effectiveAttachments.length > 0
              ? effectiveAttachments
              : undefined,
        };
        setMessages((prev) => [...prev, userMessage]);
      }

      // Mark as running BEFORE any async work to prevent the deferred DB
      // reload from a previous turn from firing and replacing state during
      // the await gap (which would remove the just-added user message and
      // cause text concatenation across turns).
      setIsRunning(true);
      isRunningRef.current = true;

      // Save user message to database (save attachments to files first)
      let savedRefs: AttachmentReference[] = [];
      try {
        let attachmentRefs: string | undefined;
        if (
          !retryTarget &&
          effectiveAttachments &&
          effectiveAttachments.length > 0 &&
          currentSessionFolder
        ) {
          const allRefs = await resolveFileAttachments(
            effectiveAttachments,
            currentSessionFolder,
            taskWorkDir || undefined,
            { taskId: currentTaskId, workDir: taskWorkDir || undefined },
          );
          savedRefs = allRefs;
          if (allRefs.length > 0) {
            attachmentRefs = JSON.stringify(allRefs);
            setFilesVersion((v) => v + 1);
          }
        }
        if (retryTarget) {
          await deletePersistedRetryTail(currentTaskId, reply);
        } else {
          await createMessage({
            task_id: currentTaskId,
            type: 'user',
            content: reply,
            attachments: attachmentRefs,
            subtype,
          });
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('Failed to save user message:', error);
        }
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        // Build conversation history from the ref to avoid stale closures —
        // the callback identity depends on `messages` but it may be stale by
        // the time async operations complete.
        const conversationHistory = buildConversationHistory(
          currentInitialPrompt,
          retryTarget?.messages ?? messagesRef.current,
        );

        // Resolve effective workspace directory — prefer session folder
        // to prevent the backend from creating a duplicate session-{taskId} folder
        const workDir =
          currentSessionFolder ||
          (await resolveEffectiveWorkDir(taskWorkDir, null));

        const config = applyModelOverride(
          getAgentRequestConfig(runtimeContext, 'execution'),
          modelOverrideRef.current,
        );

        // Prepare images for API (only send image attachments with actual data)
        const images = effectiveAttachments
          ?.filter((a) => a.type === 'image' && a.data && a.data.length > 0)
          .map((a) => ({
            data: a.data,
            mimeType: a.mimeType || 'image/png',
          }));

        // Augment prompt with non-image file paths so the agent knows about them
        let effectiveReply = reply;
        const promptAttachments =
          savedRefs.length > 0 ? savedRefs : effectiveAttachments;
        if (promptAttachments && promptAttachments.length > 0) {
          const fileRefs = promptAttachments.filter(
            (a) =>
              a.type === 'file' && ('data' in a ? a.path || a.data : a.path),
          );
          if (fileRefs.length > 0) {
            const fileList = fileRefs
              .map((a) => {
                const location =
                  'data' in a ? a.path || a.data || '(embedded)' : a.path;
                return `- ${a.name}: ${location}`;
              })
              .join('\n');
            effectiveReply = `[ATTACHED FILES — READ permission granted (exempt from workspace isolation). Use the Read tool directly:\n${fileList}]\n\n${reply}`;
          }
        }
        effectiveReply = prependAttachmentSourceContext(
          effectiveReply,
          promptAttachments,
        );
        effectiveReply = await appendInlineAttachmentContext(
          effectiveReply,
          effectiveAttachments,
        );

        // Debug logging for image attachments
        if (
          import.meta.env.DEV &&
          effectiveAttachments &&
          effectiveAttachments.length > 0
        ) {
          console.warn(
            '[useAgent] continueConversation attachments:',
            effectiveAttachments.length,
          );
          effectiveAttachments.forEach((att, i) => {
            if (import.meta.env.DEV)
              console.warn(
                `[useAgent] Attachment ${i}: type=${att.type}, hasData=${!!att.data}, dataLength=${att.data?.length || 0}, path=${att.path || 'none'}`,
              );
          });
          if (import.meta.env.DEV)
            console.warn(
              '[useAgent] Valid images for API:',
              images?.length || 0,
            );
        }

        // For non-Claude planning agents (Codex, Gemini, HTTP) in idle phase,
        // route task-type follow-up prompts through /plan first so the user
        // sees the plan → approve → execute flow, matching first-message behavior.
        const agentType = modelOverrideRef.current?.agentType;
        const shouldUsePlanFlow =
          phaseRef.current === 'idle' &&
          agentType &&
          agentType !== 'claude' &&
          !images?.length && // images go direct — no plan for multimodal
          !isConversationalPrompt(reply);

        if (shouldUsePlanFlow) {
          const planResp = await fetchWithRetry(
            `${AGENT_SERVER_URL}/agent/plan`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prompt: effectiveReply,
                taskId: currentTaskId,
                workDir,
                userWorkspaceDir: taskWorkDir || undefined,
                mentionedMcpServers:
                  mentionedMcpServers && mentionedMcpServers.length > 0
                    ? mentionedMcpServers
                    : undefined,
                pinnedSkills:
                  pinnedSkills && pinnedSkills.length > 0
                    ? pinnedSkills
                    : undefined,
                agentProfileId: agentProfileIdRef.current,
                ...config,
              }),
              signal: abortController.signal,
            },
          );

          if (!planResp.ok) throw new Error(`Server error: ${planResp.status}`);

          const planReader = planResp.body?.getReader();
          if (!planReader) throw new Error('No response body');
          const decoder = new TextDecoder();
          let buf = '';
          let gotPlan = false;

          while (true) {
            const { value, done } = await planReader.read();
            if (done) break;
            if (activeTaskIdRef.current !== currentTaskId) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const json = line.slice(6).trim();
              if (!json || json === '[DONE]') continue;
              try {
                const data = JSON.parse(json) as AgentMessage;
                if (data.type === 'plan' && data.plan) {
                  gotPlan = true;
                  setIsPlanRestored(false);
                  setPlan(data.plan);
                  setPhase('awaiting_approval');
                  setMessages((prev) => [
                    ...prev.filter(
                      (m) =>
                        m.type !== 'thinking' && m.type !== 'planning_status',
                    ),
                    data,
                  ]);
                } else if (data.type === 'direct_answer' && data.content) {
                  const actualContent =
                    extractStructuredDirectAnswer(data.content) ?? data.content;
                  setMessages((prev) => [
                    ...prev.filter(
                      (m) =>
                        m.type !== 'thinking' && m.type !== 'planning_status',
                    ),
                    { type: 'text', content: actualContent },
                  ]);
                } else if (data.type === 'text' && data.content) {
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.type === 'text') {
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...last,
                          content: (last.content || '') + data.content,
                        },
                      ];
                    }
                    return [...prev, data];
                  });
                } else if (data.type === 'thinking') {
                  setMessages((prev) => [
                    ...prev.filter(
                      (m) =>
                        m.type !== 'thinking' && m.type !== 'planning_status',
                    ),
                    data,
                  ]);
                } else if (data.type === 'error') {
                  setMessages((prev) => [...prev, data]);
                  if (!gotPlan) setPhase('idle');
                } else if (data.type === 'done') {
                  if (!gotPlan) setPhase('idle');
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
          return; // Don't fall through to the /agent call
        }

        const endpoint = resumeSessionId
          ? `${AGENT_SERVER_URL}/agent/resume`
          : `${AGENT_SERVER_URL}/agent`;
        const requestBody = resumeSessionId
          ? {
              resumeSessionId,
              prompt: effectiveReply,
              conversation: conversationHistory,
              contextTokensUsed: Math.ceil(
                (conversationHistory.reduce(
                  (total, message) => total + message.content.length,
                  0,
                ) +
                  effectiveReply.length) /
                  4,
              ),
              taskId: currentTaskId,
              workDir,
              language: config.language,
              runtimeContext,
              allowedFolders: config.allowedFolders,
              agentProfileId: agentProfileIdRef.current,
              modelConfig: config.modelConfig,
            }
          : {
              prompt: effectiveReply,
              conversation: conversationHistory,
              workDir,
              userWorkspaceDir: taskWorkDir || undefined,
              taskId: currentTaskId,
              images: images && images.length > 0 ? images : undefined,
              mentionedMcpServers:
                mentionedMcpServers && mentionedMcpServers.length > 0
                  ? mentionedMcpServers
                  : undefined,
              runContext: createTaskRunContext(currentTaskId, pinnedSkills),
              agentProfileId: agentProfileIdRef.current,
              ...config,
            };

        // Send conversation with full history or resume the provider session.
        const response = await fetchWithRetry(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }

        const streamResult = await processStream(
          response,
          currentTaskId,
          abortController,
        );

        // After stream completes, schedule a deferred reload from DB to ensure
        // the UI reflects any messages saved by the backend.  This acts as a
        // safety net: if the backend saved messages but the SSE stream was
        // interrupted or the client missed events, the DB will be the source
        // of truth.  We delay to give the backend time to flush writes.
        if (
          !streamResult?.pausedForQuestion &&
          activeTaskIdRef.current === currentTaskId
        ) {
          setTimeout(async () => {
            if (activeTaskIdRef.current !== currentTaskId) return;
            // Skip reload if another stream is already running (next turn started)
            if (isRunningRef.current) return;
            try {
              const dbMessages = await getMessagesByTaskId(currentTaskId);
              const persisted = mergeConsecutiveTextMessages(
                dbMessages.map(mapDbMessageToAgentMessage),
              );
              // Only update if DB has more messages; preserve loaded attachments
              setMessages((prev) => {
                if (persisted.length <= prev.length) return prev;
                return preserveLoadedAttachments(persisted, prev);
              });
            } catch {
              // Non-critical — UI already has streamed messages
            }
          }, DEFERRED_DB_RELOAD_DELAY);
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          const errorMessage = formatFetchError(error, '/agent');
          if (import.meta.env.DEV) {
            console.error('[useAgent] Continue conversation failed:', error);
          }

          // UI updates only for active task
          if (activeTaskIdRef.current === currentTaskId) {
            setMessages((prev) => [
              ...prev,
              {
                type: 'error',
                message: errorMessage,
              },
            ]);
          }

          // Save client-side error to DB (fetch/stream failures the backend never sees)
          try {
            await createMessage({
              task_id: currentTaskId,
              type: 'error',
              error_message: errorMessage,
            });
            await updateTask(currentTaskId, { status: 'error' });
          } catch (dbError) {
            if (import.meta.env.DEV) {
              console.error('Failed to save error:', dbError);
            }
          }
        }
      } finally {
        // Only update running state if this is still the active task
        if (activeTaskIdRef.current === currentTaskId) {
          setIsRunning(false);
          abortControllerRef.current = null;
        }
      }
    },
    [processStream, taskWorkDir, runtimeContext, replyToRunningAgent],
  );

  const stopAgent = useCallback(async () => {
    // Stop polling if active
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }

    // Stop observer subscription if active
    if (observerAbortRef.current) {
      observerAbortRef.current.abort();
      observerAbortRef.current = null;
    }

    // Abort the fetch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Also tell the server to stop
    if (sessionIdRef.current) {
      try {
        await fetch(`${AGENT_SERVER_URL}/agent/stop/${sessionIdRef.current}`, {
          method: 'POST',
        });
      } catch {
        // Ignore errors
      }
    }

    // Cancel any pending debounced plan persist
    if (planUpdateTimerRef.current) {
      clearTimeout(planUpdateTimerRef.current);
      planUpdateTimerRef.current = null;
    }

    // Persist plan with completed steps preserved, in_progress/pending marked as cancelled
    const stopMsgId = planMessageIdRef.current;
    if (stopMsgId) {
      setPlan((currentPlan) => {
        if (!currentPlan) return currentPlan;
        const stoppedPlan = {
          ...currentPlan,
          steps: currentPlan.steps.map((step) => ({
            ...step,
            status:
              step.status === 'completed'
                ? ('completed' as const)
                : ('cancelled' as const),
          })),
        };
        // Side effect moved outside updater scope via captured msgId
        // Using queueMicrotask to avoid calling during render
        queueMicrotask(() => {
          updateMessageContent(stopMsgId, JSON.stringify(stoppedPlan));
        });
        return stoppedPlan;
      });
    }

    // Update task status — use ref to avoid stale closure
    const currentTaskId = taskIdRef.current;
    if (currentTaskId) {
      try {
        await updateTask(currentTaskId, { status: 'stopped' });
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('Failed to update task status:', error);
        }
      }
    }

    setIsRunning(false);
  }, []);

  const clearMessages = useCallback(() => {
    // Stop polling if active
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }

    // Stop observer subscription if active
    if (observerAbortRef.current) {
      observerAbortRef.current.abort();
      observerAbortRef.current = null;
    }

    // This function is for complete cleanup (e.g., starting fresh)
    // For task switching, use loadTask which handles moving to background
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Reset plan persistence refs
    planMessageIdRef.current = null;
    if (planUpdateTimerRef.current) {
      clearTimeout(planUpdateTimerRef.current);
      planUpdateTimerRef.current = null;
    }

    setMessages([]);
    setTaskId(null);
    setInitialPrompt('');
    setPendingPermission(null);
    setPendingQuestion(null);
    setPhase('idle');
    setPlan(null);
    setIsPlanRestored(false);
    setIsRunning(false);
    sessionIdRef.current = null;
    activeTaskIdRef.current = null;
  }, []);

  // Respond to permission request
  const respondToPermission = useCallback(
    async (permissionId: string, approved: boolean): Promise<void> => {
      if (!sessionIdRef.current) {
        if (import.meta.env.DEV)
          console.error('No active session to respond to permission');
        return;
      }

      try {
        const response = await fetch(`${AGENT_SERVER_URL}/agent/permission`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            permissionId,
            approved,
          }),
        });

        if (!response.ok) {
          throw new Error(
            `Failed to respond to permission: ${response.status}`,
          );
        }

        // Clear pending permission
        setPendingPermission(null);

        // Add response message to UI
        const responseMessage: AgentMessage = {
          type: 'text',
          content: approved
            ? 'Permission granted. Continuing...'
            : 'Permission denied. Operation cancelled.',
        };
        setMessages((prev) => [...prev, responseMessage]);
      } catch (error) {
        if (import.meta.env.DEV)
          console.error('Failed to respond to permission:', error);
        setPendingPermission(null);
      }
    },
    [],
  );

  // Respond to question from AskUserQuestion tool
  const respondToQuestion = useCallback(
    async (
      _questionId: string,
      answers: Record<string, string>,
    ): Promise<void> => {
      if (!taskIdRef.current || !pendingQuestion) {
        if (import.meta.env.DEV) {
          console.error('No active task or pending question');
        }
        return;
      }

      // Format answers as a readable message
      const answerText = Object.entries(answers)
        .map(([question, answer]) => `${question} → ${answer}`)
        .join('\n');
      const questionId = pendingQuestion.id;

      // Clear pending question first
      setPendingQuestion(null);

      await answerBackendAgentQuestion(questionId, answers).catch(() => {});

      // Continue the conversation — pass subtype so the message gets tagged
      // as a question answer (both in UI and persisted to DB).
      await continueConversation(
        answerText,
        undefined,
        undefined,
        undefined,
        undefined,
        { subtype: 'question_answer' },
      );
    },
    [pendingQuestion, continueConversation],
  );

  // taskFolder is now the same as sessionFolder (no task subfolders)
  const taskFolder = sessionFolder;

  // Track background tasks
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);

  // Subscribe to background task changes
  useEffect(() => {
    const unsubscribe = subscribeToBackgroundTasks((tasks) => {
      setBackgroundTasks(tasks);
    });
    return unsubscribe;
  }, []);

  // Cleanup on unmount - move running task to background instead of abandoning it
  useEffect(() => {
    return () => {
      // Stop polling if active
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }

      // Abort any observer SSE subscription
      if (observerAbortRef.current) {
        observerAbortRef.current.abort();
        observerAbortRef.current = null;
      }

      // Cancel any pending debounced plan persist
      if (planUpdateTimerRef.current) {
        clearTimeout(planUpdateTimerRef.current);
        planUpdateTimerRef.current = null;
      }

      // If there's a running task when unmounting, move it to background
      // so it continues running and shows in the sidebar
      const currentTaskId = taskIdRef.current;
      const currentIsRunning = isRunningRef.current;
      const currentPrompt = initialPromptRef.current;

      if (abortControllerRef.current && currentTaskId && currentIsRunning) {
        if (import.meta.env.DEV) {
          console.warn(
            '[useAgent] Moving task to background on unmount:',
            currentTaskId,
          );
        }
        addBackgroundTask({
          taskId: currentTaskId,
          sessionId: sessionIdRef.current || '',
          abortController: abortControllerRef.current,
          isRunning: true,
          prompt: currentPrompt,
        });
        // Don't clear refs here since the effect is cleaning up
        // The stream will continue to run and save to database
      }
    };
  }, []);

  // Get count of running background tasks
  const runningBackgroundTaskCount = backgroundTasks.filter(
    (t) => t.isRunning,
  ).length;

  return {
    messages,
    isRunning,
    taskId,
    sessionId: currentSessionId,
    agentSessionId,
    taskIndex: currentTaskIndex,
    sessionFolder,
    taskFolder,
    filesVersion,
    pendingPermission,
    pendingQuestion,
    phase,
    plan,
    setPlan,
    isPlanRestored,
    runAgent,
    approvePlan,
    rejectPlan,
    continueConversation,
    stopAgent,
    clearMessages,
    loadTask,
    loadMessages,
    respondToPermission,
    respondToQuestion,
    setSessionInfo,
    // Background tasks
    backgroundTasks,
    runningBackgroundTaskCount,
  };
}
