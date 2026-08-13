import { useCallback, useEffect, useRef, useState } from 'react';

import { ChevronDown, ChevronUp } from 'lucide-react';

import type { ModelSummary } from '@/shared/db/usage-api';
import {
  fetchUsageByModel,
  formatMicroCost,
  formatTokens,
  getEffectiveCost,
  isLocalProvider,
} from '@/shared/db/usage-api';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { getTimeRangeStart, type TimeRange } from './UsageDateFilter';

interface UsageModelStatsProps {
  timeRange: TimeRange;
  showLocal?: boolean;
  source?: 'channel' | 'desktop';
}

type SortField = 'model' | 'provider' | 'requests' | 'tokens' | 'cost';
type SortDir = 'asc' | 'desc';

export function UsageModelStats({
  timeRange,
  showLocal = false,
  source,
}: UsageModelStatsProps) {
  const { t } = useLanguage();
  const [data, setData] = useState<ModelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('cost');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
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

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('desc');
      }
    },
    [sortField],
  );

  const visible = showLocal
    ? data
    : data.filter((d) => !isLocalProvider(d.provider));

  const sorted = [...visible].sort((a, b) => {
    const va = a[sortField as keyof ModelSummary];
    const vb = b[sortField as keyof ModelSummary];
    if (typeof va === 'string' && typeof vb === 'string') {
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return sortDir === 'asc'
      ? (va as number) - (vb as number)
      : (vb as number) - (va as number);
  });

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-border bg-muted/50 text-muted-foreground border-b text-left">
            <SortTh
              label={t.settings.usageColModel}
              field="model"
              sort={sortField}
              dir={sortDir}
              onSort={handleSort}
            />
            <SortTh
              label={t.settings.usageColProvider}
              field="provider"
              sort={sortField}
              dir={sortDir}
              onSort={handleSort}
            />
            <SortTh
              label={t.settings.usageRequests}
              field="requests"
              sort={sortField}
              dir={sortDir}
              onSort={handleSort}
              align="right"
            />
            <SortTh
              label={t.settings.usageColTokens}
              field="tokens"
              sort={sortField}
              dir={sortDir}
              onSort={handleSort}
              align="right"
            />
            <SortTh
              label={t.settings.usageColCost}
              field="cost"
              sort={sortField}
              dir={sortDir}
              onSort={handleSort}
              align="right"
            />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <tr key={i} className="border-border border-b">
                {Array.from({ length: 5 }).map((_, j) => (
                  <td key={j} className="px-3 py-2">
                    <div className="bg-muted h-3 w-12 animate-pulse rounded" />
                  </td>
                ))}
              </tr>
            ))
          ) : sorted.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="text-muted-foreground px-3 py-8 text-center"
              >
                {t.settings.usageNoLogs}
              </td>
            </tr>
          ) : (
            sorted.map((row, i) => (
              <tr
                key={i}
                className="border-border hover:bg-muted/30 border-b transition-colors duration-150"
              >
                <td className="px-3 py-2 font-mono">{row.model}</td>
                <td className="text-muted-foreground px-3 py-2">
                  {row.provider}
                </td>
                <td className="px-3 py-2 text-right">{row.requests}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatTokens(row.tokens)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatMicroCost(
                    getEffectiveCost(row.cost, row.billing_type),
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SortTh({
  label,
  field,
  sort,
  dir,
  onSort,
  align,
}: {
  label: string;
  field: SortField;
  sort: SortField;
  dir: SortDir;
  onSort: (f: SortField) => void;
  align?: 'right';
}) {
  const active = sort === field;
  return (
    <th
      className={cn(
        'hover:text-foreground cursor-pointer px-3 py-2 transition-colors select-none',
        align === 'right' && 'text-right',
      )}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active &&
          (dir === 'asc' ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          ))}
      </span>
    </th>
  );
}
