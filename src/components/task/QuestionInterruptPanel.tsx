import { QuestionFormCard } from '@/components/shared/chat-panel';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { useThreadStore } from '@/shared/stores/thread-store';

import { useQuestionInterruptsContext } from './QuestionInterruptsProvider';

/**
 * Questions the agent asked in a turn that has ended. The answer continues the
 * run through the standard `resume` entry; `Cancel` ends the question without
 * an answer. Both are bound to the question's interrupt id, so a stale card
 * cannot answer a different question.
 *
 * Reads the shared question state, so a question whose inline card is live is
 * not offered twice. It renders nothing outside `QuestionInterruptsProvider`.
 */
export function QuestionInterruptPanel() {
  const { t } = useLanguage();
  const state = useQuestionInterruptsContext();
  const taskId = state?.taskId;
  const subagents = useThreadStore((s) =>
    taskId ? s.threads[taskId]?.subagents : undefined,
  );

  if (!state) return null;
  const { panelQuestions, answering, answer, dismiss } = state;
  if (panelQuestions.length === 0) return null;

  // Bounded and scrollable: the panel sits in a fixed-height thread column, so
  // four questions must scroll rather than push the composer off-screen.
  return (
    <div className="mx-auto max-h-[45vh] max-w-4xl overflow-y-auto px-4">
      {panelQuestions.map((open) => {
        const owner = open.subagentRunId
          ? (subagents?.find((agent) => agent.id === open.subagentRunId)
              ?.name ?? open.subagentRunId.slice(0, 8))
          : undefined;
        return (
          <div key={open.interruptId} aria-busy={answering}>
            {owner && (
              <p className="text-muted-foreground px-1 pb-1 text-xs">
                {t.task.subAgentAskedQuestion.replace('{name}', owner)}
              </p>
            )}
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
        );
      })}
    </div>
  );
}
