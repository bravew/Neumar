/**
 * Shares one `useQuestionInterrupts` state between the two places a question
 * can be answered: the inline card in the transcript and the panel under it.
 *
 * The state lives above both so a submission from either surface answers the
 * same record, and the panel can skip a question whose inline card is showing.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  type QuestionAgent,
  type QuestionInterruptContext,
  type OpenQuestion,
  useQuestionInterrupts,
} from '@/shared/hooks/useQuestionInterrupts';

import { inlineQuestionState } from './ask-user-question';
import type { AGUIMessage } from './TaskV2MessageBubble.types';

export interface QuestionInterruptsValue {
  taskId: string | undefined;
  /** Every open question, including one an inline card is showing. */
  openQuestions: OpenQuestion[];
  /** Open questions the panel renders: those with no live inline card. */
  panelQuestions: OpenQuestion[];
  answering: boolean;
  answer: (
    interruptId: string,
    answers: Record<string, string>,
  ) => Promise<void>;
  dismiss: (interruptId: string) => Promise<void>;
}

const QuestionInterruptsContext = createContext<QuestionInterruptsValue | null>(
  null,
);

export function QuestionInterruptsProvider({
  taskId,
  isRunning,
  agent,
  context,
  messages,
  children,
}: {
  taskId: string | undefined;
  isRunning: boolean;
  agent: QuestionAgent;
  context?: QuestionInterruptContext;
  /** The same messages the transcript renders; decides which card is live. */
  messages: readonly AGUIMessage[];
  children: ReactNode;
}) {
  const { openQuestions, answering, answer, dismiss } = useQuestionInterrupts(
    taskId,
    isRunning,
    agent,
    context,
  );

  // A card with a matching record is the surface for that question. The panel
  // keeps it only when the transcript has no live card: absent, or already
  // answered inline (the record still needs settling in that case).
  const panelQuestions = useMemo(
    () =>
      openQuestions.filter(
        (question) =>
          !question.toolUseId ||
          inlineQuestionState(messages, question.toolUseId) !== 'open',
      ),
    [openQuestions, messages],
  );

  const value = useMemo(
    () => ({
      taskId,
      openQuestions,
      panelQuestions,
      answering,
      answer,
      dismiss,
    }),
    [taskId, openQuestions, panelQuestions, answering, answer, dismiss],
  );

  return (
    <QuestionInterruptsContext.Provider value={value}>
      {children}
    </QuestionInterruptsContext.Provider>
  );
}

/**
 * The shared state, or null outside a provider. The inline card falls back to
 * the plain-message path there; the panel renders nothing because it has no
 * record to answer.
 */
export function useQuestionInterruptsContext(): QuestionInterruptsValue | null {
  return useContext(QuestionInterruptsContext);
}
