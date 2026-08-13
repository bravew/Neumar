import { useEffect, useState } from 'react';

import { Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

interface MemoryStats {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  unit: string;
}

interface HealthResponse {
  status: string;
  timestamp: string;
  uptime: number;
  memory: MemoryStats;
}

// Memory health thresholds (MB)
const MEMORY_THRESHOLDS = {
  HEALTHY: 500,
  MODERATE: 1024,
  HIGH: 2048,
} as const;

// UI update interval (ms)
const REFRESH_INTERVAL = 10_000; // 10 seconds

// Percentage formatting
const PERCENTAGE_DECIMALS = 1;

export function MemoryUsage() {
  const { t, tt } = useLanguage();
  const [memory, setMemory] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // AbortController for proper cleanup (2026 React 19 best practice)
    const abortController = new AbortController();

    const fetchMemoryStats = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`, {
          signal: abortController.signal,
        });
        const data = (await response.json()) as HealthResponse;

        if (data.memory) {
          setMemory(data.memory);
          setError(false);
        }
      } catch (err) {
        // Ignore abort errors - they're intentional cleanup
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        if (import.meta.env.DEV)
          console.error('Failed to fetch memory stats:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    // Initial fetch
    fetchMemoryStats();

    // Refresh at configured interval
    const interval = setInterval(fetchMemoryStats, REFRESH_INTERVAL);

    // Cleanup: cancel in-flight requests and clear interval
    return () => {
      abortController.abort();
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="border-border bg-muted/20 flex items-center justify-center rounded-lg border p-6">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Activity className="size-4 animate-spin" />
          <span>{t.settings.processMemoryLoading}</span>
        </div>
      </div>
    );
  }

  if (error || !memory) {
    return (
      <div className="border-border bg-muted/20 flex items-center justify-center rounded-lg border p-6">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <AlertTriangle className="size-4" />
          <span>{t.settings.processMemoryError}</span>
        </div>
      </div>
    );
  }

  // Calculate memory health status based on RSS thresholds
  const getMemoryHealth = (rss: number) => {
    if (rss < MEMORY_THRESHOLDS.HEALTHY) {
      return {
        status: t.settings.processMemoryStatusHealthy,
        color: 'text-green-500',
        bg: 'bg-green-500/10',
      };
    }
    if (rss < MEMORY_THRESHOLDS.MODERATE) {
      return {
        status: t.settings.processMemoryStatusModerate,
        color: 'text-yellow-500',
        bg: 'bg-yellow-500/10',
      };
    }
    if (rss < MEMORY_THRESHOLDS.HIGH) {
      return {
        status: t.settings.processMemoryStatusHigh,
        color: 'text-orange-500',
        bg: 'bg-orange-500/10',
      };
    }
    return {
      status: t.settings.processMemoryStatusCritical,
      color: 'text-red-500',
      bg: 'bg-red-500/10',
    };
  };

  const health = getMemoryHealth(memory.rss);
  const heapUsagePercent = ((memory.heapUsed / memory.heapTotal) * 100).toFixed(
    PERCENTAGE_DECIMALS,
  );

  return (
    <div className="space-y-4">
      {/* Header with Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="text-muted-foreground size-5" />
          <h3 className="text-foreground font-semibold">
            {t.settings.processMemoryTitle}
          </h3>
        </div>
        <div
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${health.bg} ${health.color}`}
        >
          <CheckCircle2 className="size-3" />
          <span className="capitalize">{health.status}</span>
        </div>
      </div>

      {/* Memory Metrics Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* RSS Memory */}
        <div
          className="border-border bg-muted/20 rounded-lg border p-3"
          aria-label={`RSS memory: ${memory.rss} megabytes, ${health.status} status`}
        >
          <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wider uppercase">
            {t.settings.processMemoryRss}
          </p>
          <p className={`text-2xl font-bold ${health.color}`}>
            {memory.rss}
            <span className="text-muted-foreground ml-1 text-sm font-normal">
              {memory.unit}
            </span>
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t.settings.processMemoryRssDesc}
          </p>
        </div>

        {/* Heap Used */}
        <div
          className="border-border bg-muted/20 rounded-lg border p-3"
          aria-label={`Heap memory used: ${memory.heapUsed} of ${memory.heapTotal} megabytes, ${heapUsagePercent}% utilization`}
        >
          <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wider uppercase">
            {t.settings.processMemoryHeapUsed}
          </p>
          <p className="text-foreground text-2xl font-bold">
            {memory.heapUsed}
            <span className="text-muted-foreground ml-1 text-sm font-normal">
              {memory.unit}
            </span>
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {tt('settings.processMemoryHeapOf', {
              percent: heapUsagePercent,
              total: memory.heapTotal,
            })}
          </p>
        </div>

        {/* External Memory */}
        <div
          className="border-border bg-muted/20 rounded-lg border p-3"
          aria-label={`External memory: ${memory.external} megabytes`}
        >
          <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wider uppercase">
            {t.settings.processMemoryExternal}
          </p>
          <p className="text-foreground text-lg font-semibold">
            {memory.external}
            <span className="text-muted-foreground ml-1 text-xs font-normal">
              {memory.unit}
            </span>
          </p>
        </div>

        {/* Array Buffers */}
        <div
          className="border-border bg-muted/20 rounded-lg border p-3"
          aria-label={`Array buffers: ${memory.arrayBuffers} megabytes`}
        >
          <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wider uppercase">
            {t.settings.processMemoryArrayBuffers}
          </p>
          <p className="text-foreground text-lg font-semibold">
            {memory.arrayBuffers}
            <span className="text-muted-foreground ml-1 text-xs font-normal">
              {memory.unit}
            </span>
          </p>
        </div>
      </div>

      {/* Heap Usage Bar */}
      <div
        className="border-border bg-muted/20 rounded-lg border p-3"
        aria-label={`Heap usage progress: ${heapUsagePercent}% of total heap capacity`}
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="text-muted-foreground text-xs font-medium">
            {t.settings.processMemoryHeapUsage}
          </p>
          <p className="text-foreground text-xs font-semibold">
            {heapUsagePercent}%
          </p>
        </div>
        <div className="bg-muted h-2 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-all duration-300"
            style={{ width: `${heapUsagePercent}%` }}
            aria-hidden="true"
          />
        </div>
        <div className="text-muted-foreground mt-2 flex items-center justify-between text-xs">
          <span>
            {tt('settings.processMemoryUsed', { used: memory.heapUsed })}
          </span>
          <span>
            {tt('settings.processMemoryTotal', { total: memory.heapTotal })}
          </span>
        </div>
      </div>

      {/* Info */}
      <p className="text-muted-foreground text-xs leading-relaxed">
        {tt('settings.processMemoryInfo', {
          interval: REFRESH_INTERVAL / 1000,
          threshold: MEMORY_THRESHOLDS.HEALTHY,
        })}
      </p>
    </div>
  );
}
