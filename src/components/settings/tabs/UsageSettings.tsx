import { useCallback, useEffect, useRef, useState } from 'react';

import { AlertTriangle, BarChart3, Info, Table, Trash2 } from 'lucide-react';

import type { UsageSummary } from '@/shared/db/usage-api';
import { clearUsageLogs, fetchUsageSummary } from '@/shared/db/usage-api';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { BudgetPolicies } from '../components/usage/BudgetPolicies';
import { UsageDailyChart } from '../components/usage/UsageDailyChart';
import {
  getTimeRangeStart,
  UsageDateFilter,
  type TimeRange,
} from '../components/usage/UsageDateFilter';
import { UsageModelChart } from '../components/usage/UsageModelChart';
import { UsageModelStats } from '../components/usage/UsageModelStats';
import { UsagePieCharts } from '../components/usage/UsagePieCharts';
import { UsageProviderStats } from '../components/usage/UsageProviderStats';
import { UsageRequestLog } from '../components/usage/UsageRequestLog';
import { UsageSummaryCards } from '../components/usage/UsageSummaryCards';
import { UsageToolStats } from '../components/usage/UsageToolStats';

type SubTab = 'logs' | 'providers' | 'models' | 'tools' | 'budget';
type ViewMode = 'chart' | 'table';
type SourceFilter = 'all' | 'desktop' | 'channel';

const SUB_TABS: SubTab[] = ['logs', 'providers', 'models', 'tools', 'budget'];

export function UsageSettings() {
  const { t } = useLanguage();
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [subTab, setSubTab] = useState<SubTab>('logs');
  const [viewMode, setViewMode] = useState<ViewMode>('chart');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const mountedRef = useRef(true);

  const subTabLabels: Record<SubTab, string> = {
    logs: t.settings.usageRequestLog,
    providers: t.settings.usageProviderStats,
    models: t.settings.usageModelStats,
    tools: t.settings.usageToolStats,
    budget: t.settings.budgetPolicies,
  };

  const loadSummary = useCallback(
    async (signal: AbortSignal) => {
      setSummaryLoading(true);
      try {
        const data = await fetchUsageSummary({
          start: getTimeRangeStart(timeRange),
          source: sourceFilter === 'all' ? undefined : sourceFilter,
          signal,
        });
        if (mountedRef.current) setSummary(data);
      } catch {
        // Aborted or failed
      } finally {
        if (mountedRef.current) setSummaryLoading(false);
      }
    },
    [timeRange, sourceFilter],
  );

  useEffect(() => {
    mountedRef.current = true;
    const ac = new AbortController();
    loadSummary(ac.signal);
    return () => {
      mountedRef.current = false;
      ac.abort();
    };
  }, [loadSummary]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearUsageLogs();
      setSummary(null);
      const ac = new AbortController();
      loadSummary(ac.signal);
    } catch {
      // ignore
    } finally {
      if (mountedRef.current) {
        setClearing(false);
        setShowClearConfirm(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Header row: description + controls */}
      <div className="flex items-center justify-between gap-4">
        <div />
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="bg-muted flex gap-0.5 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('chart')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200',
                viewMode === 'chart'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <BarChart3 className="size-3.5" />
              {t.settings.usageViewChart}
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200',
                viewMode === 'table'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Table className="size-3.5" />
              {t.settings.usageViewTable}
            </button>
          </div>

          {/* Source filter */}
          <div className="bg-muted flex gap-0.5 rounded-lg p-0.5">
            {(['all', 'desktop', 'channel'] as SourceFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-200',
                  sourceFilter === s
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s === 'all'
                  ? t.settings.usageSourceAll
                  : s === 'desktop'
                    ? t.settings.usageSourceDesktop
                    : t.settings.usageSourceChannels}
              </button>
            ))}
          </div>

          <UsageDateFilter value={timeRange} onChange={setTimeRange} />

          {/* Clear data button */}
          <button
            onClick={() => setShowClearConfirm(true)}
            className="border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors"
            title={t.settings.usageClearData}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Clear data confirmation */}
      {showClearConfirm && (
        <div className="border-destructive/30 bg-destructive/5 flex items-start gap-3 rounded-lg border p-4">
          <AlertTriangle className="text-destructive mt-0.5 size-4 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-foreground text-sm font-medium">
              {t.settings.usageClearData}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t.settings.usageClearConfirm}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleClear}
                disabled={clearing}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60"
              >
                {clearing ? '…' : t.settings.usageClearConfirmButton}
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                className="border-border bg-background hover:bg-muted rounded-md border px-3 py-1.5 text-xs"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <UsageSummaryCards summary={summary} loading={summaryLoading} />

      {/* Chart view */}
      {viewMode === 'chart' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <UsageDailyChart
              timeRange={timeRange}
              source={sourceFilter === 'all' ? undefined : sourceFilter}
            />
            <UsageModelChart
              timeRange={timeRange}
              source={sourceFilter === 'all' ? undefined : sourceFilter}
            />
          </div>
          <UsagePieCharts
            timeRange={timeRange}
            source={sourceFilter === 'all' ? undefined : sourceFilter}
          />
        </div>
      )}

      {/* Table view: sub-tabs + content */}
      {viewMode === 'table' && (
        <>
          <div className="border-border flex gap-0.5 border-b">
            {SUB_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setSubTab(tab)}
                className={cn(
                  'relative px-4 py-2.5 text-sm font-medium transition-all duration-200',
                  subTab === tab
                    ? 'text-foreground after:bg-foreground after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:rounded-full after:content-[""]'
                    : 'text-muted-foreground hover:text-foreground/70',
                )}
              >
                {subTabLabels[tab]}
              </button>
            ))}
          </div>

          {subTab === 'logs' && (
            <UsageRequestLog
              timeRange={timeRange}
              source={sourceFilter === 'all' ? undefined : sourceFilter}
            />
          )}
          {subTab === 'providers' && (
            <UsageProviderStats
              timeRange={timeRange}
              source={sourceFilter === 'all' ? undefined : sourceFilter}
            />
          )}
          {subTab === 'models' && (
            <UsageModelStats
              timeRange={timeRange}
              source={sourceFilter === 'all' ? undefined : sourceFilter}
            />
          )}
          {subTab === 'tools' && (
            <UsageToolStats
              timeRange={timeRange}
              source={sourceFilter === 'all' ? undefined : sourceFilter}
            />
          )}
          {subTab === 'budget' && <BudgetPolicies />}
        </>
      )}

      {/* Estimate disclaimer footer */}
      <div className="border-border/40 flex items-start gap-2 border-t pt-3">
        <Info className="text-muted-foreground mt-0.5 size-3 flex-shrink-0" />
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          {t.settings.usageEstimateDisclaimer}
        </p>
      </div>
    </div>
  );
}
