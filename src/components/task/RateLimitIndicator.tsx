import { useEffect, useState } from 'react';

import { Clock } from 'lucide-react';

import type { StreamRetry } from '@/shared/lib/stream-signals';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

/** Above this, show the reset clock time instead of a seconds countdown. */
const SHOW_CLOCK_AFTER_MS = 90_000;

interface RateLimitIndicatorProps {
  retry: StreamRetry;
  onDismiss?: () => void;
}

/**
 * Countdown for a rejected rate limit (until `resetsAt`) or an SDK API retry
 * (until the next attempt). Remount with a new `key` per signal.
 */
export function RateLimitIndicator({
  retry,
  onDismiss,
}: RateLimitIndicatorProps) {
  const { tt } = useLanguage();
  const [remainingMs, setRemainingMs] = useState(retry.retryAfterMs);

  useEffect(() => {
    if (remainingMs <= 0) {
      onDismiss?.();
      return;
    }

    const timer = setInterval(() => {
      setRemainingMs((prev) => Math.max(0, prev - 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [remainingMs, onDismiss]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  if (seconds <= 0) return null;

  let label: string;
  if (retry.kind === 'api_retry') {
    label = tt('task.streamSignalApiRetry', {
      attempt: retry.attempt,
      max: retry.maxRetries,
      seconds,
    });
  } else if (remainingMs > SHOW_CLOCK_AFTER_MS) {
    label = tt('task.streamSignalRateLimitResetsAt', {
      time: new Date(retry.until).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      }),
    });
  } else {
    label = tt('task.streamSignalRateLimitRetryingIn', { seconds });
  }

  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-1.5',
        'animate-in fade-in text-amber-600 dark:text-amber-400',
      )}
    >
      <Clock className="size-3.5 animate-pulse" />
      <span className="text-xs">{label}</span>
    </div>
  );
}
