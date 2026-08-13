import { CheckCircle2, CircleAlert, Clock, Loader2 } from 'lucide-react';

import type { PublishLeg } from '@/shared/hooks/usePublishJobs';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

const TERMINAL_STATES = new Set(['published', 'failed', 'canceled']);

export function PerLegProgress({ leg }: { leg: PublishLeg }) {
  const { t } = useLanguage();
  const p = t.publish as Record<string, string>;
  const total = leg.totalBytes ?? 0;
  const percent =
    total > 0 ? Math.min(100, (leg.chunkOffsetBytes / total) * 100) : 0;
  const Icon =
    leg.state === 'published'
      ? CheckCircle2
      : leg.state === 'failed' || leg.state === 'canceled'
        ? CircleAlert
        : leg.approvalRequired && !leg.approvedAt
          ? Clock
          : Loader2;

  return (
    <div className="space-y-2" data-testid={`publish-leg-${leg.id}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {leg.destinationLabel ?? leg.destinationKind}
          </div>
          {leg.errorMessage && (
            <div className="text-destructive truncate text-xs">
              {leg.errorMessage}
            </div>
          )}
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs',
            leg.state === 'published'
              ? 'border-emerald-500/30 text-emerald-600'
              : leg.state === 'failed' || leg.state === 'canceled'
                ? 'border-destructive/30 text-destructive'
                : 'text-muted-foreground',
          )}
        >
          <Icon
            className={cn(
              'size-3.5',
              !TERMINAL_STATES.has(leg.state) &&
                !(leg.approvalRequired && !leg.approvedAt) &&
                'animate-spin',
            )}
          />
          {p[`state_${leg.state}`] ?? leg.state}
        </span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded">
        <div
          className="bg-primary h-full transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
