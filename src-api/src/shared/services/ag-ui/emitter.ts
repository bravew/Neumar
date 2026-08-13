import {
  EventType,
  type BaseEvent,
  type CustomEvent,
  type RawEvent,
  type ReasoningMessageContentEvent,
  type ReasoningMessageEndEvent,
  type ReasoningMessageStartEvent,
  type RunErrorEvent,
  type RunFinishedEvent,
  type RunStartedEvent,
  type StateSnapshotEvent,
  type StepFinishedEvent,
  type StepStartedEvent,
  type TextMessageContentEvent,
  type TextMessageEndEvent,
  type TextMessageStartEvent,
  type ToolCallArgsEvent,
  type ToolCallEndEvent,
  type ToolCallResultEvent,
  type ToolCallStartEvent,
} from '@ag-ui/core';

import type { AgentMessage } from '@/core/agent/types';

import { CustomEventName } from './event-schema';
import { isAguiV2Enabled } from './feature-flags';

/**
 * Optional context emitted as STATE_SNAPSHOT at run start.
 * Lets the frontend display workspace and task info from the first event.
 */
export interface AGUIRunContext {
  /** Absolute path to the user-configured workspace root */
  workspaceRoot?: string;
  /** Human-readable task title */
  taskTitle?: string;
}

/**
 * Transforms an AsyncGenerator<AgentMessage> into an AG-UI event stream.
 *
 * Best practices:
 * - Monotonic `seq` counter on every event (OpenClaw pattern) for ordering guarantees
 * - `timestamp` on every event for per-step elapsed time calculation
 * - try/catch/finally with `caughtError` flag — never silently swallows errors
 * - Orphan cleanup on error — all active tool calls force-closed before RUN_ERROR
 * - Each thinking block gets its own scoped `reasoningId`
 */
export class AGUIEmitter {
  private seq = 0;
  private currentMessageId: string | null = null;
  private activeToolCalls = new Map<string, string>(); // toolCallId → toolName
  /** Tracks active step names — guards against STEP_FINISHED without STEP_STARTED */
  private activeSteps = new Set<string>();
  /** Set when an inline `error`-type message emits RUN_ERROR, preventing RUN_FINISHED */
  private terminated = false;

  constructor(
    private readonly threadId: string,
    private readonly runId: string,
    private readonly context?: AGUIRunContext,
  ) {}

  async *transform(
    source: AsyncGenerator<AgentMessage>,
    onMessage?: (message: AgentMessage) => void | Promise<void>,
  ): AsyncGenerator<BaseEvent> {
    let caughtError: unknown = undefined;

    yield this.event<RunStartedEvent>(EventType.RUN_STARTED, {
      threadId: this.threadId,
      runId: this.runId,
    });

    // Emit initial state snapshot so the frontend can display workspace/task context
    if (this.context?.workspaceRoot) {
      const workspaceName =
        this.context.workspaceRoot.split('/').pop() ??
        this.context.workspaceRoot;
      yield this.event<StateSnapshotEvent>(EventType.STATE_SNAPSHOT, {
        snapshot: {
          workspace: { path: this.context.workspaceRoot, name: workspaceName },
          task: {
            id: this.threadId,
            title: this.context.taskTitle ?? this.threadId,
            phase: 'executing',
          },
          usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
        },
      });
    }

    try {
      for await (const msg of source) {
        await onMessage?.(msg);
        yield* this.mapMessage(msg);
        // Stop processing further messages after an inline RUN_ERROR
        if (this.terminated) break;
      }
    } catch (err) {
      caughtError = err;
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.includes('abort'));
      yield* this.closeOpenBlocks();
      yield this.event<RunErrorEvent>(EventType.RUN_ERROR, {
        message: isAbort
          ? 'Run stopped by user'
          : err instanceof Error
            ? err.message
            : String(err),
        code: isAbort ? 'USER_CANCELLED' : undefined,
      });
    } finally {
      // Only emit RUN_FINISHED if neither an exception nor an inline error terminated the run
      if (caughtError === undefined && !this.terminated) {
        yield* this.closeOpenBlocks();
        yield this.event<RunFinishedEvent>(EventType.RUN_FINISHED, {});
      }
    }
  }

  private *closeOpenBlocks(): Generator<BaseEvent> {
    if (this.currentMessageId) {
      yield this.event<TextMessageEndEvent>(EventType.TEXT_MESSAGE_END, {
        messageId: this.currentMessageId,
      });
      this.currentMessageId = null;
    }
    for (const [toolCallId] of this.activeToolCalls) {
      yield this.event<ToolCallEndEvent>(EventType.TOOL_CALL_END, {
        toolCallId,
      });
    }
    this.activeToolCalls.clear();
    // Close any still-active STEPs before RUN_FINISHED. The AG-UI verifier
    // (@ag-ui/client verify.ts) rejects RUN_FINISHED while steps are open —
    // happens when a sub-agent started but never emitted task_notification
    // (early abort, crash, SDK dropped the notification). Without this
    // flush the whole run errors with "Cannot send 'RUN_FINISHED' while
    // steps are still active".
    for (const stepName of this.activeSteps) {
      yield this.event<StepFinishedEvent>(EventType.STEP_FINISHED, {
        stepName,
      });
    }
    this.activeSteps.clear();
  }

  private *mapMessage(msg: AgentMessage): Generator<BaseEvent> {
    switch (msg.type) {
      case 'text': {
        // Skip empty deltas — @ag-ui/client rejects delta === ''
        if (!msg.content) break;
        if (!this.currentMessageId) {
          this.currentMessageId = msg.id ?? crypto.randomUUID();
          yield this.event<TextMessageStartEvent>(
            EventType.TEXT_MESSAGE_START,
            {
              messageId: this.currentMessageId,
              role: 'assistant',
            },
          );
        }
        yield this.event<TextMessageContentEvent>(
          EventType.TEXT_MESSAGE_CONTENT,
          {
            messageId: this.currentMessageId,
            delta: msg.content,
          },
        );
        break;
      }

      case 'planning_status': {
        // Planning progress heartbeat — emit as CUSTOM event so the frontend
        // can display status text and elapsed time during long planning phases.
        yield this.event<CustomEvent>(EventType.CUSTOM, {
          name: 'planning_status',
          value: {
            content: msg.content ?? 'Planning...',
            elapsedMs: msg.elapsedMs ?? 0,
            thinkingText: msg.thinkingText,
          },
        });
        break;
      }

      case 'permission_request': {
        yield this.event<CustomEvent>(EventType.CUSTOM, {
          name: 'permission_request',
          value: { permission: msg.permission },
        });
        break;
      }

      case 'thinking': {
        // Skip empty thinking blocks
        if (!msg.content) break;
        const reasoningId = crypto.randomUUID();
        yield this.event<ReasoningMessageStartEvent>(
          EventType.REASONING_MESSAGE_START,
          {
            messageId: reasoningId,
            role: 'reasoning',
          },
        );
        yield this.event<ReasoningMessageContentEvent>(
          EventType.REASONING_MESSAGE_CONTENT,
          {
            messageId: reasoningId,
            delta: msg.content,
          },
        );
        yield this.event<ReasoningMessageEndEvent>(
          EventType.REASONING_MESSAGE_END,
          {
            messageId: reasoningId,
          },
        );
        break;
      }

      case 'tool_use': {
        // Close any open text message before starting a tool call
        if (this.currentMessageId) {
          yield this.event<TextMessageEndEvent>(EventType.TEXT_MESSAGE_END, {
            messageId: this.currentMessageId,
          });
          this.currentMessageId = null;
        }
        const toolCallId = msg.id ?? crypto.randomUUID();
        this.activeToolCalls.set(toolCallId, msg.name ?? 'unknown');
        yield this.event<ToolCallStartEvent>(EventType.TOOL_CALL_START, {
          toolCallId,
          toolCallName: msg.name ?? 'unknown',
          parentMessageId: undefined,
        });
        // Args as single chunk (progressive streaming deferred to Phase 5)
        if (msg.input != null) {
          yield this.event<ToolCallArgsEvent>(EventType.TOOL_CALL_ARGS, {
            toolCallId,
            delta: JSON.stringify(msg.input),
          });
        }
        yield this.event<ToolCallEndEvent>(EventType.TOOL_CALL_END, {
          toolCallId,
        });
        this.activeToolCalls.delete(toolCallId);
        break;
      }

      case 'tool_use_args_delta': {
        // Skip empty deltas
        if (!msg.content) break;
        const toolCallId = msg.id ?? '';
        yield this.event<ToolCallArgsEvent>(EventType.TOOL_CALL_ARGS, {
          toolCallId,
          delta: msg.content,
        });
        break;
      }

      case 'tool_result': {
        const toolCallId = msg.toolUseId ?? '';
        this.activeToolCalls.delete(toolCallId);
        const content =
          typeof msg.output === 'string'
            ? msg.output
            : JSON.stringify(msg.output ?? '');
        // Phase 7: emit a security verdict CUSTOM event BEFORE the tool result
        // so the frontend can render a chip and the persistence layer has
        // verdict context for redaction decisions. The verdict carries no
        // raw payload — only the hash and a clamped redactedSnippet.
        if (msg.security) {
          yield this.event<CustomEvent>(EventType.CUSTOM, {
            name: 'security_verdict',
            value: {
              toolCallId,
              verdict: msg.security.verdict,
              source: msg.security.source,
              payloadHash: msg.security.payloadHash,
              redactedSnippet: msg.security.redactedSnippet,
              scores: msg.security.scores,
            },
          });
        }
        yield this.event<ToolCallResultEvent & { isError?: boolean }>(
          EventType.TOOL_CALL_RESULT,
          {
            messageId: crypto.randomUUID(),
            toolCallId,
            content,
            role: 'tool',
            ...(msg.isError === undefined ? {} : { isError: msg.isError }),
          },
        );
        break;
      }

      case 'step_started': {
        const stepName = msg.stepName ?? 'step';
        // AG-UI rejects STEP_STARTED if stepName is already active.
        if (this.activeSteps.has(stepName)) break;
        this.activeSteps.add(stepName);
        yield this.event<StepStartedEvent>(EventType.STEP_STARTED, {
          stepName,
        });
        break;
      }

      case 'step_finished': {
        const stepName = msg.stepName ?? 'step';
        // Guard: skip STEP_FINISHED for steps that were never started
        // (e.g., sub-agent lifecycle events where STEP_STARTED was lost)
        if (!this.activeSteps.has(stepName)) {
          break;
        }
        this.activeSteps.delete(stepName);
        yield this.event<StepFinishedEvent>(EventType.STEP_FINISHED, {
          stepName,
        });
        break;
      }

      case 'plan': {
        if (this.currentMessageId) {
          yield this.event<TextMessageEndEvent>(EventType.TEXT_MESSAGE_END, {
            messageId: this.currentMessageId,
          });
          this.currentMessageId = null;
        }
        // Emit BOTH events: 'plan' for backward compat (V1 NeumaAGUIEventDispatcher)
        // and 'on_interrupt' for CopilotKit's useInterrupt hook
        yield this.event<CustomEvent>(EventType.CUSTOM, {
          name: 'plan',
          value: msg.plan
            ? { ...msg.plan, _runId: this.runId }
            : { _runId: this.runId },
        });
        yield this.event<CustomEvent>(EventType.CUSTOM, {
          name: 'on_interrupt',
          value: {
            type: 'plan_approval',
            plan: msg.plan ?? {},
            runId: this.runId,
          },
        });
        // Dual-emit window: when feature.aguiV2 is enabled, ALSO emit the
        // canonical neuma.interrupt CUSTOM event so v2 frontends can
        // discriminate by stable name. Legacy emitters above stay until
        // the flag flips default and we cut a removal release.
        if (isAguiV2Enabled()) {
          // Plan-approval interrupts emitted from the SDK stream don't yet
          // have a server-side approval row; use sentinels for required
          // fields so InterruptPayloadSchema (.min(1)) parses successfully.
          // Orchestration-layer emitters that go through ApprovalManager
          // override these via the approval lifecycle.
          const approvalId = `plan-${this.runId}`;
          const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          yield this.event<CustomEvent>(EventType.CUSTOM, {
            name: CustomEventName.Interrupt,
            value: {
              runId: this.runId,
              parentRunId: null,
              taskId: this.threadId,
              approvalId,
              kind: 'plan' as const,
              risk: 'medium' as const,
              title: 'Plan approval',
              payload: msg.plan ?? {},
              resumeToken: `unsigned:${this.runId}`,
              expiresAt,
            },
          });
        }
        break;
      }

      case 'direct_answer': {
        yield this.event<CustomEvent>(EventType.CUSTOM, {
          name: 'direct_answer',
          value: msg.content,
        });
        break;
      }

      case 'result': {
        if (this.currentMessageId) {
          yield this.event<TextMessageEndEvent>(EventType.TEXT_MESSAGE_END, {
            messageId: this.currentMessageId,
          });
          this.currentMessageId = null;
        }
        if (msg.subtype === 'interrupt') {
          yield this.event<CustomEvent>(EventType.CUSTOM, {
            name: 'interrupt',
            value: msg,
          });
        }
        // Emit usage snapshot when the result carries token counts.
        // STATE_SNAPSHOT is fully handled by react-ag-ui; STATE_DELTA was silently dropped in v0.0.21.
        if (msg.usage || msg.cost != null) {
          const workspaceName =
            this.context?.workspaceRoot?.split('/').pop() ?? '';
          yield this.event<StateSnapshotEvent>(EventType.STATE_SNAPSHOT, {
            snapshot: {
              workspace: {
                path: this.context?.workspaceRoot ?? '',
                name: workspaceName,
              },
              task: {
                id: this.threadId,
                title: this.context?.taskTitle ?? this.threadId,
                phase: 'executing',
              },
              usage: {
                inputTokens: msg.usage?.input_tokens ?? 0,
                outputTokens: msg.usage?.output_tokens ?? 0,
                cost: msg.cost ?? 0,
              },
            },
          });
        }
        break;
      }

      case 'error': {
        this.terminated = true;
        yield* this.closeOpenBlocks();
        yield this.event<RunErrorEvent>(EventType.RUN_ERROR, {
          message: msg.message ?? 'Unknown error',
          code: msg.subtype,
        });
        break;
      }

      case 'session':
        // Session init — surface as RAW for debugging; not rendered by frontend
        yield this.event<RawEvent>(EventType.RAW, { event: msg });
        break;

      case 'system':
        if (msg.subtype === 'auto_retry') {
          yield this.event<CustomEvent>(EventType.CUSTOM, {
            name: 'auto_retry',
            value: { attempt: msg.attempt ?? 1 },
          });
        } else if (msg.subtype === 'post_tool_continuation') {
          yield this.event<CustomEvent>(EventType.CUSTOM, {
            name: 'continuation_attempt',
            value: {
              attempt: msg.attempt ?? 1,
              kind: 'post_tool_completion',
            },
          });
        }
        break;

      case 'done':
        // Generator completion is the canonical done signal; 'done' msg is redundant
        break;

      case 'user':
        // User messages are not re-emitted to the stream
        break;
    }
  }

  /**
   * Constructs a typed AG-UI event with correlation fields on every event.
   * seq: monotonic counter for ordering guarantees (OpenClaw pattern).
   * timestamp: Unix ms for per-step elapsed time calculation in the UI.
   */
  private event<T extends BaseEvent>(
    type: T['type'],
    fields: Omit<T, 'type' | 'timestamp'>,
  ): T {
    return {
      type,
      timestamp: Date.now(),
      threadId: this.threadId,
      runId: this.runId,
      // seq is a non-standard extension field; BaseEvent schema uses passthrough
      seq: this.seq++,
      ...fields,
    } as unknown as T;
  }
}
