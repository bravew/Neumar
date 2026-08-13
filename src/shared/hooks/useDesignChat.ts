import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';
import type { AgentQuestion } from '@/shared/hooks/agent-types';
import { normalizeAgentQuestions } from '@/shared/questions/question-policy';
import type { RunContextEnvelopeDto } from '@/shared/types/run-context';
import { randomUUID } from '@/shared/utils/uuid';

/** Max conversation-history turns sent per request — mirrors the server's
 *  `designChatSchema.messages.max(40)` so a long session never gets a 400. */
const HISTORY_LIMIT = 40;

/**
 * DesignMode conversational chat loop client (Fix-sync Phase 02).
 *
 * POSTs a composer message to `/design/projects/:id/chat`, reads the SSE
 * `AgentMessage` stream, and accumulates it into a turn-based transcript the
 * project view renders. Mirrors Open Design's Studio chat: user bubble →
 * streaming assistant text + tool calls → done. The agent writes artifacts into
 * the project workspace, which the FileWorkspace surfaces independently.
 */

export interface DesignChatToolCall {
  id: string;
  name: string;
  /** Short context from the tool input — file path or command — so a row reads
   *  "Edit index.html" rather than a bare "Edit". */
  detail?: string;
  /** `missing` = a benign "file does not exist" read, shown neutrally. */
  status: 'running' | 'done' | 'error' | 'missing';
}

/** True when a tool error is just "the file isn't there" (benign, not a fault). */
function isMissingFileResult(text: unknown): boolean {
  return (
    typeof text === 'string' &&
    /does not exist|no such file|not found|enoent/i.test(text)
  );
}

/** Pull a compact, human label from a tool_use input (file path or command). */
function toolDetail(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  const path = obj.file_path ?? obj.path ?? obj.notebook_path;
  if (typeof path === 'string' && path) {
    return path.split('/').pop() || path;
  }
  if (typeof obj.command === 'string' && obj.command) {
    const cmd = obj.command.trim().replace(/\s+/g, ' ');
    return cmd.length > 48 ? `${cmd.slice(0, 48)}…` : cmd;
  }
  if (typeof obj.pattern === 'string' && obj.pattern) return obj.pattern;
  if (typeof obj.url === 'string' && obj.url) return obj.url;
  return undefined;
}

export interface DesignChatUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  durationMs?: number;
}

export interface DesignChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  tools: DesignChatToolCall[];
  questions: AgentQuestion[];
  questionsStreaming: boolean;
  status: 'streaming' | 'done' | 'error';
  error?: string;
  usage?: DesignChatUsage;
}

interface AgentMessageLike {
  type: string;
  content?: string;
  id?: string;
  name?: string;
  input?: unknown;
  output?: string;
  toolUseId?: string;
  isError?: boolean;
  cost?: number;
  duration?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface AguiEventLike {
  type?: string;
  runId?: string;
  messageId?: string;
  toolCallId?: string;
  toolCallName?: string;
  delta?: string;
  content?: string;
  message?: string;
  name?: string;
  value?: unknown;
  snapshot?: {
    usage?: { inputTokens?: number; outputTokens?: number; cost?: number };
  };
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

export function useDesignChat(
  projectId: string,
  opts?: {
    /**
     * Called when the run registers an artifact and the server pushes the
     * updated project (new output in the Creations grid). Lets the view refresh
     * + auto-open without a reload.
     */
    onProject?: (project: unknown) => void;
  },
) {
  const onProjectRef = useRef(opts?.onProject);
  onProjectRef.current = opts?.onProject;
  const [turns, setTurns] = useState<DesignChatTurn[]>([]);
  const [sending, setSending] = useState(false);
  const runIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toolNamesRef = useRef(new Map<string, string>());
  const toolArgsRef = useRef(new Map<string, string>());
  // Mirror turns in a ref so `send` can read the current transcript (to forward
  // as conversation history) without re-creating the callback each turn.
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  // Abort any in-flight stream when the project view unmounts so the fetch
  // reader stops and we don't update state after teardown.
  useEffect(() => () => abortRef.current?.abort(), []);

  const patchAssistant = useCallback(
    (assistantId: string, fn: (turn: DesignChatTurn) => DesignChatTurn) => {
      setTurns((prev) =>
        prev.map((turn) => (turn.id === assistantId ? fn(turn) : turn)),
      );
    },
    [],
  );

  const applyAgentMessage = useCallback(
    (assistantId: string, msg: AgentMessageLike) => {
      switch (msg.type) {
        case 'text':
          if (msg.content)
            patchAssistant(assistantId, (t) => ({
              ...t,
              text: t.text + msg.content,
            }));
          break;
        case 'thinking':
          if (msg.content)
            patchAssistant(assistantId, (t) => ({
              ...t,
              thinking: (t.thinking ?? '') + msg.content,
            }));
          break;
        case 'tool_use':
          if (msg.name === 'AskUserQuestion' && msg.input !== undefined) {
            patchAssistant(assistantId, (turn) => ({
              ...turn,
              questions: normalizeAgentQuestions(msg.input),
              questionsStreaming: false,
            }));
          }
          patchAssistant(assistantId, (t) => ({
            ...t,
            tools: [
              ...t.tools,
              {
                id: msg.id ?? randomUUID(),
                name: msg.name ?? 'tool',
                detail: toolDetail(msg.input),
                status: 'running',
              },
            ],
          }));
          break;
        case 'tool_result': {
          // A "file does not exist" Read is benign agent exploration (common on
          // a fresh project), not a failure — render it neutrally, not as a
          // red error that looks like the run broke.
          const status = !msg.isError
            ? 'done'
            : isMissingFileResult(msg.output ?? msg.content)
              ? 'missing'
              : 'error';
          patchAssistant(assistantId, (t) => ({
            ...t,
            tools: t.tools.map((tool) =>
              tool.id === msg.toolUseId ? { ...tool, status } : tool,
            ),
          }));
          break;
        }
        case 'result':
          patchAssistant(assistantId, (t) => ({
            ...t,
            usage: {
              inputTokens: msg.usage?.input_tokens ?? 0,
              outputTokens: msg.usage?.output_tokens ?? 0,
              costUsd: msg.cost,
              durationMs: msg.duration,
            },
          }));
          break;
        case 'error':
          patchAssistant(assistantId, (t) => ({
            ...t,
            status: 'error',
            error: msg.content ?? t.error,
          }));
          break;
        default:
          break;
      }
    },
    [patchAssistant],
  );

  const applyAguiEvent = useCallback(
    (assistantId: string, event: AguiEventLike) => {
      switch (event.type) {
        case 'RUN_STARTED':
          runIdRef.current = event.runId ?? null;
          break;
        case 'TEXT_MESSAGE_CONTENT':
          applyAgentMessage(assistantId, {
            type: 'text',
            content: event.delta,
          });
          break;
        case 'REASONING_MESSAGE_CONTENT':
          applyAgentMessage(assistantId, {
            type: 'thinking',
            content: event.delta,
          });
          break;
        case 'TOOL_CALL_START':
          if (event.toolCallId) {
            toolNamesRef.current.set(
              event.toolCallId,
              event.toolCallName ?? 'tool',
            );
            toolArgsRef.current.set(event.toolCallId, '');
            if (event.toolCallName === 'AskUserQuestion') {
              patchAssistant(assistantId, (turn) => ({
                ...turn,
                questions: [],
                questionsStreaming: true,
              }));
            }
            applyAgentMessage(assistantId, {
              type: 'tool_use',
              id: event.toolCallId,
              name: event.toolCallName,
            });
          }
          break;
        case 'TOOL_CALL_ARGS':
          if (event.toolCallId) {
            const next =
              (toolArgsRef.current.get(event.toolCallId) ?? '') +
              (event.delta ?? '');
            toolArgsRef.current.set(event.toolCallId, next);
          }
          break;
        case 'TOOL_CALL_END':
          if (event.toolCallId) {
            if (
              toolNamesRef.current.get(event.toolCallId) === 'AskUserQuestion'
            ) {
              let input: unknown;
              try {
                input = JSON.parse(
                  toolArgsRef.current.get(event.toolCallId) ?? '',
                );
              } catch {
                input = null;
              }
              patchAssistant(assistantId, (turn) => ({
                ...turn,
                questions: normalizeAgentQuestions(input),
                questionsStreaming: false,
              }));
            }
            toolNamesRef.current.delete(event.toolCallId);
            toolArgsRef.current.delete(event.toolCallId);
          }
          break;
        case 'TOOL_CALL_RESULT':
          applyAgentMessage(assistantId, {
            type: 'tool_result',
            toolUseId: event.toolCallId,
            output: event.content,
          });
          break;
        case 'STATE_SNAPSHOT':
          if (event.snapshot?.usage) {
            applyAgentMessage(assistantId, {
              type: 'result',
              usage: {
                input_tokens: event.snapshot.usage.inputTokens,
                output_tokens: event.snapshot.usage.outputTokens,
              },
              cost: event.snapshot.usage.cost,
            });
          }
          break;
        case 'RUN_ERROR':
          patchAssistant(assistantId, (turn) => ({
            ...turn,
            status: 'error',
            error: event.message ?? 'Chat failed',
          }));
          break;
        case 'CUSTOM':
          if (event.name === 'design.project') {
            onProjectRef.current?.(event.value);
          }
          break;
        case 'RUN_FINISHED':
          patchAssistant(assistantId, (turn) =>
            turn.status === 'error' ? turn : { ...turn, status: 'done' },
          );
          break;
      }
    },
    [applyAgentMessage, patchAssistant],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    const runId = runIdRef.current;
    if (runId) {
      void fetch(
        `${API_BASE_URL}/ag-ui/cancel/design/${encodeURIComponent(
          projectId,
        )}/${encodeURIComponent(runId)}`,
        { method: 'POST' },
      ).catch(() => {});
    }
  }, [projectId]);

  const send = useCallback(
    async (prompt: string, opts?: { provider?: string; model?: string }) => {
      const trimmed = prompt.trim();
      if (!trimmed || sending) return;
      // Forward the prior transcript as conversation history so the agent (whose
      // runs are otherwise stateless) keeps the brief + its discovery questions
      // + answers in context across turns.
      const history = turnsRef.current
        .filter((turn) => turn.text.trim())
        .slice(-HISTORY_LIMIT)
        .map((turn) => ({ role: turn.role, content: turn.text }));
      const assistantId = randomUUID();
      const userMessageId = randomUUID();
      setTurns((prev) => [
        ...prev,
        {
          id: userMessageId,
          role: 'user',
          text: trimmed,
          tools: [],
          questions: [],
          questionsStreaming: false,
          status: 'done',
        },
        {
          id: assistantId,
          role: 'assistant',
          text: '',
          tools: [],
          questions: [],
          questionsStreaming: false,
          status: 'streaming',
        },
      ]);
      setSending(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch(
          `${API_BASE_URL}/design/projects/${encodeURIComponent(projectId)}/chat`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: trimmed,
              messages: history,
              runContext: {
                mode: 'design',
                projectId,
                conversationId: null,
                clientRequestId: randomUUID(),
                messageId: userMessageId,
                supplementalSkillIds: [],
              } satisfies RunContextEnvelopeDto,
              ...opts,
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok || !response.body) {
          throw new Error(`Chat request failed (HTTP ${response.status})`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const parsed = parseSseBlock(block);
            if (!parsed) continue;
            if (parsed.event === 'run') {
              try {
                runIdRef.current =
                  (JSON.parse(parsed.data) as { runId?: string }).runId ?? null;
              } catch {
                /* ignore */
              }
            } else if (parsed.event === 'agent') {
              try {
                applyAgentMessage(
                  assistantId,
                  JSON.parse(parsed.data) as AgentMessageLike,
                );
              } catch {
                /* ignore malformed frame */
              }
            } else if (parsed.event === 'message') {
              try {
                applyAguiEvent(
                  assistantId,
                  JSON.parse(parsed.data) as AguiEventLike,
                );
              } catch {
                /* ignore malformed AG-UI frame */
              }
            } else if (parsed.event === 'error') {
              let message = 'Chat failed';
              try {
                message =
                  (JSON.parse(parsed.data) as { message?: string }).message ??
                  message;
              } catch {
                /* ignore */
              }
              patchAssistant(assistantId, (t) => ({
                ...t,
                status: 'error',
                error: message,
              }));
            } else if (parsed.event === 'project') {
              try {
                onProjectRef.current?.(JSON.parse(parsed.data));
              } catch {
                /* ignore malformed project frame */
              }
            } else if (parsed.event === 'done') {
              patchAssistant(assistantId, (t) =>
                t.status === 'error' ? t : { ...t, status: 'done' },
              );
            }
          }
        }
        patchAssistant(assistantId, (t) =>
          t.status === 'streaming' ? { ...t, status: 'done' } : t,
        );
      } catch (err) {
        if (controller.signal.aborted) {
          patchAssistant(assistantId, (t) => ({ ...t, status: 'done' }));
        } else {
          patchAssistant(assistantId, (t) => ({
            ...t,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      } finally {
        setSending(false);
        runIdRef.current = null;
        abortRef.current = null;
        toolNamesRef.current.clear();
        toolArgsRef.current.clear();
      }
    },
    [applyAgentMessage, applyAguiEvent, patchAssistant, projectId, sending],
  );

  return { turns, sending, send, cancel };
}
