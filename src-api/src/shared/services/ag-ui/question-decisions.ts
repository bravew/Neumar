/**
 * Agent questions as standard AG-UI interrupts.
 *
 * The turn that asked a question has already ended, so no SDK callback waits
 * on the `agent_questions` row. The answer is therefore the user's next turn,
 * the same way the legacy chat answers: the record stores the answer and the
 * run continues with it as the final user message. The server checks that
 * message against the resume payload, so the stored answer is the prompt that
 * actually ran.
 */

import {
  agentQuestionService,
  serializeAgentQuestion,
} from '@/core/agent/questions';

import { parseDecisionInterruptId, type ResumeEntryInput } from './interrupts';
import { parseQuestionAnswer, questionTexts } from './question-answers';

export type QuestionResume =
  | { kind: 'none' }
  | {
      kind: 'answer';
      questionId: string;
      /** The record the row stores: question text → answer. */
      answers: Record<string, string>;
      /** The transcript text, derived from the same record. */
      text: string;
    }
  | { kind: 'cancel'; questionId: string }
  | {
      kind: 'rejected';
      status: 400 | 404 | 409;
      body: { error: string; code: string; interruptIds: string[] };
    };

export interface QuestionResumeInput {
  taskId: string;
  entries: ResumeEntryInput[];
  /** Text of the request's final user message, which must be the answer. */
  lastUserText: string;
  now?: number;
}

/**
 * Validates a resume batch that answers an agent question. Returns `none`
 * when the batch holds no question, so the caller's other decision kinds
 * keep their own handling. The caller settles the record with
 * {@link answerQuestionOnce} or {@link cancelQuestionOnce} at the point it
 * actually starts the continuation.
 */
export function resolveQuestionResume(
  input: QuestionResumeInput,
): QuestionResume {
  const refs = input.entries.map((entry) => ({
    entry,
    ref: parseDecisionInterruptId(entry.interruptId),
  }));
  const questionRef = refs.find((item) => item.ref?.kind === 'question');
  if (!questionRef?.ref) return { kind: 'none' };

  const interruptIds = input.entries.map((entry) => entry.interruptId);
  const rejected = (
    status: 400 | 404 | 409,
    error: string,
    code: string,
  ): QuestionResume => ({
    kind: 'rejected',
    status,
    body: { error, code, interruptIds },
  });

  if (refs.length > 1) {
    return rejected(
      400,
      'A batch may answer one question and nothing else',
      'mixed_batch',
    );
  }

  const questionId = questionRef.ref.sourceId;
  const row = agentQuestionService.getQuestion(questionId);
  if (!row) return rejected(404, 'Question not found', 'unknown_interrupt');
  if (row.task_id !== input.taskId) {
    return rejected(
      409,
      'This decision belongs to another task',
      'wrong_thread',
    );
  }
  if (row.status !== 'pending') {
    return rejected(
      409,
      'This decision was already answered',
      'already_resolved',
    );
  }
  const now = input.now ?? Date.now();
  if (row.expires_at && Date.parse(row.expires_at) <= now) {
    return rejected(
      409,
      'This question has expired',
      'continuation_unavailable',
    );
  }

  if (questionRef.entry.status === 'cancelled') {
    return { kind: 'cancel', questionId };
  }

  const parsed = parseQuestionAnswer(
    questionRef.entry.payload,
    questionTexts(serializeAgentQuestion(row).questions),
  );
  if (!parsed.ok) return rejected(400, parsed.error, 'invalid_response');
  if (input.lastUserText.trim() !== parsed.value.text) {
    return rejected(
      400,
      'The answer must be the final user message of this request',
      'answer_mismatch',
    );
  }
  return {
    kind: 'answer',
    questionId,
    answers: parsed.value.answers,
    text: parsed.value.text,
  };
}

/**
 * Records the answer only while the question is still pending. Called at the
 * point the continuation is accepted, so a run that is refused earlier leaves
 * the question open. Returns false when another request settled it first.
 */
export type RecordAnswerResult =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'settled'; message: string };

export function answerQuestionOnce(
  questionId: string,
  answers: Record<string, string>,
  now: number = Date.now(),
): RecordAnswerResult {
  const row = agentQuestionService.getQuestion(questionId);
  if (row?.status !== 'pending') {
    return {
      ok: false,
      reason: 'settled',
      message: 'This decision was already answered',
    };
  }
  // Expiry was checked before the run context resolved; that work can outlast
  // the question, so it is checked again where the write happens.
  if (row.expires_at && Date.parse(row.expires_at) <= now) {
    return {
      ok: false,
      reason: 'expired',
      message: 'This question has expired',
    };
  }
  agentQuestionService.answerQuestion(questionId, answers);
  return { ok: true };
}

/** Cancels the question only while it is pending. False when already settled. */
export function cancelQuestionOnce(questionId: string): boolean {
  return agentQuestionService.cancelQuestion(questionId);
}
