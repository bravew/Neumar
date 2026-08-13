import { useEffect, useMemo, useRef, useState } from 'react';

import { Cell, Pie, PieChart, Tooltip } from 'recharts';

import type {
  BillingType,
  CallTypeSummary,
  ModelSummary,
  ProviderSummary,
} from '@/shared/db/usage-api';
import {
  fetchUsageByCallType,
  fetchUsageByModel,
  fetchUsageByProvider,
  formatMicroCost,
  formatTokens,
  getEffectiveCost,
  isLocalProvider,
} from '@/shared/db/usage-api';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { getTimeRangeStart, type TimeRange } from './UsageDateFilter';

interface UsagePieChartsProps {
  timeRange: TimeRange;
  showLocal?: boolean;
  source?: 'channel' | 'desktop';
}

type PieMetric = 'cost' | 'tokens' | 'requests';

interface PieSlice {
  name: string;
  value: number;
  fill: string;
}

const PIE_COLORS = [
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
  '#06b6d4',
  '#a855f7',
];

const BILLING_COLORS: Record<BillingType, string> = {
  api: '#f59e0b',
  subscription: '#3b82f6',
  free: '#22c55e',
};

function formatPieValue(value: number, metric: PieMetric): string {
  if (metric === 'cost') return formatMicroCost(value);
  if (metric === 'tokens') return formatTokens(value);
  return String(value);
}

// ─── Donut chart + legend card ────────────────────────────────────────────────

interface PieCardProps {
  title: string;
  slices: PieSlice[];
  metric: PieMetric;
  loading: boolean;
  noDataText: string;
}

function PieCard({ title, slices, metric, loading, noDataText }: PieCardProps) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  const hasData = slices.length > 0 && total > 0;

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <h3 className="text-muted-foreground mb-3 text-sm font-medium">
        {title}
      </h3>
      {loading ? (
        <div className="bg-muted h-[180px] animate-pulse rounded" />
      ) : !hasData ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          {noDataText}
        </p>
      ) : (
        <div className="flex items-start gap-3">
          {/* Donut chart */}
          <div className="flex-shrink-0">
            <PieChart width={148} height={148}>
              <Pie
                data={slices}
                cx={70}
                cy={70}
                innerRadius={42}
                outerRadius={66}
                dataKey="value"
                paddingAngle={slices.length > 1 ? 2 : 0}
                strokeWidth={0}
              >
                {slices.map((s, i) => (
                  <Cell key={i} fill={s.fill} />
                ))}
              </Pie>
              <Tooltip content={<PieTooltip metric={metric} total={total} />} />
            </PieChart>
          </div>

          {/* Legend table */}
          <div className="min-w-0 flex-1 space-y-1 pt-1">
            {slices.map((s, i) => {
              const pct = total > 0 ? (s.value / total) * 100 : 0;
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ background: s.fill }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px]">
                    {s.name}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums">
                    {formatPieValue(s.value, metric)}
                  </span>
                  <span className="text-muted-foreground w-10 text-right text-[11px] tabular-nums">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

interface PieTooltipPayload {
  name: string;
  value: number;
  payload: PieSlice;
}

function PieTooltip({
  active,
  payload,
  metric,
  total,
}: {
  active?: boolean;
  payload?: PieTooltipPayload[];
  metric: PieMetric;
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0';
  return (
    <div className="border-border/50 bg-popover/95 rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm">
      <p className="text-foreground mb-0.5 text-xs font-medium">{item.name}</p>
      <p className="text-xs" style={{ color: item.payload.fill }}>
        {formatPieValue(item.value, metric)} · {pct}%
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function UsagePieCharts({
  timeRange,
  showLocal = false,
  source,
}: UsagePieChartsProps) {
  const { t } = useLanguage();
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [callTypes, setCallTypes] = useState<CallTypeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<PieMetric>('cost');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const ac = new AbortController();
    setLoading(true);
    const start = getTimeRangeStart(timeRange);
    Promise.all([
      fetchUsageByModel({ start, source, signal: ac.signal }),
      fetchUsageByProvider({ start, source, signal: ac.signal }),
      fetchUsageByCallType({ start, source, signal: ac.signal }),
    ])
      .then(([m, p, c]) => {
        if (mountedRef.current) {
          setModels(m);
          setProviders(p);
          setCallTypes(c);
        }
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

  // ─── Slice builders ─────────────────────────────────────────────────────────

  const modelSlices = useMemo<PieSlice[]>(() => {
    const source = showLocal
      ? models
      : models.filter((r) => !isLocalProvider(r.provider));
    const map = new Map<
      string,
      { value: number; tokens: number; requests: number }
    >();
    for (const row of source) {
      const cost = getEffectiveCost(row.cost, row.billing_type);
      const key = row.model;
      const cur = map.get(key);
      if (cur) {
        cur.value +=
          metric === 'cost'
            ? cost
            : metric === 'tokens'
              ? row.tokens
              : row.requests;
        cur.tokens += row.tokens;
        cur.requests += row.requests;
      } else {
        map.set(key, {
          value:
            metric === 'cost'
              ? cost
              : metric === 'tokens'
                ? row.tokens
                : row.requests,
          tokens: row.tokens,
          requests: row.requests,
        });
      }
    }
    return Array.from(map.entries())
      .map(([name, d], i) => ({
        name,
        value: d.value,
        fill: PIE_COLORS[i % PIE_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [models, metric, showLocal]);

  const providerSlices = useMemo<PieSlice[]>(() => {
    const source = showLocal
      ? providers
      : providers.filter((r) => !isLocalProvider(r.provider));
    const map = new Map<string, number>();
    for (const row of source) {
      const cost = getEffectiveCost(row.cost, row.billing_type);
      const val =
        metric === 'cost'
          ? cost
          : metric === 'tokens'
            ? row.tokens
            : row.requests;
      map.set(row.provider, (map.get(row.provider) ?? 0) + val);
    }
    return Array.from(map.entries())
      .map(([name, value], i) => ({
        name,
        value,
        fill: PIE_COLORS[i % PIE_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [providers, metric, showLocal]);

  const billingSlices = useMemo<PieSlice[]>(() => {
    const source = showLocal
      ? providers
      : providers.filter((r) => !isLocalProvider(r.provider));
    const map = new Map<BillingType, number>();
    for (const row of source) {
      const cost = getEffectiveCost(row.cost, row.billing_type);
      const val =
        metric === 'cost'
          ? cost
          : metric === 'tokens'
            ? row.tokens
            : row.requests;
      map.set(row.billing_type, (map.get(row.billing_type) ?? 0) + val);
    }
    return Array.from(map.entries()).map(([name, value]) => ({
      name,
      value,
      fill: BILLING_COLORS[name] ?? PIE_COLORS[0],
    }));
  }, [providers, metric, showLocal]);

  const callTypeSlices = useMemo<PieSlice[]>(() => {
    const sorted = [...callTypes].sort((a, b) => {
      const va =
        metric === 'cost'
          ? getEffectiveCost(a.cost, 'api')
          : metric === 'tokens'
            ? a.tokens
            : a.requests;
      const vb =
        metric === 'cost'
          ? getEffectiveCost(b.cost, 'api')
          : metric === 'tokens'
            ? b.tokens
            : b.requests;
      return vb - va;
    });
    return sorted.map((row, i) => ({
      name: row.call_type,
      value:
        metric === 'cost'
          ? getEffectiveCost(row.cost, 'api')
          : metric === 'tokens'
            ? row.tokens
            : row.requests,
      fill: PIE_COLORS[i % PIE_COLORS.length],
    }));
  }, [callTypes, metric]);

  const metricLabels: Record<PieMetric, string> = {
    cost: t.settings.usageColCost,
    tokens: t.settings.usageColTokens,
    requests: t.settings.usageRequests,
  };

  const isAllSubscription =
    metric === 'cost' && !loading && modelSlices.every((s) => s.value === 0);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t.settings.usagePieCharts}</span>
        <div className="flex items-center gap-2">
          {isAllSubscription && (
            <span className="text-muted-foreground text-[11px]">
              {t.settings.usageSubscriptionZeroNote}
            </span>
          )}
          <div className="bg-muted flex gap-0.5 rounded-md p-0.5">
            {(['cost', 'tokens', 'requests'] as PieMetric[]).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={cn(
                  'rounded px-2.5 py-1 text-[11px] font-medium transition-all duration-200',
                  metric === m
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {metricLabels[m]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2×2 grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PieCard
          title={t.settings.usagePieByModel}
          slices={modelSlices}
          metric={metric}
          loading={loading}
          noDataText={t.settings.usageNoLogs}
        />
        <PieCard
          title={t.settings.usagePieByProvider}
          slices={providerSlices}
          metric={metric}
          loading={loading}
          noDataText={t.settings.usageNoLogs}
        />
        <PieCard
          title={t.settings.usagePieByBilling}
          slices={billingSlices}
          metric={metric}
          loading={loading}
          noDataText={t.settings.usageNoLogs}
        />
        <PieCard
          title={t.settings.usagePieByCallType}
          slices={callTypeSlices}
          metric={metric}
          loading={loading}
          noDataText={t.settings.usageNoLogs}
        />
      </div>
    </div>
  );
}
