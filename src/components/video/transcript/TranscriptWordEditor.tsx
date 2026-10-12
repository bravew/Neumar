import { useRef } from 'react';

import { cn } from '@/shared/lib/utils';

/** Returns the corrected word, or null when the edit should be discarded. */
export function normalizeCorrection(
  original: string,
  next: string,
): string | null {
  const text = next.trim();
  if (!text || /\s/.test(text) || text === original) return null;
  return text;
}

/**
 * Inline editor for one transcript word. Enter or blur saves, Escape cancels.
 * Text only: the word keeps its timing, so media is never touched.
 */
export function TranscriptWordEditor({
  word,
  ariaLabel,
  onCommit,
  onCancel,
}: {
  word: string;
  ariaLabel: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    if (value === null) onCancel();
    else onCommit(value);
  };
  return (
    <input
      autoFocus
      defaultValue={word}
      aria-label={ariaLabel}
      size={Math.max(2, word.length)}
      className={cn(
        'border-primary bg-background text-foreground mr-0.5 inline rounded border px-0.5 text-xs outline-none',
      )}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(normalizeCorrection(word, event.currentTarget.value));
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(null);
        }
      }}
      onBlur={(event) =>
        finish(normalizeCorrection(word, event.currentTarget.value))
      }
    />
  );
}
