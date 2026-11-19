/**
 * Standard AG-UI interrupts for the decisions this application already owns.
 *
 * An interrupt id names the backend record that holds the decision, so a
 * resume entry can only ever answer that record:
 *
 *   plan:<orchestration_runs.id>      plan approval (the planning run ended)
 *   question:<agent_questions.id>     an agent question (the turn ended)
 *   permission:<permission request>   a tool permission (the SDK is waiting)
 *
 * The response schemas below are the single source for both the
 * `responseSchema` a client renders from and the validation the server runs
 * on a resume entry. A schema describes the answer's shape only; it never
 * authorizes the action, which each flow decides against its own record.
 */

import type { Interrupt } from '@ag-ui/core';
import { z } from 'zod';

import type { SerializedAgentQuestion } from '@/core/agent/questions';
import type {
  OpenPermissionPrompt,
  PermissionPrompt,
} from '@/core/agent/tool-permission-registry';
import type { TaskPlan } from '@/core/agent/types';

export const DECISION_KINDS = ['plan', 'question', 'permission'] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

/** `Interrupt.reason` for each kind. Stable: clients select a card by it. */
export const DECISION_REASON = {
  plan: 'plan_approval',
  question: 'agent_question',
  permission: 'tool_permission',
} as const satisfies Record<DecisionKind, string>;

/** `Interrupt.metadata` key that carries the application's own detail. */
export const DECISION_METADATA_KEY = 'decision';

const MAX_SOURCE_ID_LENGTH = 200;

export function decisionInterruptId(
  kind: DecisionKind,
  sourceId: string,
): string {
  return `${kind}:${sourceId}`;
}

export function parseDecisionInterruptId(
  interruptId: string,
): { kind: DecisionKind; sourceId: string } | null {
  const separator = interruptId.indexOf(':');
  if (separator <= 0) return null;
  const kind = interruptId.slice(0, separator);
  const sourceId = interruptId.slice(separator + 1);
  if (!sourceId || sourceId.length > MAX_SOURCE_ID_LENGTH) return null;
  return (DECISION_KINDS as readonly string[]).includes(kind)
    ? { kind: kind as DecisionKind, sourceId }
    : null;
}

// ─── Responses ────────────────────────────────────────────────────────

/** `approved: false` rejects the plan; it is an answer, not a cancellation. */
export const PlanDecisionSchema = z.strictObject({
  approved: z.boolean(),
});
export type PlanDecision = z.infer<typeof PlanDecisionSchema>;

/**
 * The answer shape is the Agent SDK's own AskUserQuestion output: answers
 * keyed by the question text (multi-select comma-separated), plus optional
 * freeform text. That is also what the legacy answer endpoint stores, so one
 * record describes a question regardless of which surface answered it.
 *
 * `answer` is the single-line form the transcript sends, kept for a stored
 * question with no text to key by.
 */
const AnswerTextSchema = z.string().trim().min(1).max(20_000);
export const QuestionDecisionSchema = z.strictObject({
  answers: z.record(z.string().min(1).max(20_000), AnswerTextSchema).optional(),
  response: AnswerTextSchema.optional(),
  answer: AnswerTextSchema.optional(),
});
export type QuestionDecision = z.infer<typeof QuestionDecisionSchema>;

/** `alwaysAllow` is honoured only when the request did not forbid a rule. */
export const PermissionDecisionSchema = z.strictObject({
  approved: z.boolean(),
  alwaysAllow: z.boolean().optional(),
});
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

const RESPONSE_SCHEMAS = {
  plan: PlanDecisionSchema,
  question: QuestionDecisionSchema,
  permission: PermissionDecisionSchema,
} as const satisfies Record<DecisionKind, z.ZodType>;

export interface DecisionResponses {
  plan: PlanDecision;
  question: QuestionDecision;
  permission: PermissionDecision;
}

export function parseDecisionResponse<K extends DecisionKind>(
  kind: K,
  payload: unknown,
): { ok: true; response: DecisionResponses[K] } | { ok: false; error: string } {
  const parsed = RESPONSE_SCHEMAS[kind].safeParse(payload);
  return parsed.success
    ? { ok: true, response: parsed.data as DecisionResponses[K] }
    : { ok: false, error: z.prettifyError(parsed.error) };
}

/** JSON Schema of the answer an interrupt of this kind expects. */
export function decisionResponseSchema(
  kind: DecisionKind,
): Record<string, unknown> {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(
    RESPONSE_SCHEMAS[kind],
  ) as Record<string, unknown>;
  return schema;
}

// ─── Resume input ─────────────────────────────────────────────────────

/** Upper bound on one batch; a run never opens more decisions than this. */
export const MAX_RESUME_ENTRIES = 32;

export const ResumeEntrySchema = z.object({
  interruptId: z
    .string()
    .min(1)
    .max(MAX_SOURCE_ID_LENGTH + 16),
  status: z.enum(['resolved', 'cancelled']),
  payload: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ResumeEntryInput = z.infer<typeof ResumeEntrySchema>;

export const ResumeSchema = z
  .array(ResumeEntrySchema)
  .min(1)
  .max(MAX_RESUME_ENTRIES);

// ─── Interrupt builders ───────────────────────────────────────────────

export interface PlanDecisionMetadata {
  kind: 'plan';
  taskId: string;
  plan: {
    id: string;
    goal: string;
    steps: Array<{ id: string; description: string; status: string }>;
    notes?: string;
  };
}

/**
 * The interrupt for a pending plan. Built from the stored plan alone, so the
 * run that raised it and a later reload produce the same id and content.
 */
export function planInterrupt(taskId: string, plan: TaskPlan): Interrupt {
  const metadata: PlanDecisionMetadata = {
    kind: 'plan',
    taskId,
    plan: {
      id: plan.id,
      goal: plan.goal,
      steps: plan.steps.map((step) => ({
        id: step.id,
        description: step.description,
        status: step.status,
      })),
      ...(plan.notes ? { notes: plan.notes } : {}),
    },
  };
  return {
    id: decisionInterruptId('plan', plan.id),
    reason: DECISION_REASON.plan,
    message: plan.goal,
    responseSchema: decisionResponseSchema('plan'),
    metadata: { [DECISION_METADATA_KEY]: metadata },
  };
}

export interface PermissionDecisionMetadata {
  kind: 'permission';
  taskId: string;
  permission: PermissionPrompt;
  /** Unix ms after which the adapter denies the request unanswered. */
  expiresAt?: number;
}

/**
 * The interrupt for a tool permission an adapter is waiting on. The id is the
 * adapter's own request id, so a resume entry can only answer that request.
 */
export function permissionInterrupt(open: OpenPermissionPrompt): Interrupt {
  const metadata: PermissionDecisionMetadata = {
    kind: 'permission',
    taskId: open.taskId,
    permission: open.prompt,
    ...(open.expiresAt === null ? {} : { expiresAt: open.expiresAt }),
  };
  return {
    id: decisionInterruptId('permission', open.prompt.id),
    reason: DECISION_REASON.permission,
    message: open.prompt.description,
    responseSchema: decisionResponseSchema('permission'),
    metadata: { [DECISION_METADATA_KEY]: metadata },
  };
}

export interface QuestionDecisionMetadata {
  kind: 'question';
  taskId: string | null;
  questions: unknown[];
  /**
   * The sub-agent invocation that asked, when a child owns the question. The
   * answer still binds to the question record, never to the child.
   */
  subagentRunId?: string;
  /**
   * The `AskUserQuestion` tool call that asked, when the transcript has one.
   * A client uses it to bind the inline card to this record, so the card
   * answers the row instead of sending an unrelated message.
   */
  toolUseId?: string;
  expiresAt?: string;
}

/** The interrupt for a stored agent question that has not been answered. */
export function questionInterrupt(
  question: SerializedAgentQuestion,
  subagentRunId?: string | null,
): Interrupt {
  const first = question.questions[0];
  const prompt =
    typeof first === 'object' &&
    first !== null &&
    'question' in first &&
    typeof first.question === 'string'
      ? first.question
      : 'The agent has a question';
  const metadata: QuestionDecisionMetadata = {
    kind: 'question',
    taskId: question.taskId,
    questions: question.questions,
    ...(subagentRunId ? { subagentRunId } : {}),
    ...(question.toolUseId ? { toolUseId: question.toolUseId } : {}),
    ...(question.expiresAt ? { expiresAt: question.expiresAt } : {}),
  };
  return {
    id: decisionInterruptId('question', question.id),
    reason: DECISION_REASON.question,
    message: prompt,
    responseSchema: decisionResponseSchema('question'),
    metadata: { [DECISION_METADATA_KEY]: metadata },
  };
}
