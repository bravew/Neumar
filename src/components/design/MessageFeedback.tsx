import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { ThumbsDown, ThumbsUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { postDesignMessageFeedback } from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';

type Rating = 'up' | 'down';

export function MessageFeedback({
  projectId,
  messageId,
  artifactRef,
  runId,
}: {
  projectId: string;
  messageId: string;
  artifactRef?: string;
  runId?: string;
}) {
  const { t } = useLanguage();
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (rating !== 'down') return;
    const reduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    textareaRef.current?.scrollIntoView?.({
      block: 'nearest',
      behavior: reduced ? 'auto' : 'smooth',
    });
  }, [rating]);
  const submit = async (nextRating: Rating, nextComment = '') => {
    await postDesignMessageFeedback(projectId, messageId, {
      rating: nextRating,
      comment: nextComment.trim() || undefined,
      submittedAt: new Date().toISOString(),
      artifactRef,
      runId,
    });
    setRating(nextRating);
    setSent(true);
  };

  if (sent && rating === 'up') {
    return (
      <FeedbackShell>
        <span>{t.design.feedbackThanks}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setSent(false)}
        >
          {t.design.feedbackChange}
        </Button>
      </FeedbackShell>
    );
  }

  if (rating === 'down') {
    return (
      <FeedbackShell>
        <span>
          {sent ? t.design.feedbackThanksNegative : t.design.feedbackTellMore}
        </span>
        <textarea
          ref={textareaRef}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t.design.feedbackCommentPlaceholder}
          className="border-input min-h-16 flex-1 rounded-md border p-2 text-sm"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void submit('down', comment)}
        >
          {t.design.feedbackSend}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setRating(null)}
        >
          {t.design.feedbackChange}
        </Button>
      </FeedbackShell>
    );
  }

  return (
    <FeedbackShell>
      <span>{t.design.feedbackPrompt}</span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={t.design.feedbackUp}
        onClick={() => void submit('up')}
      >
        <ThumbsUp className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={t.design.feedbackDown}
        onClick={() => {
          setComment('');
          setRating('down');
        }}
      >
        <ThumbsDown className="size-4" />
      </Button>
    </FeedbackShell>
  );
}

function FeedbackShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md p-2 text-xs">
      {children}
    </div>
  );
}
