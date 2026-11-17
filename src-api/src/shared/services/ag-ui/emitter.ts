import {
  EventType,
  type BaseEvent,
  type CustomEvent,
  type Interrupt,
  type RawEvent,
  type ReasoningMessageContentEvent,
  type ReasoningMessageEndEvent,
  type ReasoningMessageStartEvent,
  type RunErrorEvent,
  type RunFinishedEvent,
  type RunFinishedOutcome,
  type RunStartedEvent,
  type StateSnapshotEvent,
  type StepFinishedEvent,
  type SubagentErrorEvent,
  type SubagentFinishedEvent,
  type SubagentStartedEvent,
  type StepStartedEvent,
  type TextMessageContentEvent,
  type TextMessageEndEvent,
  type TextMessageStartEvent,
  type ToolCallArgsEvent,
  type ToolCallEndEvent,
  type ToolCallResultEvent,
  type ToolCallStartEvent,
} from '@ag-ui/core';

import {
  normalizeStopReason,
  TURN_BUDGET_EVENT_NAME,
} from '@/core/agent/turn-budget';
import type { AgentMessage } from '@/core/agent/types';

import { CustomEventName } from './event-schema';
import { planInterrupt } from './interrupts';

/** Attribution field for a message owned by a sub-agent; empty for the parent run. */
function ownerField(subagentRunId: string | undefined): {
  subagentRunId?: string;
} {
  return subagentRunId ? { subagentRunId } : {};
}

/**
 * Optional context emitted as STATE_SNAPSHOT at run start.
 * Lets the frontend display workspace and task info from the first event.
 */
export interface AGUIRunContext {
  /** Absolute path to the user-configured workspace root */
  workspaceRoot?: string;
  /** Human-readable task title */
  taskTitle?: string;
  /**
   * True only for the task planning run. A plan message then closes the run
   * with a standard interrupt outcome instead of a success, so the client
   * knows the plan is waiting for a decision. Other emitters leave it off:
   * a plan-shaped message mid-execution must not pause the run.
   */
  planInterrupt?: boolean;
  /**
   * The run's own abort signal. When it has fired, the run ended because the
   * user stopped it, whatever error the adapter surfaced on the way out.
   */
  signal?: AbortSignal;
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
  /** Open decisions that RUN_FINISHED must report to the client. */
  private pendingInterrupts: Interrupt[] = [];
  /** User aborted the run — reported as the standard cancelled outcome. */
  private cancelled = false;
  /** Sub-agent that owns the open text block; undefined is the parent run. */
  private currentMessageOwner: string | undefined = undefined;
  /** Sub-agent invocations started and not yet ended. */
  private openSubagents = new Set<string>();

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

    yield this.event<RunStartedEvent>(EventType.RUN_STARTED, {});

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
        // Stop processing further messages after an inline RUN_ERROR or stop
        if (this.terminated || this.cancelled) break;
      }
    } catch (err) {
      caughtError = err;
      // Only a real abort is a user stop. An upstream "connection aborted"
      // is a failure the user must see, so the message text is not checked.
      const isAbort =
        this.context?.signal?.aborted === true ||
        (err instanceof Error && err.name === 'AbortError');
      yield* this.closeOpenBlocks();
      if (isAbort) {
        // A user stop is not a failure: report the standard cancelled outcome
        // and let the task settle as stopped rather than error.
        this.cancelled = true;
      } else {
        yield this.event<RunErrorEvent>(EventType.RUN_ERROR, {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      // A user stop is a completed cancellation, not a failure, so it still
      // closes with RUN_FINISHED. Any other caught error already emitted
      // RUN_ERROR and must not also finish.
      if ((caughtError === undefined || this.cancelled) && !this.terminated) {
        yield* this.closeOpenBlocks();
        yield this.event<RunFinishedEvent>(EventType.RUN_FINISHED, {
          outcome: this.outcome(),
        });
      }
    }
  }

  /** Why the run ended. Absent means success. */
  private outcome(): RunFinishedOutcome | undefined {
    if (this.cancelled) return { type: 'cancelled' };
    if (this.pendingInterrupts.length > 0) {
      return { type: 'interrupt', interrupts: this.pendingInterrupts };
    }
    return undefined;
  }

  private *closeOpenBlocks(): Generator<BaseEvent> {
    yield* this.endText();
    for (const [toolCallId] of this.activeToolCalls) {
      yield this.event<ToolCallEndEvent>(EventType.TOOL_CALL_END, {
        toolCallId,
      });
    }
    this.activeToolCalls.clear();
    // Close sub-agent invocations the SDK never reported finished, so RUN_FINISHED
    // is not rejected while they are open. They end as errors: a missing
    // notification is not evidence the delegated work completed.
    for (const subagentRunId of this.openSubagents) {
      yield this.event<SubagentErrorEvent>(EventType.SUBAGENT_ERROR, {
        subagentRunId,
        message: 'Sub-agent did not report completion',
        code: 'run_ended',
      });
    }
    this.openSubagents.clear();
    // Close any still-active STEPs before RUN_FINISHED. The AG-UI verifier
    // (@ag-ui/client verify.ts) rejects RUN_FINISHED while steps are open.
    // Only workflow steps (planning, execution) reach this set now.
    for (const stepName of this.activeSteps) {
      yield this.event<StepFinishedEvent>(EventType.STEP_FINISHED, {
        stepName,
      });
    }
    this.activeSteps.clear();
  }

  /** Closes the open text block, if any. */
  private *endText(): Generator<BaseEvent> {
    if (!this.currentMessageId) return;
    yield this.event<TextMessageEndEvent>(EventType.TEXT_MESSAGE_END, {
      messageId: this.currentMessageId,
    });
    this.currentMessageId = null;
    this.currentMessageOwner = undefined;
  }

  /** Text blocks never mix owners: a change of owner closes the open block. */
  private *closeTextFor(owner: string | undefined): Generator<BaseEvent> {
    if (this.currentMessageOwner !== owner) yield* this.endText();
  }

  /** Starts an invocation whose messages arrive before its lifecycle event. */
  private *ensureSubagent(
    subagentRunId: string | undefined,
  ): Generator<BaseEvent> {
    if (!subagentRunId || this.openSubagents.has(subagentRunId)) return;
    this.openSubagents.add(subagentRunId);
    yield this.event<SubagentStartedEvent>(EventType.SUBAGENT_STARTED, {
      subagentRunId,
      name: 'subagent',
    });
  }

  private *mapMessage(msg: AgentMessage): Generator<BaseEvent> {
    switch (msg.type) {
      case 'text': {
        // Skip empty deltas — @ag-ui/client rejects delta === ''
        if (!msg.content) break;
        yield* this.ensureSubagent(msg.subagentRunId);
        yield* this.closeTextFor(msg.subagentRunId);
        if (!this.currentMessageId) {
          this.currentMessageId = msg.id ?? crypto.randomUUID();
          this.currentMessageOwner = msg.subagentRunId;
          yield this.event<TextMessageStartEvent>(
            EventType.TEXT_MESSAGE_START,
            {
              messageId: this.currentMessageId,
              role: 'assistant',
              ...ownerField(msg.subagentRunId),
            },
          );
        }
        yield this.event<TextMessageContentEvent>(
          EventType.TEXT_MESSAGE_CONTENT,
          {
            messageId: this.currentMessageId,
            delta: msg.content,
            ...ownerField(msg.subagentRunId),
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
        yield* this.ensureSubagent(msg.subagentRunId);
        // Close any open text message before starting a tool call
        yield* this.endText();
        const toolCallId = msg.id ?? crypto.randomUUID();
        this.activeToolCalls.set(toolCallId, msg.name ?? 'unknown');
        yield this.event<ToolCallStartEvent>(EventType.TOOL_CALL_START, {
          toolCallId,
          toolCallName: msg.name ?? 'unknown',
          parentMessageId: undefined,
          ...ownerField(msg.subagentRunId),
        });
        // Args as single chunk (progressive streaming deferred to Phase 5)
        if (msg.input != null) {
          yield this.event<ToolCallArgsEvent>(EventType.TOOL_CALL_ARGS, {
            toolCallId,
            delta: JSON.stringify(msg.input),
            ...ownerField(msg.subagentRunId),
          });
        }
        yield this.event<ToolCallEndEvent>(EventType.TOOL_CALL_END, {
          toolCallId,
          ...ownerField(msg.subagentRunId),
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
            ...ownerField(msg.subagentRunId),
          },
        );
        break;
      }

      case 'subagent_started': {
        const subagentRunId = msg.subagentRunId;
        if (!subagentRunId || this.openSubagents.has(subagentRunId)) break;
        this.openSubagents.add(subagentRunId);
        yield this.event<SubagentStartedEvent>(EventType.SUBAGENT_STARTED, {
          subagentRunId,
          name: msg.subagentName ?? 'subagent',
          ...(msg.subagentDescription === undefined
            ? {}
            : { description: msg.subagentDescription }),
          ...(msg.parentSubagentRunId
            ? { parentSubagentRunId: msg.parentSubagentRunId }
            : {}),
          ...(msg.parentToolCallId
            ? { parentToolCallId: msg.parentToolCallId }
            : {}),
        });
        break;
      }

      case 'subagent_finished': {
        const subagentRunId = msg.subagentRunId;
        if (!subagentRunId) break;
        yield* this.ensureSubagent(subagentRunId);
        if (this.currentMessageOwner === subagentRunId) yield* this.endText();
        this.openSubagents.delete(subagentRunId);
        yield this.event<SubagentFinishedEvent>(EventType.SUBAGENT_FINISHED, {
          subagentRunId,
          ...(msg.output === undefined ? {} : { result: msg.output }),
        });
        break;
      }

      case 'subagent_error': {
        const subagentRunId = msg.subagentRunId;
        if (!subagentRunId) break;
        yield* this.ensureSubagent(subagentRunId);
        if (this.currentMessageOwner === subagentRunId) yield* this.endText();
        this.openSubagents.delete(subagentRunId);
        yield this.event<SubagentErrorEvent>(EventType.SUBAGENT_ERROR, {
          subagentRunId,
          message: msg.message ?? 'Sub-agent failed',
          ...(msg.code ? { code: msg.code } : {}),
        });
        break;
      }

      case 'step_started': {
        // Sub-agent lifecycles travel as subagent_* messages; these legacy
        // step messages are kept for the non-AG-UI consumers only.
        if (msg.subagentRunId) break;
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
        if (msg.subagentRunId) break;
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
        // The CUSTOM 'plan' event stays: the persister stores it as the plan
        // message and the legacy assistant-ui path renders it. The decision
        // itself is now a standard interrupt reported on RUN_FINISHED.
        yield this.event<CustomEvent>(EventType.CUSTOM, {
          name: 'plan',
          value: msg.plan
            ? { ...msg.plan, _runId: this.runId }
            : { _runId: this.runId },
        });
        if (this.context?.planInterrupt) {
          const plan = msg.plan;
          if (!plan?.id) {
            // Without an id there is no durable record to approve, so an
            // interrupt would be unanswerable. Fail instead of emitting one.
            this.terminated = true;
            yield* this.closeOpenBlocks();
            yield this.event<RunErrorEvent>(EventType.RUN_ERROR, {
              message:
                'Planning produced a plan without an id; it cannot be approved',
              code: 'INVALID_PLAN',
            });
            break;
          }
          // One decision per planning run: a later plan replaces an earlier one.
          this.pendingInterrupts = [planInterrupt(this.threadId, plan)];
        }
        break;
      }

      case 'direct_answer': {
        // A planner's direct answer is the reply itself. Send it as an
        // assistant message: AG-UI clients render text messages, persistence
        // stores them, and history replays them. As a CUSTOM event it was
        // dropped by all three, leaving only the planner's raw JSON, which
        // arrives as hidden reasoning. A content-less direct_answer is a
        // skip-plan signal and has nothing to show.
        if (!msg.content) break;
        if (this.currentMessageId) {
          yield this.event<TextMessageEndEvent>(EventType.TEXT_MESSAGE_END, {
            messageId: this.currentMessageId,
          });
          this.currentMessageId = null;
        }
        const answerId = crypto.randomUUID();
        yield this.event<TextMessageStartEvent>(EventType.TEXT_MESSAGE_START, {
          messageId: answerId,
          role: 'assistant',
        });
        yield this.event<TextMessageContentEvent>(
          EventType.TEXT_MESSAGE_CONTENT,
          { messageId: answerId, delta: msg.content },
        );
        yield this.event<TextMessageEndEvent>(EventType.TEXT_MESSAGE_END, {
          messageId: answerId,
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
        // Typed turn budget (P2-5): normalize the provider's stop protocol
        // once, here, so every mode's UI reads the same reason.
        const budget =
          msg.turnBudget ??
          normalizeStopReason({
            subtype: msg.subtype,
            terminalReason: msg.terminalReason,
            code: msg.code,
            message: msg.message,
            limit: msg.maxTurns,
          });
        yield this.event<CustomEvent>(EventType.CUSTOM, {
          name: TURN_BUDGET_EVENT_NAME,
          value: budget,
        });
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
        if (this.context?.signal?.aborted) {
          // The adapter reported the stop as an error message. The user asked
          // for it, so close with the same cancelled outcome as a thrown abort.
          this.cancelled = true;
          break;
        }
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
        if (msg.streamSignal) {
          yield this.event<CustomEvent>(EventType.CUSTOM, {
            name: CustomEventName.StreamSignal,
            value: msg.streamSignal,
          });
        } else if (msg.subtype === 'auto_retry') {
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
    fields: Omit<T, 'type' | 'timestamp' | 'threadId' | 'runId'>,
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
