import { useEffect, useMemo, useRef, useState } from 'react';

import { Loader2, MessageCircleQuestion } from 'lucide-react';

import { InlineQuestionCard } from '@/components/task/InlineQuestionCard';
import { Button } from '@/components/ui/button';
import type { AgentQuestion } from '@/shared/hooks/agent-types';
import { useLanguage } from '@/shared/providers/language-provider';
import { defaultQuestionAnswers } from '@/shared/questions/question-policy';

import { formatDesignQuestionAnswers } from './design-questions';

/** Auto-continue countdown for an open question form (Studio parity). */
const AUTO_CONTINUE_SECONDS = 90;

interface DesignQuestionsPaneProps {
  questions: AgentQuestion[];
  /** A question fence is open but not yet fully streamed. */
  streaming: boolean;
  /** Submit the user's answers as the next DesignMode message. */
  onAnswer: (text: string) => void;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Right-side Questions tab content for the DesignMode activity sidebar. Renders
 * interactive `AskUserQuestion` cards (reusing the shared `InlineQuestionCard`)
 * surfaced from the active run, plus Studio-parity discovery affordances
 * (Fix-sync Phase 03): an auto-continue countdown that proceeds with defaults
 * when it expires, and a Skip-all action.
 */
export function DesignQuestionsPane({
  questions,
  streaming,
  onAnswer,
}: DesignQuestionsPaneProps) {
  const { t } = useLanguage();
  const [remaining, setRemaining] = useState(AUTO_CONTINUE_SECONDS);
  // Guard against double-submitting when the timer and a manual action race.
  const answeredRef = useRef(false);

  const hasQuestions = questions.length > 0 && !streaming;
  const defaultAnswers = useMemo(
    () => defaultQuestionAnswers(questions),
    [questions],
  );
  const canAutoContinue = defaultAnswers !== null;
  const questionSetKey = useMemo(() => JSON.stringify(questions), [questions]);

  const skipWithDefaults = () => {
    if (answeredRef.current || !defaultAnswers) return;
    answeredRef.current = true;
    onAnswer(formatDesignQuestionAnswers(defaultAnswers));
  };
  // Keep the latest skip handler in a ref so the timer never fires a stale
  // `onAnswer` (its identity changes when the parent's send state flips).
  const skipRef = useRef(skipWithDefaults);
  skipRef.current = skipWithDefaults;

  // Reset the countdown whenever a fresh question set arrives.
  useEffect(() => {
    answeredRef.current = false;
    setRemaining(AUTO_CONTINUE_SECONDS);
  }, [questionSetKey]);

  // Tick the auto-continue countdown while a question form is open. The tick
  // only decrements state — no side effects inside the updater (StrictMode
  // double-invokes updaters).
  useEffect(() => {
    if (!hasQuestions || !canAutoContinue) return;
    const id = setInterval(() => {
      setRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [canAutoContinue, hasQuestions, questionSetKey]);

  // Proceed with defaults once the countdown reaches zero — as an effect, not
  // a side effect buried in the tick updater.
  useEffect(() => {
    if (hasQuestions && canAutoContinue && remaining === 0) skipRef.current();
  }, [canAutoContinue, hasQuestions, remaining]);

  if (questions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        {streaming ? (
          <>
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
            <p className="text-muted-foreground text-sm">
              {t.design.questionsStreaming}
            </p>
          </>
        ) : (
          <>
            <MessageCircleQuestion className="text-muted-foreground size-5" />
            <p className="text-muted-foreground text-sm">
              {t.design.noQuestions}
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <InlineQuestionCard
          questions={questions}
          onSubmit={(answers) => {
            if (answeredRef.current) return;
            answeredRef.current = true;
            onAnswer(formatDesignQuestionAnswers(answers));
          }}
        />
      </div>
      {canAutoContinue ? (
        <div className="border-border flex items-center justify-between gap-2 border-t p-2">
          <span className="text-muted-foreground text-xs">
            {t.design.autoContinueLabel.replace(
              '{time}',
              formatCountdown(remaining),
            )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={skipWithDefaults}
          >
            {t.design.skipAll}
          </Button>
        </div>
      ) : (
        <p className="border-border text-muted-foreground border-t p-3 text-xs">
          {t.design.manualAnswerRequired}
        </p>
      )}
    </div>
  );
}
