import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Activity, Cpu, Database, HardDrive, RefreshCw } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

import { VideoSettingsShell } from './VideoSettingsShell';

interface MemoryBudgetStatus {
  rssMb: number;
  rssBudgetMb: number;
  underPressure: boolean;
  lastEvictionAt: string | null;
  evictionCount: number;
  activeFfmpegRenders: number;
  queuedFfmpegRenders: number;
  budgets: {
    embedderLruBytes: number;
    renderCacheBytes: number;
    renderCacheIndexBytes: number;
    wavePeakBytes: number;
    ffmpegMaxConcurrentRenders: number;
  };
}

interface AssetStorageStatus {
  managedBytes: number;
  cacheBytes: number;
  materializedBytes: number;
  proxyBytes: number;
  previewArtifactBytes: number;
}

interface HealthResponse {
  resources?: {
    assetStorage?: AssetStorageStatus | null;
    memoryBudget?: MemoryBudgetStatus;
  };
}

export function VideoMemorySettingsPage() {
  const { t } = useLanguage();
  const labels = t.video.settings.memory;
  const [status, setStatus] = useState<MemoryBudgetStatus | null>(null);
  const [assetStorage, setAssetStorage] = useState<AssetStorageStatus | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/health`, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as HealthResponse;
      if (!signal?.aborted) {
        setStatus(data.resources?.memoryBudget ?? null);
        setAssetStorage(data.resources?.assetStorage ?? null);
        setError(false);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const refreshWithController = useCallback(() => {
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    void refresh(controller.signal);
  }, [refresh]);

  useEffect(() => {
    refreshWithController();
    return () => {
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
    };
  }, [refreshWithController]);

  return (
    <VideoSettingsShell title={labels.title} description={labels.description}>
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground text-xs">
            {loading
              ? labels.loading
              : error || !status
                ? labels.error
                : status.underPressure
                  ? labels.pressure
                  : labels.normal}
          </div>
          <button
            type="button"
            className="border-border hover:bg-accent flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
            onClick={refreshWithController}
          >
            <RefreshCw className="size-3.5" />
            {labels.refresh}
          </button>
        </div>

        {status && (
          <>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Metric
                icon={<Activity className="size-4" />}
                label={labels.rss}
                value={`${status.rssMb} / ${status.rssBudgetMb} MB`}
              />
              <Metric
                icon={<Cpu className="size-4" />}
                label={labels.ffmpeg}
                value={`${status.activeFfmpegRenders} / ${status.budgets.ffmpegMaxConcurrentRenders}`}
                detail={labels.queued.replace(
                  '{count}',
                  String(status.queuedFfmpegRenders),
                )}
              />
              <Metric
                icon={<HardDrive className="size-4" />}
                label={labels.evictions}
                value={String(status.evictionCount)}
                detail={
                  status.lastEvictionAt
                    ? new Date(status.lastEvictionAt).toLocaleString()
                    : labels.none
                }
              />
              {assetStorage && (
                <Metric
                  icon={<Database className="size-4" />}
                  label={labels.assetStorage}
                  value={formatBytes(assetStorage.managedBytes)}
                  detail={labels.assetStorageDetail
                    .replace('{cache}', formatBytes(assetStorage.cacheBytes))
                    .replace(
                      '{copies}',
                      formatBytes(assetStorage.materializedBytes),
                    )}
                />
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Metric
                label={labels.renderCache}
                value={`${bytesToMb(status.budgets.renderCacheBytes)} MB`}
                detail={labels.renderCacheDetail}
              />
              <Metric
                label={labels.indexCache}
                value={`${bytesToMb(status.budgets.renderCacheIndexBytes)} MB`}
                detail={labels.indexCacheDetail}
              />
              <Metric
                label={labels.embedder}
                value={`${bytesToMb(status.budgets.embedderLruBytes)} MB`}
              />
              <Metric
                label={labels.wavePeaks}
                value={`${bytesToMb(status.budgets.wavePeakBytes)} MB`}
              />
            </div>
          </>
        )}
      </div>
    </VideoSettingsShell>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="border-border bg-muted/20 rounded-lg border p-4">
      <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-foreground text-xl font-semibold">{value}</div>
      {detail && (
        <div className="text-muted-foreground mt-1 text-xs">{detail}</div>
      )}
    </div>
  );
}

function bytesToMb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
