import { useEffect, useState } from 'react';

import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  ArrowDownToLine,
  Check,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';

import ImageLogo from '@/assets/logo.png';
import { APP_NAME } from '@/config';
import { branding } from '@/config/branding';
import { useAppUpdater } from '@/shared/hooks/useAppUpdater';
import { useLanguage } from '@/shared/providers/language-provider';

import { MemoryUsage } from '../components/MemoryUsage';

const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;

// Helper function to open external URLs
const openExternalUrl = async (url: string) => {
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
};

function UpdateButton() {
  const { t } = useLanguage();
  const {
    status,
    updateInfo,
    progress,
    error,
    checkForUpdate,
    downloadAndInstall,
    restartApp,
  } = useAppUpdater();

  if (!isTauri) {
    return (
      <button
        onClick={() =>
          openExternalUrl(
            `${branding.urls.download}?utm_source=${branding.slug}_desktop`,
          )
        }
        className="bg-primary text-primary-foreground hover:bg-primary/90 flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
      >
        <Download className="size-4" />
        {t.settings.downloadNewVersion}
      </button>
    );
  }

  if (status === 'ready') {
    return (
      <button
        onClick={restartApp}
        className="flex cursor-pointer items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
      >
        <RotateCcw className="size-4" />
        {t.settings.restartNow}
      </button>
    );
  }

  if (status === 'downloading') {
    const pct = progress.total
      ? Math.round((progress.downloaded / progress.total) * 100)
      : null;
    return (
      <button
        disabled
        className="text-muted-foreground flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium"
      >
        <RefreshCw className="size-4 animate-spin" />
        {t.settings.downloading}
        {pct !== null ? ` ${pct}%` : ''}
      </button>
    );
  }

  if (status === 'available') {
    return (
      <button
        onClick={downloadAndInstall}
        className="bg-primary text-primary-foreground hover:bg-primary/90 flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
      >
        <ArrowDownToLine className="size-4" />
        {t.settings.updateAvailable?.replace(
          '{version}',
          updateInfo?.version ?? '',
        ) ?? `Update: ${updateInfo?.version}`}
      </button>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-2">
          <button
            onClick={checkForUpdate}
            aria-label="Retry update check"
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <X className="size-4" />
            {t.settings.checkFailed}
          </button>
          {error && (
            <span className="text-destructive max-w-48 truncate text-xs">
              {error}
            </span>
          )}
        </div>
        <button
          onClick={() =>
            openExternalUrl(
              `${branding.urls.download}?utm_source=${branding.slug}_desktop`,
            )
          }
          aria-label="Download latest version"
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-xs underline transition-colors"
        >
          <Download className="size-3" />
          {t.settings.downloadNewVersion}
        </button>
      </div>
    );
  }

  if (status === 'checking') {
    return (
      <button
        disabled
        className="text-muted-foreground flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium"
      >
        <Loader2 className="size-4 animate-spin" />
        {t.settings.checkingForUpdates}
      </button>
    );
  }

  // idle
  return (
    <button
      onClick={checkForUpdate}
      aria-label="Check for updates"
      className="bg-primary text-primary-foreground hover:bg-primary/90 flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
    >
      <Check className="size-4" />
      {t.settings.upToDate}
    </button>
  );
}

export function AboutSettings() {
  const { t } = useLanguage();
  const [version, setVersion] = useState('0.0.0');

  useEffect(() => {
    let mounted = true;
    getVersion()
      .then((v) => {
        if (mounted) setVersion(v);
      })
      .catch(() => {
        if (mounted) setVersion('0.0.0');
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Product Info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img src={ImageLogo} alt={APP_NAME} className="size-16 rounded-xl" />
          <div>
            <h2 className="text-foreground text-xl font-bold">{APP_NAME}</h2>
            <p className="text-muted-foreground text-sm">
              {t.settings.aiPlatform}
            </p>
          </div>
        </div>
        <UpdateButton />
      </div>

      {/* Version & Info */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border-border bg-muted/20 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs tracking-wider uppercase">
            {t.settings.version}
          </p>
          <p className="text-foreground mt-1 text-lg font-semibold">
            {version}
          </p>
        </div>
        <div className="border-border bg-muted/20 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs tracking-wider uppercase">
            {t.settings.build}
          </p>
          <p className="text-foreground mt-1 text-lg font-semibold">
            {__BUILD_DATE__}
          </p>
        </div>
      </div>

      {/* Memory Usage */}
      <div className="border-border bg-muted/10 rounded-lg border p-4">
        <MemoryUsage />
      </div>
    </div>
  );
}
