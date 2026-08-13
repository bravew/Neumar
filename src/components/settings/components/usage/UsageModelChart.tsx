import { useEffect, useMemo, useRef, useState } from 'react';

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ModelSummary } from '@/shared/db/usage-api';
import {
  fetchUsageByModel,
  formatMicroCost,
  formatTokens,
  getEffectiveCost,
  isLocalProvider,
} from '@/shared/db/usage-api';
import { useLanguage } from '@/shared/providers/language-provider';

import { getTimeRangeStart, type TimeRange } from './UsageDateFilter';

interface UsageModelChartProps {
  timeRange: TimeRange;
  showLocal?: boolean;
  source?: 'channel' | 'desktop';
}

const MODEL_COLORS = [
  '#0ea5e9',
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#84cc16',
];

interface ChartModelItem {
  model: string;
  cost: number;
  tokens: number;
  requests: number;
  provider: string;
  fill: string;
}

function truncateModel(name: string): string {
  if (name.length <= 22) return name;
  return name.slice(0, 20) + '…';
}

export function UsageModelChart({
  timeRange,
  showLocal = false,
  source,
}: UsageModelChartProps) {
  const { t } = useLanguage();
  const [data, setData] = useState<ModelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const ac = new AbortController();
    setLoading(true);
    fetchUsageByModel({
      start: getTimeRangeStart(timeRange),
      source,
      signal: ac.signal,
    })
      .then((result) => {
        if (mountedRef.current) setData(result);
      })
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
      ac.abort();
    };
  }, [timeRange, source]);

  const chartData = useMemo<ChartModelItem[]>(() => {
    const source = showLocal
      ? data
      : data.filter((r) => !isLocalProvider(r.provider));
    const map = new Map<string, Omit<ChartModelItem, 'fill'>>();
    for (const row of source) {
      const existing = map.get(row.model);
      const effectiveCost = getEffectiveCost(row.cost, row.billing_type);
      if (existing) {
        existing.cost += effectiveCost;
        existing.tokens += row.tokens;
        existing.requests += row.requests;
      } else {
        map.set(row.model, {
          model: row.model,
          cost: effectiveCost,
          tokens: row.tokens,
          requests: row.requests,
          provider: row.provider,
        });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10)
      .map((item, i) => ({
        ...item,
        fill: MODEL_COLORS[i % MODEL_COLORS.length],
      }));
  }, [data, showLocal]);

  if (loading) {
    return (
      <div className="border-border bg-card animate-pulse rounded-lg border p-5">
        <div className="bg-muted h-[280px] rounded" />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="border-border bg-card rounded-lg border p-5">
        <p className="text-muted-foreground py-12 text-center text-sm">
          {t.settings.usageNoLogs}
        </p>
      </div>
    );
  }

  return (
    <div className="border-border bg-card rounded-lg border p-5">
      <span className="text-muted-foreground mb-4 block text-sm font-medium">
        {t.settings.usageModelBreakdown}
      </span>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
        >
          <XAxis
            type="number"
            tickFormatter={(v: number) => formatMicroCost(v)}
            tick={{
              fontSize: 11,
              fill: 'var(--color-muted-foreground, #9ca3af)',
            }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="model"
            tick={{
              fontSize: 11,
              fill: 'var(--color-muted-foreground, #9ca3af)',
            }}
            tickLine={false}
            axisLine={false}
            width={140}
            tickFormatter={truncateModel}
          />
          <Tooltip content={<ModelTooltip />} />
          <Bar
            dataKey="cost"
            radius={[0, 4, 4, 0]}
            animationDuration={600}
            animationEasing="ease-out"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TooltipPayloadItem {
  payload: ChartModelItem;
}

interface ModelTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}

function ModelTooltip({ active, payload }: ModelTooltipProps) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="border-border/50 bg-popover/95 rounded-lg border px-3 py-2.5 shadow-lg backdrop-blur-sm">
      <p className="text-foreground mb-1 text-sm font-medium">{item.model}</p>
      <p className="text-muted-foreground text-xs">{item.provider}</p>
      <div className="mt-1.5 space-y-0.5 text-xs">
        <p>Cost: {formatMicroCost(item.cost)}</p>
        <p>Tokens: {formatTokens(item.tokens)}</p>
        <p>Requests: {item.requests}</p>
      </div>
    </div>
  );
}
