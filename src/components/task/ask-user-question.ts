/**
 * The transcript's view of an `AskUserQuestion` tool call: the questions it
 * asked and whether the thread already carries an answer after it. The inline
 * card and the question panel read the same state, so they cannot disagree
 * about which surface should answer the question.
 */

import type { AgentQuestion } from '@/shared/hooks/agent-types';
import { normalizeAgentQuestions } from '@/shared/questions/question-policy';

import type { AGUIMessage, AGUIToolCall } from './TaskV2MessageBubble.types';
import { getToolArgs, getToolName } from './TaskV2MessageBubble.types';

export function parseAskUserQuestion(tc: AGUIToolCall): AgentQuestion[] {
  return normalizeAgentQuestions(getToolArgs(tc));
}

export type InlineQuestionState = 'missing' | 'open' | 'answered';

/**
 * `missing` when the thread renders no interactive card for this tool call
 * (absent, not an `AskUserQuestion`, or no parseable questions). `answered`
 * when a user message follows the call; `open` otherwise.
 */
export function inlineQuestionState(
  messages: readonly AGUIMessage[],
  toolCallId: string,
): InlineQuestionState {
  const index = messages.findIndex((message) =>
    message.toolCalls?.some((call) => call.id === toolCallId),
  );
  if (index < 0) return 'missing';
  const call = messages[index].toolCalls?.find((c) => c.id === toolCallId);
  if (!call || getToolName(call) !== 'AskUserQuestion') return 'missing';
  if (parseAskUserQuestion(call).length === 0) return 'missing';
  return messages.slice(index + 1).some((message) => message.role === 'user')
    ? 'answered'
    : 'open';
}
