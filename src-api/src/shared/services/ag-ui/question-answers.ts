/**
 * The answer record for an agent question, in the Agent SDK's own shape:
 * answers keyed by the question text (multi-select comma-separated), plus
 * optional freeform text. The legacy answer endpoint stores this shape, so a
 * question is described the same way whichever surface answered it.
 */

import { parseDecisionResponse, type QuestionDecision } from './interrupts';

export interface ParsedQuestionAnswer {
  /** What the record stores; identical to the legacy endpoint's payload. */
  answers: Record<string, string>;
  /** The transcript message the answer turn carries. */
  text: string;
}

export type QuestionAnswerParse =
  | { ok: true; value: ParsedQuestionAnswer }
  | { ok: false; error: string };

/** The question texts a stored question set was asked with. */
export function questionTexts(questions: unknown[]): string[] {
  return questions.flatMap((question) => {
    const text =
      typeof question === 'object' && question !== null
        ? (question as { question?: unknown }).question
        : undefined;
    return typeof text === 'string' && text.trim() ? [text] : [];
  });
}

/**
 * Validates the answer payload and derives the transcript text from it. The
 * stored record and the text come from one parse, so a stored answer cannot
 * disagree with the turn that ran.
 *
 * A record must answer a question the row actually asked. The single-line
 * `answer` form is keyed to the first question when the set has text.
 */
export function parseQuestionAnswer(
  payload: unknown,
  askedTexts: string[],
): QuestionAnswerParse {
  const parsed = parseDecisionResponse('question', payload);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const decision: QuestionDecision = parsed.response;

  const answers = decision.answers ?? {};
  // Nothing to check against when the stored set has no question text.
  const unknown =
    askedTexts.length > 0
      ? Object.keys(answers).find((question) => !askedTexts.includes(question))
      : undefined;
  if (unknown !== undefined) {
    return {
      ok: false,
      error: `The answer names a question that was not asked: ${unknown}`,
    };
  }

  const hasRecord = Object.keys(answers).length > 0;
  if (hasRecord) {
    // A freeform note accompanies the record as its own transcript line and is
    // not stored as an answer.
    return {
      ok: true,
      value: {
        answers,
        text: [
          ...Object.entries(answers).map(
            ([question, answer]) => `${question} → ${answer}`,
          ),
          ...(decision.response ? [decision.response] : []),
        ].join('\n'),
      },
    };
  }

  // The single-line form and a freeform-only reply both answer the first
  // question; the transcript carries just the reply.
  const single = decision.answer ?? decision.response;
  if (single === undefined || !askedTexts[0]) {
    return { ok: false, error: 'An answer is required' };
  }
  return {
    ok: true,
    value: { answers: { [askedTexts[0]]: single }, text: single },
  };
}
