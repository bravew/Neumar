import { QuestionFormCard } from '@/components/shared/chat-panel';
import type { QuestionFormCardProps } from '@/components/shared/chat-panel';
import type { AgentQuestion } from '@/shared/hooks/agent-types';

interface InlineQuestionCardProps extends Omit<
  QuestionFormCardProps,
  'questions'
> {
  questions: AgentQuestion[];
}

export function InlineQuestionCard(props: InlineQuestionCardProps) {
  return <QuestionFormCard {...props} />;
}
