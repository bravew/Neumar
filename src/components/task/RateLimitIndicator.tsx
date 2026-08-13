import { useEffect, useState } from 'react';

import { Clock } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface RateLimitIndicatorProps {
  retryAfterMs: number;
  onDismiss?: () => void;
}

export function RateLimitIndicator({
  retryAfterMs,
  onDismiss,
}: RateLimitIndicatorProps) {
  const { t } = useLanguage();
  const [remainingMs, setRemainingMs] = useState(retryAfterMs);

  useEffect(() => {
    if (remainingMs <= 0) {
      onDismiss?.();
      return;
    }

    const timer = setInterval(() => {
      setRemainingMs((prev) => {
        const next = prev - 1000;
        if (next <= 0) {
          onDismiss?.();
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [remainingMs, onDismiss]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  if (seconds <= 0) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-1.5',
        'animate-in fade-in text-amber-600 dark:text-amber-400',
      )}
    >
      <Clock className="size-3.5 animate-pulse" />
      <span className="text-xs">
        {t.settings.rateLimited} — {t.settings.retryingIn} {seconds}s
      </span>
    </div>
  );
}
