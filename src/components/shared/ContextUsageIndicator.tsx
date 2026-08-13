import { useMemo } from 'react';

import { useContextUsage } from '@/shared/hooks/useContextUsage';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface ContextUsageIndicatorProps {
  taskId: string;
  model?: string;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

export function ContextUsageIndicator({
  taskId,
  model,
}: ContextUsageIndicatorProps) {
  const { t } = useLanguage();
  const { used, total, percentage, cost, loading } = useContextUsage(
    taskId,
    model,
  );

  const colorClass = useMemo(() => {
    if (percentage > 90) return 'bg-red-500';
    if (percentage > 75) return 'bg-orange-500';
    if (percentage > 50) return 'bg-yellow-500';
    return 'bg-green-500';
  }, [percentage]);

  const textColorClass = useMemo(() => {
    if (percentage > 90) return 'text-red-500';
    if (percentage > 75) return 'text-orange-500';
    if (percentage > 50) return 'text-yellow-500';
    return 'text-muted-foreground';
  }, [percentage]);

  if (loading || used === 0) return null;

  const remaining = Math.max(total - used, 0);

  return (
    <div className="group relative flex items-center gap-2">
      {/* Compact bar */}
      <div className="bg-muted h-1.5 w-20 overflow-hidden rounded-full">
        <div
          className={cn('h-full rounded-full transition-all', colorClass)}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <span className={cn('text-xs tabular-nums', textColorClass)}>
        {Math.round(percentage)}%
      </span>

      {/* Hover tooltip */}
      <div className="bg-popover border-border pointer-events-none absolute bottom-full left-0 z-50 mb-2 w-56 rounded-lg border p-3 opacity-0 shadow-md transition-opacity group-hover:opacity-100">
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t.task.contextLabel}</span>
            <span className="text-foreground font-medium">
              {formatTokens(used)} / {formatTokens(total)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {t.task.contextRemaining}
            </span>
            <span className="text-foreground">
              {t.task.contextTokens.replace('{count}', formatTokens(remaining))}
            </span>
          </div>
          {cost > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t.task.contextCost}
              </span>
              <span className="text-foreground">
                ${cost < 0.01 ? '<0.01' : cost.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
