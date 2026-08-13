import { useCallback } from 'react';

import { InlineQuestionCard } from '@/components/task/InlineQuestionCard';
import type { AgentQuestion } from '@/shared/hooks/agent-types';
import { normalizeAgentQuestions } from '@/shared/questions/question-policy';

import type { AGUIMessage, AGUIToolCall } from './TaskV2MessageBubble.types';
import { getToolArgs } from './TaskV2MessageBubble.types';

/** Parse AskUserQuestion tool args into AgentQuestion[] */
function parseQuestions(tc: AGUIToolCall): AgentQuestion[] {
  return normalizeAgentQuestions(getToolArgs(tc));
}

export function AskUserQuestionCard({
  tc,
  allMessages,
  onSendMessage,
}: {
  tc: AGUIToolCall;
  allMessages: AGUIMessage[];
  onSendMessage?: (text: string) => void;
}) {
  const questions = parseQuestions(tc);

  // Check if user already answered (a user message follows the assistant message containing this tool call)
  const toolCallMsgIdx = allMessages.findIndex(
    (m) => m.role === 'assistant' && m.toolCalls?.some((t) => t.id === tc.id),
  );
  const nextUserMsg = allMessages
    .slice(toolCallMsgIdx + 1)
    .find((m) => m.role === 'user');
  const answered = !!nextUserMsg;

  const handleSubmit = useCallback(
    (answers: Record<string, string>) => {
      if (!onSendMessage) return;
      const text = Object.entries(answers)
        .map(([q, a]) => `${q} → ${a}`)
        .join('\n');
      onSendMessage(text);
    },
    [onSendMessage],
  );

  if (questions.length === 0) return null;

  return (
    <InlineQuestionCard
      questions={questions}
      onSubmit={handleSubmit}
      answered={answered}
      answerText={nextUserMsg?.content}
    />
  );
}
