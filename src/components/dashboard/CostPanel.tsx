import { useEffect, useState } from 'react';

import { Loader2 } from 'lucide-react';

import { formatCost } from '@/components/library/library-utils';
import { API_BASE_URL } from '@/config';
import { formatTokens } from '@/shared/db/usage-api';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  CostGroupBy,
  CostRollupResponse,
} from '@/shared/types/observability';

const RANGES: Array<{
  id: '7d' | '30d' | '90d';
  key: 'last7Days' | 'last30Days' | 'last90Days';
}> = [
  { id: '7d', key: 'last7Days' },
  { id: '30d', key: 'last30Days' },
  { id: '90d', key: 'last90Days' },
];

const GROUPS: Array<{
  id: CostGroupBy;
  key: 'costGroupProvider' | 'costGroupModel' | 'costGroupDay';
}> = [
  { id: 'provider', key: 'costGroupProvider' },
  { id: 'model', key: 'costGroupModel' },
  { id: 'day', key: 'costGroupDay' },
];

export function CostPanel() {
  const { t } = useLanguage();
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [groupBy, setGroupBy] = useState<CostGroupBy>('provider');
  const [data, setData] = useState<CostRollupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(
      `${API_BASE_URL}/observability/cost?range=${range}&group_by=${groupBy}`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<CostRollupResponse>;
      })
      .then((body) => setData(body))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load cost');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [range, groupBy]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {t.dashboard.costError}
      </p>
    );
  }

  if (!data || data.summary.calls === 0) {
    return (
      <div className="space-y-3">
        <RangeAndGroupControls
          range={range}
          setRange={setRange}
          groupBy={groupBy}
          setGroupBy={setGroupBy}
          t={t}
        />
        <p className="text-muted-foreground py-8 text-center text-sm">
          {t.dashboard.noData}
        </p>
      </div>
    );
  }

  const maxCost = Math.max(...data.groups.map((g) => g.costUsd), 0);

  return (
    <div className="space-y-3">
      <RangeAndGroupControls
        range={range}
        setRange={setRange}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
        t={t}
      />

      <div className="flex items-baseline gap-4">
        <div className="text-foreground text-xl font-semibold">
          {formatCost(data.summary.costUsd) ?? '$0'}
        </div>
        <div className="text-muted-foreground text-sm">
          {t.task.costTokens.replace(
            '{count}',
            formatTokens(data.summary.inputTokens + data.summary.outputTokens),
          )}
        </div>
        <div className="text-muted-foreground text-sm">
          {data.summary.calls} {t.dashboard.costCalls}
        </div>
      </div>

      <div className="text-muted-foreground/70 text-[10px]">
        {t.dashboard.costSource}: {data.source}
      </div>

      <div className="space-y-2">
        {data.groups.map((group) => {
          const pct = maxCost > 0 ? (group.costUsd / maxCost) * 100 : 0;
          return (
            <div key={group.key} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground truncate">{group.key}</span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {formatCost(group.costUsd) ?? '$0'} ·{' '}
                  {formatTokens(group.inputTokens + group.outputTokens)}t ·{' '}
                  {group.calls}
                </span>
              </div>
              <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RangeAndGroupControls({
  range,
  setRange,
  groupBy,
  setGroupBy,
  t,
}: {
  range: '7d' | '30d' | '90d';
  setRange: (r: '7d' | '30d' | '90d') => void;
  groupBy: CostGroupBy;
  setGroupBy: (g: CostGroupBy) => void;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <ToggleRow
        options={RANGES}
        value={range}
        onChange={setRange}
        labelFor={(opt) => t.dashboard[opt.key]}
      />
      <span className="text-muted-foreground/40">|</span>
      <ToggleRow
        options={GROUPS}
        value={groupBy}
        onChange={setGroupBy}
        labelFor={(opt) => t.dashboard[opt.key]}
      />
    </div>
  );
}

function ToggleRow<T extends { id: V }, V extends string>({
  options,
  value,
  onChange,
  labelFor,
}: {
  options: readonly T[];
  value: V;
  onChange: (next: V) => void;
  labelFor: (opt: T) => string;
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map((opt) => (
        <button
          key={opt.id}
          aria-label={labelFor(opt)}
          aria-pressed={value === opt.id}
          onClick={() => onChange(opt.id)}
          className={cn(
            'rounded px-2 py-0.5',
            value === opt.id
              ? 'text-foreground bg-accent'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {labelFor(opt)}
        </button>
      ))}
    </div>
  );
}
