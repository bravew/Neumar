import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createChatPanelAguiState,
  finalizeChatPanelAguiState,
  isChatPanelAguiEventPayload,
  reduceChatPanelAguiEvent,
  type ChatPanelAguiAccumulator,
  type ChatPanelAguiEvent,
  type ChatPanelMessage,
  type ChatToolCall,
  type ChatToolCallStage,
} from '@/components/shared/chat-panel';
import { API_BASE_URL } from '@/config';
import type { RunContextEnvelopeDto } from '@/shared/types/run-context';
import type {
  VideoAspectRatio,
  VideoEditorSelectionContext,
  VideoTranscriptSelectionContext,
} from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';

import { toolCallToAgentAction } from './agentToolMapping';
import type { VideoEditorStep } from './editorTypes';
import { useVideoAgentModel } from './useVideoAgentModel';

export type AgentActionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'cancelled';

export type AgentActionName =
  | 'regenerateScene'
  | 'addScene'
  | 'removeScene'
  | 'setTransition'
  | 'setTimelineBookend'
  | 'clearTimelineBookend'
  | 'setClipAudioSeam'
  | 'applyTimelineOp'
  | 'applyTimelineOps'
  | 'setKeyframes'
  | 'setCaption'
  | 'generateImage'
  | 'generateVideo'
  | 'generateMusic'
  | 'addNarration'
  | 'render'
  | 'cancelRender'
  | 'verifyRender'
  | 'getHandoffConformance'
  | 'exportEditorHandoff'
  | 'searchLinkedAssets'
  | 'attachAsset';

export interface AgentActionRecord {
  id: string;
  type: 'action';
  name: AgentActionName;
  args: Record<string, unknown>;
  summary: string;
  reasoning?: AgentActionReasoning;
  requiresApproval: boolean;
  status: AgentActionStatus;
  error?: string;
  permissionId?: string;
}

export interface AgentActionReasoning {
  rationale?: string;
  considered?: string[];
  sourceClips?: string[];
}

export interface AgentDockContext {
  selectedSceneId?: string;
  aspectRatio?: VideoAspectRatio;
  step?: VideoEditorStep;
  transcriptSelection?: VideoTranscriptSelectionContext;
  editorSelection?: VideoEditorSelectionContext;
  projectAssetIds?: string[];
  pluginId?: string;
  pluginInputs?: Record<string, unknown>;
  approvedPluginCapabilities?: string[];
  lastReviewedPluginDigest?: string | null;
  pluginSignatureOk?: boolean | null;
}

// The plugin gate fields carried from a plugin run onto its approval turn.
type PendingPluginContext = Pick<
  AgentDockContext,
  | 'pluginId'
  | 'pluginInputs'
  | 'approvedPluginCapabilities'
  | 'lastReviewedPluginDigest'
  | 'pluginSignatureOk'
>;

/**
 * Typed turn budget (P2-5). Normalized server-side at the shared agent-runtime
 * boundary and delivered as the `neuma.turn_budget` CUSTOM event, so the dock
 * can tell "the model finished" from "we hit the turn ceiling".
 */
export type TurnStopReason =
  | 'end_turn'
  | 'max_steps'
  | 'max_tool_calls'
  | 'max_tokens'
  | 'budget'
  | 'cancelled'
  | 'refusal'
  | 'error'
  | 'unknown';

export interface TurnBudgetOutcome {
  reason: TurnStopReason;
  raw?: string;
  exhausted: boolean;
  limit?: number;
}

export const TURN_BUDGET_EVENT_NAME = 'neuma.turn_budget';

export type ToolCallStage = 'pending' | 'streaming' | 'complete' | 'error';

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  stage: ToolCallStage;
}

export type AgentDockMessage =
  | {
      id: string;
      role: 'user' | 'assistant' | 'system';
      kind: 'text';
      content: string;
      createdAt: string;
    }
  | {
      id: string;
      role: 'assistant';
      kind: 'action';
      action: AgentActionRecord;
      createdAt: string;
    }
  | {
      id: string;
      role: 'assistant';
      kind: 'tool';
      call: ToolCallRecord;
      createdAt: string;
    };

interface UseAgentDockOptions {
  projectId: string;
}

interface SseFrame {
  event: string;
  data: string;
}

const HISTORY_VERSION = 1;
const HISTORY_LIMIT = 80;

export function useAgentDock({ projectId }: UseAgentDockOptions) {
  const [messages, setMessagesState] = useState<AgentDockMessage[]>(() =>
    readStoredMessages(projectId),
  );
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnBudget, setTurnBudget] = useState<TurnBudgetOutcome | null>(null);
  const streamRef = useRef<{
    id: string;
    controller: AbortController;
    runId?: string;
  } | null>(null);
  const aguiAccumulatorRef = useRef<ChatPanelAguiAccumulator>(
    createChatPanelAguiState().accumulator,
  );
  const messagesRef = useRef<AgentDockMessage[]>(messages);
  const skipNextPersistRef = useRef(false);
  // A plugin flow (e.g. Talking Head Auto-cut) pauses to ask the user to
  // approve the proposed edit. The plugin's specialized tools are only mounted
  // server-side when the turn carries the plugin context, but the approval
  // arrives as a plain follow-up message — so we carry the plugin context onto
  // the next turn, then clear it. See `sendMessage`.
  const pendingPluginContextRef = useRef<PendingPluginContext | null>(null);
  const model = useVideoAgentModel(projectId);
  // Read the live model id at send time to avoid a stale closure capture.
  const modelIdRef = useRef(model.modelId);
  modelIdRef.current = model.modelId;
  // Project id whose server history has finished loading. Gates server writes
  // so we never clobber stored history with the localStorage snapshot before
  // the authoritative server copy has been fetched.
  const serverLoadedProjectRef = useRef<string | null>(null);
  const serverSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitMessages = useCallback((next: AgentDockMessage[]) => {
    messagesRef.current = next;
    setMessagesState(next);
  }, []);

  const updateMessages = useCallback(
    (updater: (prev: AgentDockMessage[]) => AgentDockMessage[]) => {
      commitMessages(updater(messagesRef.current));
    },
    [commitMessages],
  );

  useEffect(() => {
    streamRef.current?.controller.abort();
    streamRef.current = null;
    aguiAccumulatorRef.current = createChatPanelAguiState().accumulator;
    setStreaming(false);
    setError(null);
    skipNextPersistRef.current = true;
    commitMessages(readStoredMessages(projectId));
  }, [commitMessages, projectId]);

  useEffect(() => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    writeStoredMessages(projectId, messages);
  }, [messages, projectId]);

  // Load authoritative history from the server so the conversation follows the
  // user across browsers/devices. localStorage still paints instantly; the
  // server copy wins when present, and a localStorage-only history (pre-server
  // persistence) is migrated up on first load.
  useEffect(() => {
    serverLoadedProjectRef.current = null;
    const controller = new AbortController();
    void (async () => {
      // Only arm server writes after a clean load — never after a failed/aborted
      // fetch, or a 5xx would let the localStorage snapshot clobber the server.
      let loaded = false;
      try {
        const response = await fetch(
          `${API_BASE_URL}/video/projects/${encodeURIComponent(
            projectId,
          )}/agent-history`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const body = (await response.json()) as { messages?: unknown };
        if (controller.signal.aborted) return;
        const serverMessages = Array.isArray(body.messages)
          ? body.messages.filter(isAgentDockMessage).slice(-HISTORY_LIMIT)
          : [];
        if (serverMessages.length > 0) {
          commitMessages(serverMessages);
          writeStoredMessages(projectId, serverMessages);
        } else if (messagesRef.current.length > 0) {
          // Migrate a localStorage-only history up to the server once.
          void saveAgentHistoryToServer(projectId, messagesRef.current);
        }
        loaded = true;
      } catch {
        // Offline / aborted: localStorage already provided a usable history.
      } finally {
        if (loaded && !controller.signal.aborted) {
          serverLoadedProjectRef.current = projectId;
        }
      }
    })();
    return () => controller.abort();
  }, [commitMessages, projectId]);

  // Debounced server write whenever messages change, but only after this
  // project's server history has loaded (so we never overwrite it prematurely).
  useEffect(() => {
    if (serverLoadedProjectRef.current !== projectId) return;
    if (serverSaveTimerRef.current) clearTimeout(serverSaveTimerRef.current);
    serverSaveTimerRef.current = setTimeout(() => {
      // Read the latest committed messages at fire time, not the snapshot
      // captured when the timer was scheduled.
      void saveAgentHistoryToServer(projectId, messagesRef.current);
    }, 800);
    return () => {
      if (serverSaveTimerRef.current) clearTimeout(serverSaveTimerRef.current);
    };
  }, [messages, projectId]);

  useEffect(() => {
    return () => {
      streamRef.current?.controller.abort();
      streamRef.current = null;
    };
  }, []);

  const appendText = useCallback(
    (role: 'assistant' | 'system', content: string) => {
      if (!content.trim()) return;
      updateMessages((prev) =>
        trimHistory([
          ...prev,
          {
            id: randomUUID(),
            role,
            kind: 'text',
            content,
            createdAt: new Date().toISOString(),
          },
        ]),
      );
    },
    [updateMessages],
  );

  const updateAction = useCallback(
    (actionId: string, patch: Partial<AgentActionRecord>) => {
      updateMessages((prev) =>
        prev.map((message) => {
          if (message.kind !== 'action' || message.action.id !== actionId) {
            return message;
          }
          return {
            ...message,
            action: { ...message.action, ...patch },
          };
        }),
      );
    },
    [updateMessages],
  );

  const handleFrame = useCallback(
    (frame: SseFrame) => {
      const payload = parseJsonRecord(frame.data);
      if (!payload) return;

      if (
        getString(payload, 'type') === 'CUSTOM' &&
        getString(payload, 'name') === TURN_BUDGET_EVENT_NAME
      ) {
        const value = getRecord(payload, 'value');
        const outcome = value ? toTurnBudgetOutcome(value) : null;
        if (outcome) setTurnBudget(outcome);
        return;
      }

      if (
        getString(payload, 'type') === 'CUSTOM' &&
        getString(payload, 'name') === 'permission_request'
      ) {
        const value = getRecord(payload, 'value');
        const action = value ? permissionRequestToAction(value) : null;
        if (!action) return;
        updateMessages((prev) =>
          trimHistory([
            ...prev,
            {
              id: action.id,
              role: 'assistant',
              kind: 'action',
              action,
              createdAt: new Date().toISOString(),
            },
          ]),
        );
        return;
      }

      if (frame.event === 'agui' || isChatPanelAguiEventPayload(payload)) {
        if (getString(payload, 'type') === 'RUN_STARTED' && streamRef.current) {
          streamRef.current.runId = getString(payload, 'runId');
        }
        const streamError = aguiErrorMessage(payload);
        if (streamError) setError(streamError);
        const aguiEvent = payload as ChatPanelAguiEvent;
        const next = reduceChatPanelAguiEvent(
          {
            messages: agentDockMessagesToChatPanel(messagesRef.current),
            accumulator: aguiAccumulatorRef.current,
          },
          aguiEvent,
          {
            now: () => new Date().toISOString(),
            createId: (prefix) => `${prefix}:${randomUUID()}`,
          },
        );
        aguiAccumulatorRef.current = next.accumulator;
        commitMessages(
          trimHistory(chatPanelMessagesToAgentDock(next.messages)),
        );
        return;
      }

      if (frame.event === 'permission_request') {
        const action = permissionRequestToAction(payload);
        if (!action) return;
        updateMessages((prev) =>
          trimHistory([
            ...prev,
            {
              id: action.id,
              role: 'assistant',
              kind: 'action',
              action,
              createdAt: new Date().toISOString(),
            },
          ]),
        );
        return;
      }

      if (frame.event === 'message') {
        const content = getString(payload, 'content');
        if (content) appendText('assistant', content);
        return;
      }

      if (frame.event === 'action') {
        const action = normalizeAgentActionPayload(payload);
        if (!action) return;
        updateMessages((prev) =>
          trimHistory([
            ...prev,
            {
              id: action.id,
              role: 'assistant',
              kind: 'action',
              action,
              createdAt: new Date().toISOString(),
            },
          ]),
        );
        return;
      }

      if (frame.event === 'error') {
        const message = getString(payload, 'message') || 'Agent stream failed';
        setError(message);
        appendText('system', message);
      }
    },
    [appendText, commitMessages, updateMessages],
  );

  const sendMessage = useCallback(
    async (content: string, context: AgentDockContext) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      // A new turn invalidates the previous turn's stop reason.
      setTurnBudget(null);

      // Prior turns (before this message) give the agent multi-turn memory — so
      // a URL pasted earlier is still in context after a follow-up confirmation.
      const conversation = conversationFromMessages(messagesRef.current);

      // Keep a plugin flow's tools available across its approval turn. A plugin
      // run pauses for the user to approve the proposed edit; that approval is a
      // plain message with no plugin context, so without this the server would
      // rebuild the turn without the plugin gate and the apply/QA tools would be
      // gone. Carry the context onto the next turn, then clear it so later,
      // unrelated edits aren't restricted to the plugin toolset.
      let effectiveContext = context;
      if (context.pluginId) {
        pendingPluginContextRef.current = {
          pluginId: context.pluginId,
          pluginInputs: context.pluginInputs,
          approvedPluginCapabilities: context.approvedPluginCapabilities,
          lastReviewedPluginDigest: context.lastReviewedPluginDigest,
          pluginSignatureOk: context.pluginSignatureOk,
        };
      } else if (pendingPluginContextRef.current) {
        effectiveContext = { ...context, ...pendingPluginContextRef.current };
        pendingPluginContextRef.current = null;
      }

      streamRef.current?.controller.abort();
      aguiAccumulatorRef.current = createChatPanelAguiState().accumulator;
      const controller = new AbortController();
      const streamId = randomUUID();
      const userMessageId = randomUUID();
      streamRef.current = { id: streamId, controller };
      setStreaming(true);
      setError(null);
      updateMessages((prev) =>
        trimHistory([
          ...prev,
          {
            id: userMessageId,
            role: 'user',
            kind: 'text',
            content: trimmed,
            createdAt: new Date().toISOString(),
          },
        ]),
      );

      try {
        const response = await fetch(
          `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/agent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: trimmed,
              mode: 'chat',
              model: modelIdRef.current,
              runContext: {
                mode: 'video',
                projectId,
                conversationId: null,
                clientRequestId: streamId,
                messageId: userMessageId,
                supplementalSkillIds: [],
              } satisfies RunContextEnvelopeDto,
              ...(conversation.length > 0 ? { messages: conversation } : {}),
              context: effectiveContext,
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        await readAgentStream(response, (frame) => {
          if (controller.signal.aborted || streamRef.current?.id !== streamId) {
            return;
          }
          handleFrame(frame);
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          appendText('system', message);
        }
      } finally {
        if (streamRef.current?.id === streamId) {
          streamRef.current = null;
          setStreaming(false);
        }
        aguiAccumulatorRef.current = createChatPanelAguiState().accumulator;
      }
    },
    [appendText, handleFrame, projectId, updateMessages],
  );

  const cancelStream = useCallback(() => {
    const active = streamRef.current;
    if (!active) return;
    if (active.runId) {
      void fetch(
        `${API_BASE_URL}/ag-ui/cancel/video/${encodeURIComponent(
          projectId,
        )}/${encodeURIComponent(active.runId)}`,
        { method: 'POST' },
      ).catch(() => {});
    }
    active.controller.abort();
    streamRef.current = null;
    const next = finalizeChatPanelAguiState(
      {
        messages: agentDockMessagesToChatPanel(messagesRef.current),
        accumulator: aguiAccumulatorRef.current,
      },
      'aborted',
    );
    commitMessages(trimHistory(chatPanelMessagesToAgentDock(next.messages)));
    aguiAccumulatorRef.current = createChatPanelAguiState().accumulator;
    setStreaming(false);
  }, [commitMessages, projectId]);

  const clearHistory = useCallback(() => {
    cancelStream();
    commitMessages([]);
    setError(null);
  }, [cancelStream, commitMessages]);

  return {
    messages,
    streaming,
    error,
    sendMessage,
    cancelStream,
    clearHistory,
    appendText,
    updateAction,
    model,
    turnBudget,
  };
}

const TURN_STOP_REASONS = new Set<TurnStopReason>([
  'end_turn',
  'max_steps',
  'max_tool_calls',
  'max_tokens',
  'budget',
  'cancelled',
  'refusal',
  'error',
  'unknown',
]);

function toTurnBudgetOutcome(
  value: Record<string, unknown>,
): TurnBudgetOutcome | null {
  const reason = getString(value, 'reason');
  if (!reason || !TURN_STOP_REASONS.has(reason as TurnStopReason)) return null;
  const limit = value.limit;
  const raw = getString(value, 'raw');
  return {
    reason: reason as TurnStopReason,
    exhausted: value.exhausted === true,
    ...(raw ? { raw } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
  };
}

async function readAgentStream(
  response: Response,
  onFrame: (frame: SseFrame) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const frame = parseSseFrame(chunk);
        if (frame) onFrame(frame);
      }
    }
  } finally {
    // Release the reader lock so subsequent fetches on this body don't hang
    // when the caller aborts mid-stream (AbortError exits the for-loop without
    // releasing).
    reader.cancel().catch(() => {});
  }
}

function parseSseFrame(chunk: string): SseFrame | null {
  const lines = chunk.split('\n');
  let event = 'message';
  const data: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    }
  }

  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

function aguiErrorMessage(payload: Record<string, unknown>): string | null {
  const type = getString(payload, 'type');
  if (type !== 'RUN_ERROR' && type !== 'ERROR') return null;
  return (
    getString(payload, 'message') ??
    getString(payload, 'content') ??
    'Agent stream failed'
  );
}

function agentDockMessagesToChatPanel(
  messages: AgentDockMessage[],
): ChatPanelMessage[] {
  return messages.flatMap((message): ChatPanelMessage[] => {
    if (message.kind === 'text') {
      return [
        {
          id: message.id,
          kind: 'text',
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        },
      ];
    }
    if (message.kind === 'action') {
      return [
        {
          id: message.id,
          kind: 'action',
          role: 'assistant',
          action: {
            id: message.action.id,
            name: message.action.name,
            summary: message.action.summary,
            args: message.action.args,
            status: message.action.status,
            requiresApproval: message.action.requiresApproval,
            payload: message.action,
          },
          createdAt: message.createdAt,
        },
      ];
    }
    return [
      {
        id: message.id,
        kind: 'tool',
        role: 'assistant',
        calls: [
          {
            id: message.call.id,
            name: message.call.name,
            stage: agentToolStageToChatStage(message.call.stage),
            argsText: JSON.stringify(message.call.args),
            args: message.call.args,
            result: message.call.result,
            isError: message.call.stage === 'error',
          },
        ],
        createdAt: message.createdAt,
      },
    ];
  });
}

function chatPanelMessagesToAgentDock(
  messages: ChatPanelMessage[],
): AgentDockMessage[] {
  return messages.flatMap((message): AgentDockMessage[] => {
    if (message.kind === 'text') {
      return [
        {
          id: message.id,
          kind: 'text',
          role: message.role === 'reasoning' ? 'assistant' : message.role,
          content: message.content,
          createdAt: message.createdAt,
        },
      ];
    }
    if (message.kind === 'action') {
      const actionPayload = isRecord(message.action.payload)
        ? message.action.payload
        : {
            id: message.action.id,
            name: message.action.name,
            summary: message.action.summary,
            args: message.action.args,
            status: message.action.status,
            requiresApproval: message.action.requiresApproval,
          };
      const action = normalizeAgentActionPayload(actionPayload);
      return action
        ? [
            {
              id: message.id,
              kind: 'action',
              role: 'assistant',
              action,
              createdAt: message.createdAt,
            },
          ]
        : [];
    }
    if (message.kind !== 'tool') return [];
    return message.calls.map((call) =>
      chatToolCallToAgentDockMessage(call, message.createdAt),
    );
  });
}

function chatToolCallToAgentDockMessage(
  call: ChatToolCall,
  createdAt: string,
): AgentDockMessage {
  const parsedResult = parseJsonValue(call.result ?? '');
  const action =
    call.stage === 'complete' || call.stage === 'error'
      ? toolCallToAgentAction(call.name, call.args, parsedResult, {
          id: `tool:${call.id}`,
          status: call.isError || call.stage === 'error' ? 'failed' : undefined,
        })
      : null;
  if (action) {
    return {
      id: action.id,
      kind: 'action',
      role: 'assistant',
      action,
      createdAt,
    };
  }
  return {
    id: `tool:${call.id}`,
    kind: 'tool',
    role: 'assistant',
    call: {
      id: call.id,
      name: call.name,
      args: call.args,
      result: call.result,
      stage: chatToolStageToAgentStage(call.stage),
    },
    createdAt,
  };
}

function agentToolStageToChatStage(stage: ToolCallStage): ChatToolCallStage {
  return stage;
}

function chatToolStageToAgentStage(stage: ChatToolCallStage): ToolCallStage {
  if (stage === 'complete' || stage === 'error' || stage === 'pending') {
    return stage;
  }
  return stage === 'cancelled' ? 'error' : 'streaming';
}

function permissionRequestToAction(
  payload: Record<string, unknown>,
): AgentActionRecord | null {
  const permission = getRecord(payload, 'permission');
  if (!permission) return null;
  const permissionId = getString(permission, 'id');
  const toolName = getString(permission, 'tool');
  if (!permissionId || !toolName) return null;
  const args = parseJsonValue(getString(permission, 'command') ?? '');
  const action = toolCallToAgentAction(
    toolName,
    args,
    { message: getString(permission, 'description') },
    { id: `permission:${permissionId}`, status: 'pending' },
  );
  return action ? { ...action, permissionId, requiresApproval: true } : null;
}

export function normalizeAgentActionPayload(
  payload: Record<string, unknown>,
): AgentActionRecord | null {
  const name = getString(payload, 'name') ?? getString(payload, 'type');
  if (!isAgentActionName(name)) return null;

  return {
    id: getString(payload, 'id') ?? randomUUID(),
    type: 'action',
    name,
    args: getRecord(payload, 'args') ?? {},
    summary: getString(payload, 'summary') ?? actionSummary(name),
    reasoning: normalizeReasoning(getRecord(payload, 'reasoning')),
    requiresApproval: getBoolean(payload, 'requiresApproval') ?? true,
    status: normalizeStatus(getString(payload, 'status')),
    error: getString(payload, 'error'),
    permissionId: getString(payload, 'permissionId'),
  };
}

function normalizeReasoning(
  value: Record<string, unknown> | undefined,
): AgentActionReasoning | undefined {
  if (!value) return undefined;
  const rationale = getString(value, 'rationale');
  const considered = getStringArray(value, 'considered');
  const sourceClips = getStringArray(value, 'sourceClips');
  if (!rationale && !considered?.length && !sourceClips?.length) {
    return undefined;
  }
  return { rationale, considered, sourceClips };
}

function normalizeStatus(status: string | undefined): AgentActionStatus {
  if (
    status === 'pending' ||
    status === 'running' ||
    status === 'completed' ||
    status === 'rejected' ||
    status === 'failed' ||
    status === 'cancelled'
  ) {
    return status;
  }
  return 'pending';
}

function isAgentActionName(
  value: string | undefined,
): value is AgentActionName {
  return (
    value === 'regenerateScene' ||
    value === 'addScene' ||
    value === 'removeScene' ||
    value === 'setTransition' ||
    value === 'setTimelineBookend' ||
    value === 'clearTimelineBookend' ||
    value === 'setClipAudioSeam' ||
    value === 'applyTimelineOp' ||
    value === 'applyTimelineOps' ||
    value === 'setKeyframes' ||
    value === 'setCaption' ||
    value === 'generateImage' ||
    value === 'generateVideo' ||
    value === 'generateMusic' ||
    value === 'addNarration' ||
    value === 'render' ||
    value === 'cancelRender' ||
    value === 'verifyRender' ||
    value === 'getHandoffConformance' ||
    value === 'exportEditorHandoff' ||
    value === 'searchLinkedAssets' ||
    value === 'attachAsset'
  );
}

function actionSummary(name: AgentActionName): string {
  return name.replace(/([A-Z])/g, ' $1').trim();
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonValue(value: string): unknown {
  if (!value) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { message: value };
  }
}

function readStoredMessages(projectId: string): AgentDockMessage[] {
  if (typeof window === 'undefined') return [];
  const storage = window.localStorage;
  if (!storage) return [];
  const raw = storage.getItem(storageKey(projectId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as {
      version?: number;
      messages?: unknown;
    };
    if (parsed.version !== HISTORY_VERSION || !Array.isArray(parsed.messages)) {
      return [];
    }
    return parsed.messages.filter(isAgentDockMessage).slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeStoredMessages(projectId: string, messages: AgentDockMessage[]) {
  if (typeof window === 'undefined') return;
  const storage = window.localStorage;
  if (!storage) return;
  storage.setItem(
    storageKey(projectId),
    JSON.stringify({ version: HISTORY_VERSION, messages }),
  );
}

function storageKey(projectId: string): string {
  return `video.agentDock.history.${projectId}`;
}

async function saveAgentHistoryToServer(
  projectId: string,
  messages: AgentDockMessage[],
): Promise<void> {
  try {
    await fetch(
      `${API_BASE_URL}/video/projects/${encodeURIComponent(
        projectId,
      )}/agent-history`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages.slice(-HISTORY_LIMIT) }),
      },
    );
  } catch {
    // Best-effort: localStorage remains the offline cache.
  }
}

function trimHistory(messages: AgentDockMessage[]): AgentDockMessage[] {
  return messages.slice(-HISTORY_LIMIT);
}

/** Convert dock messages into plain conversation turns for the agent run. */
function conversationFromMessages(
  messages: AgentDockMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const message of messages) {
    if (message.kind !== 'text') continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = message.content.trim();
    if (content) out.push({ role: message.role, content });
  }
  return out.slice(-30);
}

function isAgentDockMessage(value: unknown): value is AgentDockMessage {
  if (!isRecord(value)) return false;
  const kind = getString(value, 'kind');
  const id = getString(value, 'id');
  const role = getString(value, 'role');
  const createdAt = getString(value, 'createdAt');
  if (!kind || !id || !role || !createdAt) return false;
  if (kind === 'text') return typeof value.content === 'string';
  if (kind !== 'action' || !isRecord(value.action)) return false;
  return normalizeAgentActionPayload(value.action) !== null;
}

function getString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const item = value[key];
  return typeof item === 'string' ? item : undefined;
}

function getBoolean(
  value: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const item = value[key];
  return typeof item === 'boolean' ? item : undefined;
}

function getRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function getStringArray(
  value: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const item = value[key];
  if (!Array.isArray(item)) return undefined;
  const strings = item.filter(
    (entry): entry is string =>
      typeof entry === 'string' && entry.trim() !== '',
  );
  return strings.length ? strings : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
