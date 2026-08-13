import {
  EventType,
  type BaseEvent,
  type CustomEvent,
  type ReasoningMessageContentEvent,
  type TextMessageChunkEvent,
  type TextMessageContentEvent,
  type ToolCallArgsEvent,
  type ToolCallChunkEvent,
  type ToolCallResultEvent,
  type ToolCallStartEvent,
} from '@ag-ui/core';

import {
  getMessagesByTaskId,
  getTask,
  updateTask,
  type Message,
} from '@/shared/db';
import { getSettings } from '@/shared/db/settings';
import type { AttachmentReference } from '@/shared/lib/attachments';
import { normalizeAgentQuestions } from '@/shared/questions/question-policy';
import { randomUUID } from '@/shared/utils/uuid';

import { prependAttachmentSourceContext } from './agent-attachment-context';
import {
  DEFAULT_MAX_CONVERSATION_TURNS,
  STEP_HEURISTIC_MULTIPLIER,
} from './agent-constants';
import type {
  AgentMessage,
  AgentPhase,
  ConversationMessage,
  MessageAttachment,
  PendingQuestion,
  TaskObserverContext,
  TaskPlan,
} from './agent-types';
import { AGENT_SERVER_URL } from './agent-utils';

const OBSERVER_STREAM_RECONNECT_WINDOW_MS = 60_000;
const OBSERVER_STREAM_RECONNECT_DELAY_MS = 1000;

// Build conversation history from messages
export function buildConversationHistory(
  initialPrompt: string,
  messages: AgentMessage[],
): ConversationMessage[] {
  const history: ConversationMessage[] = [];

  // Add initial user prompt
  if (initialPrompt) {
    history.push({ role: 'user', content: initialPrompt });
  }

  // Process messages to build conversation
  let currentAssistantContent = '';

  for (const msg of messages) {
    if (msg.type === 'user') {
      // Before adding user message, flush any accumulated assistant content
      if (currentAssistantContent) {
        history.push({
          role: 'assistant',
          content: currentAssistantContent.trim(),
        });
        currentAssistantContent = '';
      }

      // Extract image paths from attachments if present
      const imagePaths = msg.attachments
        ?.filter((a) => a.type === 'image' && a.path)
        .map((a) => a.path as string);

      history.push({
        role: 'user',
        content: prependAttachmentSourceContext(
          msg.content || '',
          msg.attachments,
        ),
        imagePaths:
          imagePaths && imagePaths.length > 0 ? imagePaths : undefined,
      });
    } else if (msg.type === 'text') {
      // Accumulate assistant text
      currentAssistantContent += (msg.content || '') + '\n';
    } else if (msg.type === 'tool_use') {
      // Include tool use as part of assistant's response
      currentAssistantContent += `[Used tool: ${msg.name}]\n`;
    }
  }

  // Flush remaining assistant content
  if (currentAssistantContent) {
    history.push({
      role: 'assistant',
      content: currentAssistantContent.trim(),
    });
  }

  // Apply history length limit - keep only the most recent messages
  // Get max conversation turns from settings, fallback to default
  const settings = getSettings();
  const maxTurns =
    settings.maxConversationTurns || DEFAULT_MAX_CONVERSATION_TURNS;
  const maxMessages = maxTurns * STEP_HEURISTIC_MULTIPLIER; // 2 messages per turn (user + assistant)

  if (history.length > maxMessages) {
    if (import.meta.env.DEV) {
      console.warn(
        `[buildConversationHistory] Truncating history from ${history.length} to ${maxMessages} messages (max turns: ${maxTurns})`,
      );
    }
    return history.slice(-maxMessages);
  }

  return history;
}

/**
 * Run post-stream recovery: reload final messages from DB,
 * recover stale task status, and restore plan state.
 */
async function runStreamRecovery(
  targetTaskId: string,
  ctx: TaskObserverContext,
): Promise<void> {
  if (ctx.activeTaskIdRef.current !== targetTaskId) return;
  try {
    const finalDb = await getMessagesByTaskId(targetTaskId);
    const finalAgent = mergeConsecutiveTextMessages(
      finalDb.map(mapDbMessageToAgentMessage),
    );
    ctx.setMessages((prev) => preserveLoadedAttachments(finalAgent, prev));
    await recoverStaleTaskStatus(targetTaskId, finalAgent, finalDb);
    const task = await getTask(targetTaskId);
    await restorePlanFromMessages(targetTaskId, finalAgent, finalDb, {
      isRestoringFromBackground: false,
      taskIsCompleted: task?.status === 'completed',
      taskIsStopped: task?.status === 'stopped',
      setPlan: ctx.setPlan,
      setPhase: ctx.setPhase,
      setIsPlanRestored: () => {},
    });
  } catch {
    // Non-critical — UI already has streamed messages
  }
}

/**
 * Subscribe to a task's live SSE stream from the backend event bus.
 * Replays buffered messages then delivers live events.
 * Falls back to loading from database if the endpoint is unavailable.
 */
export async function observeTaskStream(
  targetTaskId: string,
  abortCtrl: AbortController,
  ctx: TaskObserverContext,
): Promise<void> {
  let lastEventId: number | null = null;
  let reconnectDeadline = 0;

  try {
    while (!abortCtrl.signal.aborted) {
      try {
        const response = await fetch(
          getObserverStreamUrl(targetTaskId, lastEventId),
          { signal: abortCtrl.signal },
        );
        if (!response.ok || !response.body) {
          if (import.meta.env.DEV) {
            console.warn(
              '[useAgent] Subscribe endpoint not available, falling back to DB',
            );
          }
          const dbMessages = await getMessagesByTaskId(targetTaskId);
          if (ctx.activeTaskIdRef.current === targetTaskId) {
            const freshMessages = mergeConsecutiveTextMessages(
              dbMessages.map(mapDbMessageToAgentMessage),
            );
            ctx.setMessages((prev) =>
              preserveLoadedAttachments(freshMessages, prev),
            );
          }
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let pendingEventId: number | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('id: ')) {
              pendingEventId = parseObserverEventId(line.slice(4));
              continue;
            }
            if (!line.startsWith('data: ')) continue;
            if (pendingEventId !== null) {
              lastEventId = pendingEventId;
              pendingEventId = null;
            }
            reconnectDeadline = 0;
            try {
              const data = JSON.parse(line.slice(6)) as AgentMessage;

              // Bail if user switched to a different task
              if (ctx.activeTaskIdRef.current !== targetTaskId) {
                reader.cancel();
                return;
              }

              if (data.type === 'done') {
                ctx.setIsRunning(false);
                ctx.isRunningRef.current = false;
                ctx.setPhase('idle');
                reader.cancel();

                // Run recovery before aborting — the finally block skips
                // recovery when abortCtrl.signal.aborted is true.
                await runStreamRecovery(targetTaskId, ctx);

                abortCtrl.abort();
                return;
              }

              if (data.type === 'error') {
                ctx.setIsRunning(false);
                ctx.isRunningRef.current = false;
                ctx.setPhase('idle');
                ctx.setMessages((prev) => [...prev, data]);
                reader.cancel();

                await runStreamRecovery(targetTaskId, ctx);

                abortCtrl.abort();
                return;
              }

              if (data.type === 'plan' && data.plan) {
                ctx.setPlan(data.plan);
                // Don't set phase to awaiting_approval — the other client handles approval
              }

              // Accumulate consecutive text deltas into one message
              // (consistent with the main SSE handler)
              if (data.type === 'text' && data.content) {
                ctx.setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last && last.type === 'text') {
                    const existing = last.content || '';
                    // Skip exact duplicate (Codex can repeat full messages)
                    if (
                      data.content!.length > 20 &&
                      existing.endsWith(data.content!)
                    ) {
                      return prev;
                    }
                    return [
                      ...prev.slice(0, -1),
                      { ...last, content: existing + data.content },
                    ];
                  }
                  return [...prev, data];
                });
              } else {
                ctx.setMessages((prev) => [...prev, data]);
              }
            } catch {
              // Ignore SSE parse errors
            }
          }
        }

        if (abortCtrl.signal.aborted) return;
        if (ctx.activeTaskIdRef.current !== targetTaskId) return;
        if (!(await waitForObserverReconnect(abortCtrl.signal))) return;
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        if (import.meta.env.DEV) {
          console.warn('[useAgent] Observer subscription error:', error);
        }
        if (!(await waitForObserverReconnect(abortCtrl.signal))) return;
      }
    }
  } finally {
    // Only run cleanup if this observer is still the active one.
    // Check both the active task AND that this observer wasn't aborted
    // (prevents race when user switches away then back to the same task —
    // the old aborted observer's finally must not clobber the new observer).
    if (
      ctx.activeTaskIdRef.current === targetTaskId &&
      !abortCtrl.signal.aborted
    ) {
      ctx.setIsRunning(false);
      ctx.isRunningRef.current = false;
      ctx.setPhase('idle');
      // Reload final state from DB and restore plan / recover stale status
      await runStreamRecovery(targetTaskId, ctx);
    }
  }

  async function waitForObserverReconnect(
    signal: AbortSignal,
  ): Promise<boolean> {
    if (signal.aborted) return false;
    const now = Date.now();
    if (reconnectDeadline === 0) {
      reconnectDeadline = now + OBSERVER_STREAM_RECONNECT_WINDOW_MS;
    }
    if (now >= reconnectDeadline) return false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, OBSERVER_STREAM_RECONNECT_DELAY_MS);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    return !signal.aborted;
  }
}

function getObserverStreamUrl(
  targetTaskId: string,
  lastEventId: number | null,
): string {
  const url = new URL(
    `${AGENT_SERVER_URL}/agent/subscribe/${encodeURIComponent(targetTaskId)}`,
  );
  if (lastEventId !== null) {
    url.searchParams.set('from', String(lastEventId));
  }
  return url.toString();
}

function parseObserverEventId(raw: string): number | null {
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Map a database Message row to an AgentMessage for the UI. */
export function mapDbMessageToAgentMessage(msg: Message): AgentMessage {
  if (msg.type === 'plan' && msg.content) {
    try {
      const planData = JSON.parse(msg.content) as TaskPlan;
      return { type: 'plan' as const, plan: planData };
    } catch {
      return {
        type: msg.type as AgentMessage['type'],
        content: msg.content || undefined,
      };
    }
  }
  let parsedInput: unknown;
  if (msg.tool_input) {
    try {
      parsedInput = JSON.parse(msg.tool_input);
    } catch {
      parsedInput = msg.tool_input;
    }
  }

  // Parse attachment references for user messages
  let attachments: MessageAttachment[] | undefined;
  if (msg.type === 'user' && msg.attachments) {
    try {
      const refs = JSON.parse(msg.attachments) as AttachmentReference[];
      if (refs.length > 0 && 'path' in refs[0]) {
        attachments = refs.map((ref) => ({
          id: ref.id,
          type: ref.type,
          name: ref.name,
          data: '',
          mimeType: ref.mimeType,
          path: ref.path,
          sourceContext: ref.sourceContext,
          isLoading: true,
        }));
      } else if (refs.length > 0) {
        attachments = refs as unknown as MessageAttachment[];
      }
    } catch {
      // Ignore parse errors
    }
  }

  const result: AgentMessage = {
    type: msg.type as AgentMessage['type'],
    content: msg.content || undefined,
    name: msg.tool_name || undefined,
    input: parsedInput,
    output: msg.tool_output || undefined,
    toolUseId: msg.tool_use_id || undefined,
    subtype: msg.subtype as AgentMessage['subtype'],
    message: msg.error_message || undefined,
    attachments,
  };

  // Restore cost/usage/model from DB columns
  if (msg.cost != null) result.cost = msg.cost;
  if (
    msg.usage_input != null ||
    msg.usage_output != null ||
    msg.usage_cache_read != null ||
    msg.usage_cache_creation != null
  ) {
    result.usage = {
      input_tokens: msg.usage_input ?? undefined,
      output_tokens: msg.usage_output ?? undefined,
      cache_read_input_tokens: msg.usage_cache_read ?? undefined,
      cache_creation_input_tokens: msg.usage_cache_creation ?? undefined,
    };
  }
  if (msg.model) result.model = msg.model;

  // Hydrate trace fields from existing DB columns (no migration needed)
  if (msg.created_at) result.startedAt = msg.created_at;
  if (msg.type === 'tool_result' && msg.tool_use_id) {
    result.parentId = msg.tool_use_id;
  }

  return result;
}

/**
 * Merge consecutive text messages in an array.
 *
 * The server now accumulates text and flushes one row per boundary (tool call,
 * stream end, etc.) — see `createSSEStream` flush-on-boundary logic.
 * This function acts as a backward-compatibility safety net for older DB rows
 * that were stored as individual streaming tokens.
 *
 * Turn boundaries (tool_use, tool_result, user, result, error, etc.) naturally
 * break the merge chain because they are non-text types.
 */
export function mergeConsecutiveTextMessages(
  msgs: AgentMessage[],
): AgentMessage[] {
  const result: AgentMessage[] = [];
  for (const msg of msgs) {
    const last = result[result.length - 1];
    if (msg.type === 'text' && msg.content && last && last.type === 'text') {
      const existing = last.content || '';
      // Skip exact duplicate content (Codex can emit identical messages)
      if (msg.content.length > 20 && existing.endsWith(msg.content)) {
        continue;
      }
      result[result.length - 1] = {
        ...last,
        content: existing + msg.content,
      };
    } else {
      result.push(msg);
    }
  }
  return result;
}

/**
 * Restore plan state from loaded messages.
 * Determines whether the task was in an awaiting_approval state (plan with
 * incomplete steps and no execution after it) and restores the plan + phase
 * accordingly.  Also performs stale-task recovery: if the task is still
 * marked 'running' in DB but has a result/error message, the DB status is
 * corrected.
 */
export async function restorePlanFromMessages(
  taskId: string,
  agentMessages: AgentMessage[],
  dbMessages: Message[],
  opts: {
    isRestoringFromBackground: boolean;
    taskIsCompleted: boolean;
    taskIsStopped: boolean;
    setPlan: (plan: TaskPlan | null) => void;
    setPhase: (phase: AgentPhase) => void;
    setIsPlanRestored: (v: boolean) => void;
  },
): Promise<void> {
  if (opts.isRestoringFromBackground) return;

  const lastPlanMessage = [...agentMessages]
    .reverse()
    .find((m) => m.type === 'plan' && m.plan);

  if (
    lastPlanMessage &&
    lastPlanMessage.type === 'plan' &&
    lastPlanMessage.plan
  ) {
    const planSteps = lastPlanMessage.plan.steps || [];
    const hasIncompleteSteps = planSteps.some(
      (s) => !s.status || s.status === 'pending',
    );

    // Check if execution already started after the plan
    const lastPlanIdx = dbMessages.reduce(
      (acc, msg, idx) => (msg.type === 'plan' ? idx : acc),
      -1,
    );
    const hasExecutionAfterPlan =
      lastPlanIdx >= 0 &&
      dbMessages
        .slice(lastPlanIdx + 1)
        .some((m) => m.type === 'tool_use' || m.type === 'result');

    if (
      hasIncompleteSteps &&
      !opts.taskIsCompleted &&
      !opts.taskIsStopped &&
      !hasExecutionAfterPlan
    ) {
      if (import.meta.env.DEV) {
        console.warn(
          '[useAgent] Restoring plan awaiting approval for task:',
          taskId,
          {
            planSteps: planSteps.map((s) => ({
              description: s.description,
              status: s.status,
            })),
          },
        );
      }
      opts.setIsPlanRestored(true);
      opts.setPlan(lastPlanMessage.plan);
      opts.setPhase('awaiting_approval');
    }
  }
}

/**
 * Restore pending question state from loaded messages.
 * Scans DB messages for an unanswered AskUserQuestion tool_use and restores
 * the question UI so the user can answer it after switching back to the task.
 */
export function restoreQuestionFromMessages(
  dbMessages: Message[],
  opts: {
    taskIsCompleted: boolean;
    isRestoringFromBackground: boolean;
    setPendingQuestion: (q: PendingQuestion | null) => void;
  },
): void {
  // Don't restore questions for background tasks (live stream handles them)
  if (opts.isRestoringFromBackground) return;
  // Don't restore for completed tasks
  if (opts.taskIsCompleted) return;

  // Scan from the end to find the last AskUserQuestion tool_use
  let lastQuestionIdx = -1;
  for (let i = dbMessages.length - 1; i >= 0; i--) {
    if (
      dbMessages[i].type === 'tool_use' &&
      dbMessages[i].tool_name === 'AskUserQuestion'
    ) {
      lastQuestionIdx = i;
      break;
    }
  }

  if (lastQuestionIdx === -1) return;

  // Check if there's already an answer after the question
  const hasAnswer = dbMessages
    .slice(lastQuestionIdx + 1)
    .some((m) => m.type === 'user' && m.subtype === 'question_answer');

  if (hasAnswer) return;

  // Parse the question from tool_input
  const questionMsg = dbMessages[lastQuestionIdx];
  if (!questionMsg.tool_input) return;

  try {
    const questions = normalizeAgentQuestions(
      JSON.parse(questionMsg.tool_input),
    );
    if (questions.length === 0) return;

    const toolUseId = questionMsg.tool_use_id;
    if (!toolUseId) return; // can't answer without matching tool_use_id

    if (import.meta.env.DEV) {
      console.warn(
        '[restoreQuestionFromMessages] Restoring pending question:',
        { toolUseId, questionCount: questions.length },
      );
    }

    opts.setPendingQuestion({
      id: `question_${randomUUID()}`,
      toolUseId,
      questions,
    });
  } catch {
    // Ignore parse errors
  }
}

/**
 * Preserve already-loaded attachment data when messages are reloaded from DB.
 * Matches individual attachments by their unique ID, keeping in-memory
 * image data instead of replacing with empty placeholders.
 */
export function preserveLoadedAttachments(
  newMessages: AgentMessage[],
  existingMessages: AgentMessage[],
): AgentMessage[] {
  if (existingMessages.length === 0) return newMessages;

  // Build a lookup of loaded attachments by their unique ID
  const loadedById = new Map<string, MessageAttachment>();
  for (const msg of existingMessages) {
    if (msg.type === 'user' && msg.attachments) {
      for (const att of msg.attachments) {
        if (!att.isLoading && att.data) {
          loadedById.set(att.id, att);
        }
      }
    }
  }

  if (loadedById.size === 0) return newMessages;

  return newMessages.map((msg) => {
    if (msg.type === 'user' && msg.attachments?.some((a) => a.isLoading)) {
      const merged = msg.attachments.map((a) => {
        if (a.isLoading) {
          const cached = loadedById.get(a.id);
          if (cached) return cached;
        }
        return a;
      });
      return { ...msg, attachments: merged };
    }
    return msg;
  });
}

/**
 * Recover a stale 'running' task status by inspecting loaded messages.
 * Called from the observer finally block after the SSE stream ends.
 */
export async function recoverStaleTaskStatus(
  taskId: string,
  agentMessages: AgentMessage[],
  dbMessages: Message[],
): Promise<void> {
  // Re-fetch the current task status from DB
  const task = await getTask(taskId);
  if (!task || task.status !== 'running') return;

  // Check if there's a result message
  const resultMsg = agentMessages.find((m) => m.type === 'result');
  if (resultMsg) {
    if (resultMsg.subtype === 'success') {
      await updateTask(taskId, { status: 'completed' });
    } else if (resultMsg.subtype === 'error_max_turns') {
      // Keep as running — max turns means the task can continue
    } else {
      await updateTask(taskId, { status: 'error' });
    }
    return;
  }

  // Check if there's an error message
  const errorMsg = agentMessages.find((m) => m.type === 'error');
  if (errorMsg) {
    await updateTask(taskId, { status: 'error' });
    return;
  }

  // Check if there's a plan — keep running if execution is in progress or awaiting approval
  const lastPlanMessage = [...agentMessages]
    .reverse()
    .find((m) => m.type === 'plan' && m.plan);
  if (lastPlanMessage && lastPlanMessage.plan) {
    const hasIncompleteSteps = (lastPlanMessage.plan.steps || []).some(
      (s) => !s.status || s.status === 'pending' || s.status === 'in_progress',
    );
    const lastPlanIdx = dbMessages.reduce(
      (acc, msg, idx) => (msg.type === 'plan' ? idx : acc),
      -1,
    );
    const hasExecutionAfterPlan =
      lastPlanIdx >= 0 &&
      dbMessages
        .slice(lastPlanIdx + 1)
        .some((m) => m.type === 'tool_use' || m.type === 'result');

    if (hasIncompleteSteps && !hasExecutionAfterPlan) {
      // Plan is awaiting approval — keep task as 'running'
      return;
    }

    if (hasExecutionAfterPlan) {
      // Execution started but no result/error yet — agent is likely still
      // running on the server. Keep as 'running' to avoid false cancellation
      // when the user switches between tasks.
      return;
    }
  }

  // No result, no error, no pending plan — task was abandoned
  await updateTask(taskId, { status: 'stopped' });
}

// ── AG-UI event converter ────────────────────────────────────────────────────

/** Per-stream mutable state for aguiToAgentMessage. Instantiate once per stream session. */
export interface AGUIConverterState {
  pendingText: AgentMessage | null;
  pendingThinking: AgentMessage | null;
  pendingToolArgs: Record<string, string>;
}

export function createAGUIConverterState(): AGUIConverterState {
  return { pendingText: null, pendingThinking: null, pendingToolArgs: {} };
}

/**
 * Maps a single AG-UI BaseEvent to zero or more AgentMessages.
 * Must be called with the same `state` object for consecutive events in a run —
 * state carries partial message accumulators across events.
 */
export function aguiToAgentMessage(
  event: BaseEvent,
  state: AGUIConverterState,
): AgentMessage[] {
  switch (event.type) {
    case EventType.TEXT_MESSAGE_CONTENT: {
      const e = event as TextMessageContentEvent;
      if (!state.pendingText)
        state.pendingText = { type: 'text', id: e.messageId, content: '' };
      state.pendingText = {
        ...state.pendingText,
        content: (state.pendingText.content || '') + e.delta,
      };
      return [];
    }
    case EventType.TEXT_MESSAGE_END: {
      if (!state.pendingText) return [];
      const msg = state.pendingText;
      state.pendingText = null;
      return [msg];
    }
    case EventType.TEXT_MESSAGE_CHUNK: {
      const e = event as TextMessageChunkEvent;
      if (e.delta !== undefined) {
        if (!state.pendingText)
          state.pendingText = { type: 'text', id: e.messageId, content: '' };
        state.pendingText = {
          ...state.pendingText,
          content: (state.pendingText.content || '') + e.delta,
        };
        return [];
      } else {
        if (!state.pendingText) return [];
        const msg = state.pendingText;
        state.pendingText = null;
        return [msg];
      }
    }
    case EventType.TOOL_CALL_START: {
      const e = event as ToolCallStartEvent;
      state.pendingToolArgs[e.toolCallId] = '';
      return [
        {
          type: 'tool_use',
          id: e.toolCallId,
          name: e.toolCallName ?? 'unknown',
          input: {},
        },
      ];
    }
    case EventType.TOOL_CALL_ARGS: {
      const e = event as ToolCallArgsEvent;
      state.pendingToolArgs[e.toolCallId] =
        (state.pendingToolArgs[e.toolCallId] ?? '') + e.delta;
      return [];
    }
    case EventType.TOOL_CALL_CHUNK: {
      const e = event as ToolCallChunkEvent;
      const id = e.toolCallId ?? randomUUID();
      if (e.toolCallName) {
        state.pendingToolArgs[id] = e.delta ?? '';
        return [{ type: 'tool_use', id, name: e.toolCallName, input: {} }];
      }
      if (e.delta) {
        state.pendingToolArgs[id] = (state.pendingToolArgs[id] ?? '') + e.delta;
      }
      return [];
    }
    case EventType.TOOL_CALL_RESULT: {
      const e = event as ToolCallResultEvent;
      delete state.pendingToolArgs[e.toolCallId];
      return [
        { type: 'tool_result', toolUseId: e.toolCallId, output: e.content },
      ];
    }
    case EventType.REASONING_MESSAGE_CONTENT: {
      const e = event as ReasoningMessageContentEvent;
      if (!state.pendingThinking)
        state.pendingThinking = { type: 'thinking', content: '' };
      state.pendingThinking = {
        ...state.pendingThinking,
        content: (state.pendingThinking.content ?? '') + e.delta,
      };
      return [];
    }
    case EventType.REASONING_MESSAGE_END: {
      if (!state.pendingThinking) return [];
      const msg = state.pendingThinking;
      state.pendingThinking = null;
      return [msg];
    }
    case EventType.CUSTOM: {
      const e = event as CustomEvent;
      if (e.name === 'plan')
        return [{ type: 'plan', plan: e.value as TaskPlan }];
      if (e.name === 'direct_answer')
        return [{ type: 'direct_answer', content: e.value as string }];
      if (e.name === 'planning_status') {
        const val = e.value as {
          content?: string;
          elapsedMs?: number;
          thinkingText?: string;
        };
        return [
          {
            type: 'planning_status',
            content: val.content,
            elapsedMs: val.elapsedMs,
            thinkingText: val.thinkingText,
          },
        ];
      }
      return [];
    }
    case EventType.RUN_FINISHED:
      return [{ type: 'done' }];
    case EventType.RUN_ERROR: {
      const e = event as unknown as { message: string };
      return [{ type: 'error', message: e.message }];
    }
    default:
      return [];
  }
}

/**
 * Subscribe to a task's live AG-UI event stream from the backend event bus.
 * Parallel to observeTaskStream() but consumes AG-UI events and converts them
 * to AgentMessage[] before dispatching through TaskObserverContext.
 */
export async function observeAGUIStream(
  targetTaskId: string,
  abortCtrl: AbortController,
  ctx: TaskObserverContext,
): Promise<void> {
  const state = createAGUIConverterState();

  try {
    const response = await fetch(
      `${AGENT_SERVER_URL}/ag-ui/subscribe/${targetTaskId}`,
      { signal: abortCtrl.signal },
    );
    if (!response.ok || !response.body) {
      if (import.meta.env.DEV) {
        console.warn(
          '[observeAGUIStream] AG-UI subscribe endpoint not available, falling back to DB',
        );
      }
      const dbMessages = await getMessagesByTaskId(targetTaskId);
      if (ctx.activeTaskIdRef.current === targetTaskId) {
        const freshMessages = mergeConsecutiveTextMessages(
          dbMessages.map(mapDbMessageToAgentMessage),
        );
        ctx.setMessages((prev) =>
          preserveLoadedAttachments(freshMessages, prev),
        );
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6)) as BaseEvent;

          if (ctx.activeTaskIdRef.current !== targetTaskId) {
            reader.cancel();
            return;
          }

          const converted = aguiToAgentMessage(event, state);
          for (const data of converted) {
            if (data.type === 'done') {
              ctx.setIsRunning(false);
              ctx.isRunningRef.current = false;
              ctx.setPhase('idle');
              reader.cancel();
              await runStreamRecovery(targetTaskId, ctx);
              abortCtrl.abort();
              return;
            }

            if (data.type === 'error') {
              ctx.setIsRunning(false);
              ctx.isRunningRef.current = false;
              ctx.setPhase('idle');
              ctx.setMessages((prev) => [...prev, data]);
              reader.cancel();
              await runStreamRecovery(targetTaskId, ctx);
              abortCtrl.abort();
              return;
            }

            if (data.type === 'plan' && data.plan) {
              ctx.setPlan(data.plan);
            }

            if (data.type === 'planning_status') {
              // Replace previous planning_status/thinking to avoid bloat
              ctx.setMessages((prev) => {
                const withoutStatus = prev.filter(
                  (m) => m.type !== 'planning_status' && m.type !== 'thinking',
                );
                return [...withoutStatus, data];
              });
            } else if (data.type === 'text' && data.content) {
              ctx.setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.type === 'text') {
                  return [
                    ...prev.slice(0, -1),
                    { ...last, content: (last.content || '') + data.content },
                  ];
                }
                return [...prev, data];
              });
            } else {
              ctx.setMessages((prev) => [...prev, data]);
            }
          }
        } catch {
          // Ignore SSE parse errors
        }
      }
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    if (import.meta.env.DEV) {
      console.warn('[observeAGUIStream] Subscription error:', error);
    }
  } finally {
    if (
      ctx.activeTaskIdRef.current === targetTaskId &&
      !abortCtrl.signal.aborted
    ) {
      ctx.setIsRunning(false);
      ctx.isRunningRef.current = false;
      ctx.setPhase('idle');
      await runStreamRecovery(targetTaskId, ctx);
    }
  }
}
