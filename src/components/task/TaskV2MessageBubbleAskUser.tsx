import { useCallback } from 'react';

import { InlineQuestionCard } from '@/components/task/InlineQuestionCard';
import {
  formatQuestionAnswer,
  normalizeQuestionAnswers,
} from '@/shared/hooks/useQuestionInterrupts';

import { parseAskUserQuestion } from './ask-user-question';
import { useQuestionInterruptsContext } from './QuestionInterruptsProvider';
import type { AGUIMessage, AGUIToolCall } from './TaskV2MessageBubble.types';

export function AskUserQuestionCard({
  tc,
  allMessages,
  onSendMessage,
}: {
  tc: AGUIToolCall;
  allMessages: AGUIMessage[];
  onSendMessage?: (text: string) => void;
}) {
  const questions = parseAskUserQuestion(tc);

  // Check if user already answered (a user message follows the assistant message containing this tool call)
  const toolCallMsgIdx = allMessages.findIndex(
    (m) => m.role === 'assistant' && m.toolCalls?.some((t) => t.id === tc.id),
  );
  const nextUserMsg =
    toolCallMsgIdx >= 0
      ? allMessages.slice(toolCallMsgIdx + 1).find((m) => m.role === 'user')
      : undefined;
  const answered = !!nextUserMsg;

  // When the backend holds a record for this call, the card answers that
  // record and resumes the run. Without one, it stays a plain message, the
  // same as a transcript whose question was never recorded.
  //
  // Submission waits while the lookup is pending: an answer sent before the
  // record is known would leave it pending. A failed lookup does not block the
  // user. The card sends a plain message, and the next successful read offers
  // any record in the panel, since this card is then answered.
  const state = useQuestionInterruptsContext();
  const openQuestion = state?.openQuestions.find(
    (question) => question.toolUseId === tc.id,
  );
  const interruptId = openQuestion?.interruptId;
  const answer = state?.answer;
  const awaitingLookup = !interruptId && state?.lookup === 'pending';

  const handleSubmit = useCallback(
    (answers: Record<string, string>) => {
      if (interruptId && answer) {
        void answer(interruptId, answers);
        return;
      }
      if (awaitingLookup || !onSendMessage) return;
      const text = formatQuestionAnswer(normalizeQuestionAnswers(answers));
      if (text) onSendMessage(text);
    },
    [answer, awaitingLookup, interruptId, onSendMessage],
  );

  if (questions.length === 0) return null;

  return (
    <InlineQuestionCard
      questions={questions}
      onSubmit={handleSubmit}
      answered={answered}
      answerText={nextUserMsg?.content}
      submitDisabled={awaitingLookup}
    />
  );
}
