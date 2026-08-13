import { Clock, Coins, Database, Hash, Zap } from 'lucide-react';

import { formatCost } from '@/components/library/library-utils';
/**
 * TraceMetricsSummary — Live-updating summary card for trace viewer.
 * Shows total duration, tokens, cost, and operation counts by type.
 */
import { formatTokens } from '@/shared/db/usage-api';
import type { TraceSummary } from '@/shared/hooks/useTraceStream';
import { useLanguage } from '@/shared/providers/language-provider';

interface TraceMetricsSummaryProps {
  summary: TraceSummary;
  isLive: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

export function TraceMetricsSummary({
  summary,
  isLive,
}: TraceMetricsSummaryProps) {
  const { t } = useLanguage();

  const hasCacheData =
    summary.totalTokens.cacheRead > 0 || summary.totalTokens.cacheCreation > 0;

  return (
    <div className="border-border/40 grid grid-cols-4 gap-3 border-b px-3 py-2">
      <MetricCard
        icon={<Clock className="size-3.5" />}
        label={t.task.traceTotalDuration}
        value={formatDuration(summary.totalDuration)}
        pulse={isLive}
      />
      <MetricCard
        icon={<Zap className="size-3.5" />}
        label={t.task.traceTotalTokens}
        value={`${formatTokens(summary.totalTokens.input)} / ${formatTokens(summary.totalTokens.output)}`}
      />
      <MetricCard
        icon={<Coins className="size-3.5" />}
        label={t.task.traceTotalCost}
        value={formatCost(summary.totalCost) ?? '$0'}
      />
      {hasCacheData ? (
        <MetricCard
          icon={<Database className="size-3.5" />}
          label={t.task.traceCache}
          value={`${formatTokens(summary.totalTokens.cacheRead)} read / ${formatTokens(summary.totalTokens.cacheCreation)} write`}
        />
      ) : (
        <MetricCard
          icon={<Hash className="size-3.5" />}
          label={t.task.traceOperations}
          value={String(summary.operationCount)}
        />
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  pulse,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  pulse?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-muted-foreground flex items-center gap-1 text-[10px]">
        {icon}
        {label}
        {pulse && (
          <span className="bg-primary/60 inline-block size-1.5 animate-pulse rounded-full" />
        )}
      </div>
      <span className="text-foreground text-xs font-medium">{value}</span>
    </div>
  );
}
