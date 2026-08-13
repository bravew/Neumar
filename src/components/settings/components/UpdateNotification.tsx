import { ArrowDownToLine, RefreshCw, RotateCcw, X } from 'lucide-react';

import { useAppUpdater } from '@/shared/hooks/useAppUpdater';
import { useLanguage } from '@/shared/providers/language-provider';

function ProgressBar({
  downloaded,
  total,
}: {
  downloaded: number;
  total: number | null;
}) {
  const pct = total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full transition-all duration-300"
          style={{ width: `${total ? pct : 100}%` }}
        />
      </div>
      {total ? (
        <span className="text-muted-foreground text-xs tabular-nums">
          {pct}%
        </span>
      ) : null}
    </div>
  );
}

const STATUS_ICON: Record<string, typeof ArrowDownToLine> = {
  available: ArrowDownToLine,
  downloading: RefreshCw,
  ready: RotateCcw,
  error: X,
};

export function UpdateNotification() {
  const { t } = useLanguage();
  const {
    status,
    updateInfo,
    progress,
    error,
    downloadAndInstall,
    restartApp,
    dismissUpdate,
  } = useAppUpdater();

  const isUpdateError = status === 'error' && updateInfo !== null;
  // Only render for actionable states
  if (!['available', 'downloading', 'ready'].includes(status) && !isUpdateError)
    return null;

  const Icon = STATUS_ICON[status] ?? ArrowDownToLine;
  const isDownloading = status === 'downloading';
  const isReady = status === 'ready';
  const isError = isUpdateError;

  return (
    <div className="border-border bg-card/95 fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2 rounded-lg border p-3 shadow-lg backdrop-blur-sm">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon
            className={`text-primary size-4 shrink-0 ${isDownloading ? 'animate-spin' : ''}`}
          />
          <div className="text-sm font-medium">
            {isReady
              ? t.settings.readyToRestart
              : isError
                ? t.settings.checkFailed
                : (t.settings.updateAvailable?.replace(
                    '{version}',
                    updateInfo?.version ?? '',
                  ) ?? `Update available: ${updateInfo?.version}`)}
          </div>
        </div>
        {!isDownloading && !isReady && (
          <button
            onClick={dismissUpdate}
            className="text-muted-foreground hover:text-foreground -mt-0.5 cursor-pointer rounded p-0.5 transition-colors"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Progress bar */}
      {isDownloading && (
        <ProgressBar downloaded={progress.downloaded} total={progress.total} />
      )}

      {/* Error */}
      {error && <p className="text-destructive text-xs">{error}</p>}

      {/* Action button */}
      <div className="flex justify-end">
        {status === 'available' && (
          <button
            onClick={downloadAndInstall}
            className="bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors"
          >
            {t.settings.downloadNewVersion}
          </button>
        )}
        {isError && (
          <button
            onClick={downloadAndInstall}
            className="bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors"
          >
            {t.settings.downloadNewVersion}
          </button>
        )}
        {isReady && (
          <button
            onClick={restartApp}
            className="bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors"
          >
            {t.settings.restartNow}
          </button>
        )}
      </div>
    </div>
  );
}
