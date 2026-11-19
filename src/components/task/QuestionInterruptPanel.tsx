import { QuestionFormCard } from '@/components/shared/chat-panel';
import {
  type QuestionAgent,
  useQuestionInterrupts,
} from '@/shared/hooks/useQuestionInterrupts';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface QuestionInterruptPanelProps {
  taskId: string | undefined;
  isRunning: boolean;
  agent: QuestionAgent;
}

/**
 * Questions the agent asked in a turn that has ended. The answer continues the
 * run through the standard `resume` entry; `Cancel` ends the question without
 * an answer. Both are bound to the question's interrupt id, so a stale card
 * cannot answer a different question.
 */
export function QuestionInterruptPanel({
  taskId,
  isRunning,
  agent,
}: QuestionInterruptPanelProps) {
  const { t } = useLanguage();
  const { openQuestions, answering, answer, dismiss } = useQuestionInterrupts(
    taskId,
    isRunning,
    agent,
  );

  if (openQuestions.length === 0) return null;

  return (
    <div className="mx-auto max-w-4xl px-4">
      {openQuestions.map((open) => (
        <div key={open.interruptId} aria-busy={answering}>
          <QuestionFormCard
            questions={open.questions}
            onSubmit={(answers) => void answer(open.interruptId, answers)}
          />
          <div className="flex justify-end pb-2">
            <button
              type="button"
              disabled={answering}
              onClick={() => void dismiss(open.interruptId)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                'border-border text-muted-foreground hover:bg-muted border',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {t.approvals.cancel}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
