import {
  EventType,
  type ActivityDeltaEvent,
  type ActivitySnapshotEvent,
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
  hasOpenPermissionWait,
  listOpenPermissionWaits,
  subscribePermissionWaits,
} from '@/core/agent/permission-waits';
import {
  normalizeStopReason,
  TURN_BUDGET_EVENT_NAME,
} from '@/core/agent/turn-budget';
import type { AgentMessage, TaskPlan } from '@/core/agent/types';

import { downloadActivityEvent } from './download-activity';
import { CustomEventName } from './event-schema';
import { permissionInterrupt, planInterrupt } from './interrupts';
import { PausableSource } from './pausable-source';
import { RunUsageAccumulator } from './run-usage';

/** What the emitter found when it asked the source for its next message. */
type SourceStep =
  | { kind: 'message'; result: IteratorResult<AgentMessage> }
  | { kind: 'paused'; interrupts: Interrupt[] };

/** Where a plan stands; the plan widget's terminal state is part of its content. */
type PlanActivityPhase = 'awaiting_approval' | 'running';

/** Message types that mean the planning phase has finished. */
const PLANNING_ENDED_BY = new Set<AgentMessage['type']>([
  'plan',
  'direct_answer',
  'text',
  'tool_use',
]);

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
  /**
   * The task whose permission prompts this run may pause on. Absent for runs
   * that have no task, which never pause.
   */
  taskId?: string;
  /** Agent provider and model the run's usage is attributed to. */
  provider?: string;
  model?: string;
  /**
   * A plan widget an earlier run opened and left unsettled. A permission
   * continuation runs on a new emitter, so it starts from this id and patches
   * the same widget when it ends.
   */
  planActivityId?: string;
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
  /** Ended at an open permission decision; the source stays open for a continuation. */
  private paused = false;
  /** Sub-agent that owns the open text block; undefined is the parent run. */
  private currentMessageOwner: string | undefined = undefined;
  /** Sub-agent invocations started and not yet ended. */
  private openSubagents = new Set<string>();
  /** Id of this run's planning status activity while it is open. */
  private planningActivityId: string | null = null;
  /** Sub-agent that owns the open planning status activity. */
  private planningActivityOwner: string | undefined = undefined;
  /**
   * The plan/checklist activity this run opened, named after the plan id so
   * the planning run and its execution run update one widget.
   */
  private planActivityId: string | null = null;
  /** Sub-agent that owns the open plan activity. */
  private planActivityOwner: string | undefined = undefined;

  /** This run's own model calls; reported on the terminal event. */
  private readonly usage: RunUsageAccumulator;

  constructor(
    private readonly threadId: string,
    private readonly runId: string,
    private readonly context?: AGUIRunContext,
  ) {
    this.usage = new RunUsageAccumulator({
      provider: context?.provider,
      model: context?.model,
    });
    this.planActivityId = context?.planActivityId ?? null;
  }

  /** Usage and spend for the terminal event; both absent when unreported. */
  private usageFields(): Pick<RunFinishedEvent, 'usage' | 'metadata'> {
    const usage = this.usage.tokenUsage;
    const costUsd = this.usage.costUsd;
    return {
      ...(usage ? { usage } : {}),
      ...(costUsd !== undefined ? { metadata: { costUsd } } : {}),
    };
  }

  /** True when this run ended at a permission decision and can be continued. */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * The plan widget this run opened or inherited and did not settle. A
   * continuation emitter takes it over so the widget is patched exactly once
   * when the work actually ends.
   */
  openPlanActivityId(): string | null {
    return this.planActivityId;
  }

  async *transform(
    source: AsyncGenerator<AgentMessage> | PausableSource<AgentMessage>,
    onMessage?: (message: AgentMessage) => void | Promise<void>,
  ): AsyncGenerator<BaseEvent> {
    const cursor =
      source instanceof PausableSource
        ? source
        : new PausableSource<AgentMessage>(source);
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
        },
      });
    }

    try {
      for (;;) {
        const step = await this.nextSourceStep(cursor);
        if (step.kind === 'paused') {
          this.paused = true;
          this.pendingInterrupts = step.interrupts;
          break;
        }
        if (step.result.done) break;
        const msg = step.result.value;
        await onMessage?.(msg);
        yield* this.mapMessage(msg);
        // Stop processing further messages after an inline RUN_ERROR or stop
        if (this.terminated || this.cancelled) {
          cursor.close();
          break;
        }
      }
    } catch (err) {
      caughtError = err;
      // Only a real abort is a user stop. An upstream "connection aborted"
      // is a failure the user must see, so the message text is not checked.
      const isAbort =
        this.context?.signal?.aborted === true ||
        (err instanceof Error && err.name === 'AbortError');
      yield* this.endPlanningActivity(isAbort ? 'cancelled' : 'failed');
      yield* this.endPlanActivity(isAbort ? 'cancelled' : 'failed');
      // A thrown error is never a suspension, whatever decision was pending.
      yield* this.closeOpenBlocks(false);
      if (isAbort) {
        // A user stop is not a failure: report the standard cancelled outcome
        // and let the task settle as stopped rather than error.
        this.cancelled = true;
      } else {
        yield this.event<RunErrorEvent>(EventType.RUN_ERROR, {
          message: err instanceof Error ? err.message : String(err),
          ...this.usageFields(),
        });
      }
    } finally {
      // A user stop is a completed cancellation, not a failure, so it still
      // closes with RUN_FINISHED. Any other caught error already emitted
      // RUN_ERROR and must not also finish.
      if ((caughtError === undefined || this.cancelled) && !this.terminated) {
        yield* this.endPlanningActivity(this.cancelled ? 'cancelled' : 'done');
        // A plan awaiting approval keeps its phase; the decision is the next
        // run's starting point, not this run's completion.
        if (this.outcome()?.type !== 'interrupt') {
          yield* this.endPlanActivity(this.cancelled ? 'cancelled' : 'done');
        }
        // Only a run that completes at an interrupt suspends its open
        // children; the terminal state is not set yet on the error paths.
        yield* this.closeOpenBlocks(this.outcome()?.type === 'interrupt');
        yield this.event<RunFinishedEvent>(EventType.RUN_FINISHED, {
          outcome: this.outcome(),
          ...this.usageFields(),
        });
      }
    }
  }

  /**
   * The source's next message, or a pause when a tool permission for this
   * run's task is open and no subagent is running. A subagent cannot be closed
   * across a pause, so a run with one open answers its prompt in place.
   *
   * A message whose pull was in flight when the pause won is not consumed; the
   * source keeps it for the continuation.
   */
  private nextSourceStep(
    cursor: PausableSource<AgentMessage>,
  ): Promise<SourceStep> {
    const taskId = this.context?.taskId;
    if (taskId === undefined) {
      return cursor.pull().then((result) => {
        cursor.settle();
        return { kind: 'message', result };
      });
    }
    const pauseNow = (): Interrupt[] | null =>
      this.openSubagents.size === 0 && hasOpenPermissionWait(taskId)
        ? listOpenPermissionWaits(taskId).map(permissionInterrupt)
        : null;
    const ready = pauseNow();
    if (ready) return Promise.resolve({ kind: 'paused', interrupts: ready });
    return new Promise<SourceStep>((resolve, reject) => {
      let decided = false;
      const stopWatching = subscribePermissionWaits(taskId, () => {
        if (decided) return;
        const interrupts = pauseNow();
        if (!interrupts) return;
        decided = true;
        stopWatching();
        // Tools the agent runs in parallel open their prompts back to back;
        // reporting after the current turn keeps them in one interrupt batch.
        setImmediate(() =>
          resolve({ kind: 'paused', interrupts: pauseNow() ?? interrupts }),
        );
      });
      cursor.pull().then(
        (result) => {
          if (decided) return;
          decided = true;
          stopWatching();
          cursor.settle();
          resolve({ kind: 'message', result });
        },
        (error: unknown) => {
          if (decided) return;
          decided = true;
          stopWatching();
          cursor.settle();
          reject(error);
        },
      );
    });
  }

  /** Why the run ended. Absent means success. */
  private outcome(): RunFinishedOutcome | undefined {
    if (this.cancelled) return { type: 'cancelled' };
    if (this.pendingInterrupts.length > 0) {
      return { type: 'interrupt', interrupts: this.pendingInterrupts };
    }
    return undefined;
  }

  private *closeOpenBlocks(suspended: boolean): Generator<BaseEvent> {
    yield* this.endText();
    for (const [toolCallId] of this.activeToolCalls) {
      yield this.event<ToolCallEndEvent>(EventType.TOOL_CALL_END, {
        toolCallId,
      });
    }
    this.activeToolCalls.clear();
    // Close sub-agent invocations the SDK never reported finished, so RUN_FINISHED
    // is not rejected while they are open. A child whose segment ends at a
    // decision is suspended, not failed: a later run may continue it once the
    // interrupts are answered. Any other ending is an error, because a missing
    // notification is not evidence the delegated work completed.
    const interruptIds = suspended
      ? this.pendingInterrupts.map((interrupt) => interrupt.id)
      : [];
    for (const subagentRunId of this.openSubagents) {
      if (suspended) {
        yield this.event<SubagentFinishedEvent>(EventType.SUBAGENT_FINISHED, {
          subagentRunId,
          outcome: {
            type: 'suspended',
            ...(interruptIds.length > 0 ? { interruptIds } : {}),
          },
        });
      } else {
        yield this.event<SubagentErrorEvent>(EventType.SUBAGENT_ERROR, {
          subagentRunId,
          message: 'Sub-agent did not report completion',
          code: 'run_ended',
        });
      }
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

  /**
   * Opens the planning status widget on the first heartbeat and patches it on
   * later ones, so one widget carries the whole planning phase.
   */
  private *planningActivity(msg: AgentMessage): Generator<BaseEvent> {
    const message = msg.content ?? 'Planning...';
    const elapsedMs = msg.elapsedMs ?? 0;
    if (this.planningActivityId) {
      yield this.event<ActivityDeltaEvent>(EventType.ACTIVITY_DELTA, {
        messageId: this.planningActivityId,
        activityType: 'status',
        ...ownerField(this.planningActivityOwner),
        patch: [
          { op: 'replace', path: '/message', value: message },
          { op: 'replace', path: '/elapsedMs', value: elapsedMs },
        ],
      });
      return;
    }
    this.planningActivityId = `planning-status-${this.runId}`;
    this.planningActivityOwner = msg.subagentRunId;
    yield this.event<ActivitySnapshotEvent>(EventType.ACTIVITY_SNAPSHOT, {
      messageId: this.planningActivityId,
      activityType: 'status',
      content: { phase: 'planning', message, elapsedMs },
      replace: true,
      ...ownerField(this.planningActivityOwner),
    });
  }

  /**
   * Settles the planning widget, so it never reads as in progress once
   * planning ended, failed, or was stopped. A no-op when none is open.
   */
  private *endPlanningActivity(
    phase: 'done' | 'failed' | 'cancelled',
  ): Generator<BaseEvent> {
    if (!this.planningActivityId) return;
    const messageId = this.planningActivityId;
    this.planningActivityId = null;
    const owner = this.planningActivityOwner;
    this.planningActivityOwner = undefined;
    yield this.event<ActivityDeltaEvent>(EventType.ACTIVITY_DELTA, {
      messageId,
      activityType: 'status',
      ...ownerField(owner),
      patch: [{ op: 'replace', path: '/phase', value: phase }],
    });
  }

  /**
   * Opens the plan/checklist widget for a plan, or replaces its content when a
   * later run (the execution run) reports the same plan. The message id is
   * derived from the plan id, so both runs update one widget and a replay
   * never shows two.
   */
  private *planActivity(
    plan: TaskPlan,
    phase: PlanActivityPhase,
    owner?: string,
  ): Generator<BaseEvent> {
    const nextId = `plan-${plan.id}`;
    // A run that reports a second plan supersedes the first. Its interrupt is
    // replaced below, so its widget would otherwise stay awaiting approval
    // forever.
    if (this.planActivityId !== null && this.planActivityId !== nextId) {
      yield* this.endPlanActivity('cancelled');
    }
    this.planActivityId = nextId;
    this.planActivityOwner = owner;
    yield this.event<ActivitySnapshotEvent>(EventType.ACTIVITY_SNAPSHOT, {
      messageId: this.planActivityId,
      activityType: 'plan',
      content: {
        phase,
        goal: plan.goal,
        steps: plan.steps.map((step) => ({
          id: step.id,
          description: step.description,
          status: step.status,
        })),
      },
      replace: true,
      ...ownerField(this.planActivityOwner),
    });
  }

  /** Settles the plan widget. A no-op when this run opened none. */
  private *endPlanActivity(
    phase: 'done' | 'failed' | 'cancelled',
  ): Generator<BaseEvent> {
    if (!this.planActivityId) return;
    const owner = this.planActivityOwner;
    this.planActivityOwner = undefined;
    yield this.event<ActivityDeltaEvent>(EventType.ACTIVITY_DELTA, {
      messageId: this.planActivityId,
      activityType: 'plan',
      ...ownerField(owner),
      patch: [{ op: 'replace', path: '/phase', value: phase }],
    });
    this.planActivityId = null;
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
    // Planning is over once the plan, an answer, or real work begins.
    if (PLANNING_ENDED_BY.has(msg.type)) {
      yield* this.endPlanningActivity('done');
    }
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
        // The standard activity is what AG-UI clients render and what
        // persistence stores, so a reload shows the same single widget.
        yield* this.planningActivity(msg);
        // The CUSTOM event stays for the V1 task view: `useAgent` maps it in
        // agent-messages.ts and RunningIndicator renders it, and neither reads
        // activity events. Remove it, and the legacy branches in
        // agent-messages.ts, in the change that deletes that view (TaskDetail
        // rendering RunningIndicator). The V2 thread renders the activity.
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
        yield* this.ensureSubagent(msg.subagentRunId);
        const reasoningId = crypto.randomUUID();
        yield this.event<ReasoningMessageStartEvent>(
          EventType.REASONING_MESSAGE_START,
          {
            messageId: reasoningId,
            role: 'reasoning',
            ...ownerField(msg.subagentRunId),
          },
        );
        yield this.event<ReasoningMessageContentEvent>(
          EventType.REASONING_MESSAGE_CONTENT,
          {
            messageId: reasoningId,
            delta: msg.content,
            ...ownerField(msg.subagentRunId),
          },
        );
        yield this.event<ReasoningMessageEndEvent>(
          EventType.REASONING_MESSAGE_END,
          {
            messageId: reasoningId,
            ...ownerField(msg.subagentRunId),
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
          ...(msg.subagentOutcome === 'suspended'
            ? {
                outcome: {
                  type: 'suspended' as const,
                  ...(msg.interruptIds?.length
                    ? { interruptIds: msg.interruptIds }
                    : {}),
                },
              }
            : {}),
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
        // The planning call is part of the run's own spend.
        this.usage.record(msg);
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
        if (msg.plan?.id) {
          yield* this.planActivity(
            msg.plan,
            this.context?.planInterrupt ? 'awaiting_approval' : 'running',
            msg.subagentRunId,
          );
        }
        if (this.context?.planInterrupt) {
          const plan = msg.plan;
          if (!plan?.id) {
            // Without an id there is no durable record to approve, so an
            // interrupt would be unanswerable. Fail instead of emitting one.
            // An earlier plan in this run may have opened a widget awaiting
            // approval; the run fails, so that approval can never be given.
            this.terminated = true;
            yield* this.endPlanningActivity('failed');
            yield* this.endPlanActivity('failed');
            yield* this.closeOpenBlocks(false);
            yield this.event<RunErrorEvent>(EventType.RUN_ERROR, {
              message:
                'Planning produced a plan without an id; it cannot be approved',
              code: 'INVALID_PLAN',
              // The planning call was recorded above; the failed run still
              // reported that spend.
              ...this.usageFields(),
            });
            break;
          }
          // One decision per planning run: a later plan replaces an earlier one.
          this.pendingInterrupts = [planInterrupt(this.threadId, plan)];
        }
        break;
      }

      case 'media_download_activity': {
        const activity = msg.downloadActivity;
        if (
          !activity ||
          activity.taskId !== (this.context?.taskId ?? this.threadId) ||
          activity.runId !== this.runId
        )
          break;
        const snapshot = downloadActivityEvent(activity);
        yield this.event<ActivitySnapshotEvent>(EventType.ACTIVITY_SNAPSHOT, {
          ...snapshot,
          ...ownerField(msg.subagentRunId),
        });
        break;
      }

      case 'plan_activity': {
        // An execution run reports the plan it is carrying out, so the plan
        // widget opens again after a reload or on a fresh client.
        if (msg.plan?.id) {
          yield* this.planActivity(msg.plan, 'running', msg.subagentRunId);
        }
        break;
      }

      case 'direct_answer': {
        this.usage.record(msg);
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
        // Project the run-so-far usage into STATE_SNAPSHOT for consumers that
        // read `state.usage` live. The terminal event's `usage` is the record;
        // drop this projection once agui-provider reads usage from it.
        // STATE_SNAPSHOT is fully handled by react-ag-ui; STATE_DELTA was silently dropped in v0.0.21.
        this.usage.record(msg);
        const projection = this.usage.projection;
        if (projection) {
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
              usage: projection,
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
        yield* this.endPlanningActivity('failed');
        yield* this.endPlanActivity('failed');
        yield* this.closeOpenBlocks(false);
        yield this.event<RunErrorEvent>(EventType.RUN_ERROR, {
          message: msg.message ?? 'Unknown error',
          code: msg.subtype,
          ...this.usageFields(),
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
