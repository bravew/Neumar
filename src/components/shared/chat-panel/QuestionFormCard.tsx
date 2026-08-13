import { useCallback, useState } from 'react';

import { Check, MessageCircleQuestion, Send } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { ChatQuestion } from './types';

export interface QuestionFormCardProps {
  questions: ChatQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
  answered?: boolean;
  answerText?: string;
}

export function QuestionFormCard({
  questions,
  onSubmit,
  answered,
  answerText,
}: QuestionFormCardProps) {
  const { t } = useLanguage();
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [otherInputs, setOtherInputs] = useState<Record<number, string>>({});

  const handleOptionSelect = useCallback(
    (questionIndex: number, option: string, multiSelect: boolean) => {
      setAnswers((prev) => {
        const current = prev[questionIndex] || [];
        if (multiSelect) {
          return current.includes(option)
            ? {
                ...prev,
                [questionIndex]: current.filter((item) => item !== option),
              }
            : { ...prev, [questionIndex]: [...current, option] };
        }
        return { ...prev, [questionIndex]: [option] };
      });
    },
    [],
  );

  const handleOtherInput = useCallback(
    (questionIndex: number, value: string) => {
      setOtherInputs((prev) => ({ ...prev, [questionIndex]: value }));
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    const formatted: Record<string, string> = {};
    questions.forEach((question, index) => {
      const selected = answers[index] || [];
      const other = otherInputs[index];
      let answer = selected.join(', ');
      if (other) answer = answer ? `${answer}, ${other}` : other;
      if (answer) formatted[question.question] = answer;
    });
    onSubmit(formatted);
  }, [answers, onSubmit, otherInputs, questions]);

  const hasAnswers =
    Object.keys(answers).some((key) => answers[parseInt(key)]?.length > 0) ||
    Object.values(otherInputs).some((value) => value?.trim());

  if (answered) {
    return (
      <div className="border-border/40 bg-muted/20 my-2 rounded-lg border p-3">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <MessageCircleQuestion className="size-3.5" />
          <span>{t.task.answeredQuestion}</span>
        </div>
        {answerText ? (
          <p className="text-foreground mt-1 text-sm">{answerText}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="border-primary/30 bg-accent/30 my-2 space-y-4 rounded-xl border p-4">
      <div className="text-foreground flex items-center gap-2 text-sm font-medium">
        <span className="bg-primary size-2 animate-pulse rounded-full" />
        {t.common.questionInput.needsInput}
      </div>

      {questions.map((question, questionIndex) => (
        <QuestionItem
          key={`q-${question.question.slice(0, 50)}`}
          question={question}
          selectedOptions={answers[questionIndex] || []}
          otherInput={otherInputs[questionIndex] || ''}
          onSelectOption={(option) =>
            handleOptionSelect(questionIndex, option, question.multiSelect)
          }
          onOtherInput={(value) => handleOtherInput(questionIndex, value)}
          t={t}
        />
      ))}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!hasAnswers}
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            hasAnswers
              ? 'bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          <Send className="size-4" />
          {t.common.questionInput.submit}
        </button>
      </div>
    </div>
  );
}

function QuestionItem({
  question,
  selectedOptions,
  otherInput,
  onSelectOption,
  onOtherInput,
  t,
}: {
  question: ChatQuestion;
  selectedOptions: string[];
  otherInput: string;
  onSelectOption: (option: string) => void;
  onOtherInput: (value: string) => void;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  const [showOther, setShowOther] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground bg-muted rounded px-2 py-0.5 text-xs font-medium">
          {question.header}
        </span>
        <p className="text-foreground flex-1 text-sm">{question.question}</p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {question.options.map((option) => {
          const isSelected = selectedOptions.includes(option.label);
          return (
            <button
              type="button"
              key={option.label}
              onClick={() => onSelectOption(option.label)}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-all',
                isSelected
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border/60 bg-background hover:border-primary/50 hover:bg-accent/50 text-foreground',
              )}
            >
              <div
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center border-2',
                  question.multiSelect ? 'rounded-md' : 'rounded-full',
                  isSelected
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground/40',
                )}
              >
                {isSelected ? (
                  <Check className="text-primary-foreground size-3" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{option.label}</p>
                {option.description ? (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {option.description}
                  </p>
                ) : null}
              </div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setShowOther(!showOther)}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-all',
            showOther || otherInput
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border/60 bg-background hover:border-primary/50 hover:bg-accent/50 text-foreground',
          )}
        >
          <div
            className={cn(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center border-2',
              question.multiSelect ? 'rounded-md' : 'rounded-full',
              showOther || otherInput
                ? 'border-primary bg-primary'
                : 'border-muted-foreground/40',
            )}
          >
            {showOther || otherInput ? (
              <Check className="text-primary-foreground size-3" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {t.common.questionInput.other}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t.common.questionInput.customInput}
            </p>
          </div>
        </button>
      </div>

      {showOther ? (
        <input
          type="text"
          value={otherInput}
          onChange={(event) => onOtherInput(event.target.value)}
          placeholder={t.common.questionInput.placeholder}
          className="border-border/60 bg-background text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary/30 w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
        />
      ) : null}
    </div>
  );
}
