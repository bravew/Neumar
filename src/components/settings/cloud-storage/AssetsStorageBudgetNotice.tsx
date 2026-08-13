import { useEffect, useState } from 'react';

import { AlertTriangle, HardDrive } from 'lucide-react';

import { fetchAssetStorageStats } from '@/shared/assets/api';
import type { AssetStorageStats } from '@/shared/assets/types';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export function AssetsStorageBudgetNotice() {
  const { t } = useLanguage();
  const s = t.assets;
  const [stats, setStats] = useState<AssetStorageStats | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchAssetStorageStats({ signal: ctrl.signal })
      .then(setStats)
      .catch((error) => {
        if ((error as { name?: string }).name !== 'AbortError') {
          setStats(null);
        }
      });
    return () => ctrl.abort();
  }, []);

  if (!stats) return null;

  const percent =
    stats.budgetBytes > 0
      ? Math.round((stats.localBytes / stats.budgetBytes) * 100)
      : 0;
  const usage = s.storageBudgetUsage
    .replace('{used}', formatBytes(stats.localBytes))
    .replace('{budget}', formatBytes(stats.budgetBytes))
    .replace('{percent}', String(percent));
  const deleted =
    stats.deletedBytes > 0
      ? s.storageBudgetDeleted.replace(
          '{bytes}',
          formatBytes(stats.deletedBytes),
        )
      : null;

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border px-3 py-2 text-sm',
        stats.warning
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100'
          : 'border-border bg-muted/40 text-muted-foreground',
      )}
      aria-live="polite"
    >
      {stats.warning ? (
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      ) : (
        <HardDrive className="mt-0.5 size-4 shrink-0" />
      )}
      <div className="min-w-0 space-y-1">
        <p className="text-foreground font-medium">{s.storageBudgetTitle}</p>
        <p>{usage}</p>
        {stats.warning && <p>{s.storageBudgetWarning}</p>}
        {deleted && <p>{deleted}</p>}
      </div>
    </div>
  );
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
