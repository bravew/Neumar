import { useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { DailyUsage } from '@/shared/db/usage-api';
import { fetchDailyUsage, formatMicroCost } from '@/shared/db/usage-api';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { getTimeRangeStart, type TimeRange } from './UsageDateFilter';

interface UsageDailyChartProps {
  timeRange: TimeRange;
  source?: 'channel' | 'desktop';
}

type ChartMode = 'cost' | 'tokens' | 'requests';
type Granularity = 'daily' | 'monthly';

const CHART_MODES: ChartMode[] = ['cost', 'tokens', 'requests'];

interface ChartDataPoint {
  date: string;
  label: string;
  api: number;
  subscription: number;
  free: number;
  total: number;
  tokens: number;
  requests: number;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

function formatCostAxis(micro: number): string {
  const usd = micro / 1_000_000;
  if (usd < 0.01) return '$0';
  if (usd < 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(0)}`;
}

function formatTokenAxis(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

function aggregateByMonth(data: DailyUsage[]): ChartDataPoint[] {
  const byMonth: Record<string, ChartDataPoint> = {};
  for (const d of data) {
    const month = d.date.slice(0, 7); // "yyyy-mm"
    if (!byMonth[month]) {
      byMonth[month] = {
        date: month,
        label: formatMonthLabel(month),
        api: 0,
        subscription: 0,
        free: 0,
        total: 0,
        tokens: 0,
        requests: 0,
      };
    }
    byMonth[month].api += d.cost_api;
    byMonth[month].subscription += d.cost_subscription;
    byMonth[month].free += d.cost_free;
    byMonth[month].total += d.cost;
    byMonth[month].tokens += d.tokens;
    byMonth[month].requests += d.requests;
  }
  return Object.values(byMonth).sort((a, b) => a.date.localeCompare(b.date));
}

export function UsageDailyChart({ timeRange, source }: UsageDailyChartProps) {
  const { t } = useLanguage();
  const uid = useId();
  const [data, setData] = useState<DailyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ChartMode>('cost');
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const ac = new AbortController();
    setLoading(true);
    fetchDailyUsage({
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

  const dailyChartData = useMemo<ChartDataPoint[]>(
    () =>
      data.map((d) => ({
        date: d.date,
        label: formatDateLabel(d.date),
        api: d.cost_api,
        subscription: d.cost_subscription,
        free: d.cost_free,
        total: d.cost,
        tokens: d.tokens,
        requests: d.requests,
      })),
    [data],
  );

  const monthlyChartData = useMemo(() => aggregateByMonth(data), [data]);

  const chartData =
    granularity === 'monthly' ? monthlyChartData : dailyChartData;

  const modeLabels: Record<ChartMode, string> = {
    cost: t.settings.usageColCost,
    tokens: t.settings.usageColTokens,
    requests: t.settings.usageRequests,
  };

  const chartTitle =
    granularity === 'monthly'
      ? t.settings.usageMonthlyChart
      : t.settings.usageDailyChart;

  if (loading) {
    return (
      <div className="border-border bg-card animate-pulse rounded-lg border p-4">
        <div className="bg-muted h-[280px] rounded" />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <p className="text-muted-foreground py-8 text-center text-sm">
          {t.settings.usageNoLogs}
        </p>
      </div>
    );
  }

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      {/* Header: title, granularity toggle, mode toggle, export */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-sm font-medium">
          {chartTitle}
        </span>
        <div className="flex items-center gap-2">
          {/* Granularity toggle */}
          <div className="bg-muted flex gap-0.5 rounded-md p-0.5">
            <button
              onClick={() => setGranularity('daily')}
              className={cn(
                'rounded px-2.5 py-1 text-[11px] font-medium transition-all duration-200',
                granularity === 'daily'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.settings.usageGranularityDaily}
            </button>
            <button
              onClick={() => setGranularity('monthly')}
              className={cn(
                'rounded px-2.5 py-1 text-[11px] font-medium transition-all duration-200',
                granularity === 'monthly'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.settings.usageGranularityMonthly}
            </button>
          </div>

          {/* Mode toggle */}
          <div className="bg-muted flex gap-0.5 rounded-md p-0.5">
            {CHART_MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'rounded px-2.5 py-1 text-[11px] font-medium transition-all duration-200',
                  mode === m
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {modeLabels[m]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={280}>
        {mode === 'cost' ? (
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: 4, bottom: 0, left: -10 }}
          >
            <defs>
              <linearGradient id={`${uid}-costApi`} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-red-500, #ef4444)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-red-500, #ef4444)"
                  stopOpacity={0}
                />
              </linearGradient>
              <linearGradient id={`${uid}-costSub`} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-blue-500, #3b82f6)"
                  stopOpacity={0.2}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-blue-500, #3b82f6)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border, #e5e7eb)"
              opacity={0.5}
            />
            <XAxis
              dataKey="label"
              tick={{
                fontSize: 11,
                fill: 'var(--color-muted-foreground, #9ca3af)',
              }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={formatCostAxis}
              tick={{
                fontSize: 11,
                fill: 'var(--color-muted-foreground, #9ca3af)',
              }}
              tickLine={false}
              axisLine={false}
              width={50}
            />
            <Tooltip
              content={
                <CostTooltip
                  billingApiLabel={t.settings.usageBillingApi}
                  billingSubLabel={t.settings.usageBillingSubscription}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="api"
              stroke="#ef4444"
              strokeWidth={1.5}
              fill={`url(#${uid}-costApi)`}
              animationDuration={600}
              animationEasing="ease-out"
            />
            <Area
              type="monotone"
              dataKey="subscription"
              stroke="#3b82f6"
              strokeWidth={1.5}
              fill={`url(#${uid}-costSub)`}
              animationDuration={600}
              animationEasing="ease-out"
            />
          </AreaChart>
        ) : mode === 'tokens' ? (
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 4, bottom: 0, left: -10 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border, #e5e7eb)"
              opacity={0.5}
            />
            <XAxis
              dataKey="label"
              tick={{
                fontSize: 11,
                fill: 'var(--color-muted-foreground, #9ca3af)',
              }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={formatTokenAxis}
              tick={{
                fontSize: 11,
                fill: 'var(--color-muted-foreground, #9ca3af)',
              }}
              tickLine={false}
              axisLine={false}
              width={50}
            />
            <Tooltip
              content={
                <TokenTooltip tokensSuffix={t.settings.usageTokensSuffix} />
              }
            />
            <Bar
              dataKey="tokens"
              fill="#3b82f6"
              radius={[3, 3, 0, 0]}
              animationDuration={600}
              animationEasing="ease-out"
            />
          </BarChart>
        ) : (
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 4, bottom: 0, left: -10 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border, #e5e7eb)"
              opacity={0.5}
            />
            <XAxis
              dataKey="label"
              tick={{
                fontSize: 11,
                fill: 'var(--color-muted-foreground, #9ca3af)',
              }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{
                fontSize: 11,
                fill: 'var(--color-muted-foreground, #9ca3af)',
              }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              content={
                <RequestTooltip
                  requestsSuffix={t.settings.usageRequestsSuffix}
                />
              }
            />
            <Bar
              dataKey="requests"
              fill="#22c55e"
              radius={[3, 3, 0, 0]}
              animationDuration={600}
              animationEasing="ease-out"
            />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// Custom tooltips with macOS-style frosted glass look

interface TooltipPayloadItem {
  value: number;
  dataKey: string;
  color: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  billingApiLabel?: string;
  billingSubLabel?: string;
  tokensSuffix?: string;
  requestsSuffix?: string;
}

function CostTooltip({
  active,
  payload,
  label,
  billingApiLabel,
  billingSubLabel,
}: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const billingLabels: Record<string, string> = {
    api: billingApiLabel ?? 'API',
    subscription: billingSubLabel ?? 'Subscription',
  };
  return (
    <div className="border-border/50 bg-popover/95 rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm">
      <p className="text-foreground mb-1 text-xs font-medium">{label}</p>
      {payload.map((entry) => (
        <p
          key={entry.dataKey}
          className="text-xs"
          style={{ color: entry.color }}
        >
          {billingLabels[entry.dataKey] ?? entry.dataKey}:{' '}
          {formatMicroCost(entry.value)}
        </p>
      ))}
    </div>
  );
}

function TokenTooltip({
  active,
  payload,
  label,
  tokensSuffix,
}: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border-border/50 bg-popover/95 rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm">
      <p className="text-foreground mb-1 text-xs font-medium">{label}</p>
      <p className="text-xs text-blue-500">
        {formatTokenAxis(payload[0].value)} {tokensSuffix ?? 'tokens'}
      </p>
    </div>
  );
}

function RequestTooltip({
  active,
  payload,
  label,
  requestsSuffix,
}: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border-border/50 bg-popover/95 rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm">
      <p className="text-foreground mb-1 text-xs font-medium">{label}</p>
      <p className="text-xs text-green-500">
        {payload[0].value} {requestsSuffix ?? 'requests'}
      </p>
    </div>
  );
}
