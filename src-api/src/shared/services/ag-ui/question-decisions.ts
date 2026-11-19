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

import { agentQuestionService } from '@/core/agent/questions';

import {
  parseDecisionInterruptId,
  parseDecisionResponse,
  type ResumeEntryInput,
} from './interrupts';

export type QuestionResume =
  | { kind: 'none' }
  | { kind: 'answer'; questionId: string; answer: string }
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

  const parsed = parseDecisionResponse('question', questionRef.entry.payload);
  if (!parsed.ok) return rejected(400, parsed.error, 'invalid_response');
  if (input.lastUserText.trim() !== parsed.response.answer) {
    return rejected(
      400,
      'The answer must be the final user message of this request',
      'answer_mismatch',
    );
  }
  return { kind: 'answer', questionId, answer: parsed.response.answer };
}

/**
 * Records the answer only while the question is still pending. Called at the
 * point the continuation is accepted, so a run that is refused earlier leaves
 * the question open. Returns false when another request settled it first.
 */
export function answerQuestionOnce(
  questionId: string,
  answer: string,
): boolean {
  if (agentQuestionService.getQuestion(questionId)?.status !== 'pending') {
    return false;
  }
  agentQuestionService.answerQuestion(questionId, { answer });
  return true;
}

/** Cancels the question only while it is pending. False when already settled. */
export function cancelQuestionOnce(questionId: string): boolean {
  return agentQuestionService.cancelQuestion(questionId);
}
