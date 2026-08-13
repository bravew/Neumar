import { useCallback, useEffect, useState } from 'react';

import { invoke } from '@tauri-apps/api/core';
import { Loader2, Power, RefreshCw } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../components/Switch';

interface DaemonStatus {
  installed: boolean;
  running: boolean;
  label: string;
  message: string;
}

const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

const DEFAULT_LABEL = 'ai.neuma.daemon';
const SIDECAR_PATH =
  import.meta.env.VITE_NEUMA_SIDECAR_PATH || '/usr/local/bin/neumar-api';

export function AdvancedSettings() {
  const { t } = useLanguage();
  const s = t.settings as Record<string, string>;
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri) return;
    try {
      const next = await invoke<DaemonStatus>('daemon_status', {
        label: DEFAULT_LABEL,
      });
      setStatus(next);
      const tail = await invoke<string>('daemon_logs_tail', { lines: 100 });
      setLogs(tail);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onToggle = async (next: boolean) => {
    if (!isTauri) return;
    setBusy(true);
    setError(null);
    try {
      if (next) {
        await invoke('daemon_install', {
          label: DEFAULT_LABEL,
          sidecarPath: SIDECAR_PATH,
        });
      } else {
        await invoke('daemon_uninstall', { label: DEFAULT_LABEL });
      }
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const onKickstart = async () => {
    if (!isTauri) return;
    setBusy(true);
    setError(null);
    try {
      await invoke('daemon_kickstart', { label: DEFAULT_LABEL });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!isTauri) {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        {s.advancedDaemonDesktopOnly}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h2 className="text-foreground text-base font-semibold">
          {s.advancedRunInBackground}
        </h2>
        <p className="text-muted-foreground text-xs">
          {s.advancedRunInBackgroundDescription}
        </p>
      </header>

      <div className="border-border flex items-center justify-between rounded-lg border px-4 py-3">
        <div className="flex items-center gap-3">
          <Power className="text-muted-foreground size-4" />
          <div>
            <div className="text-foreground text-sm font-medium">
              {s.advancedBackgroundDaemon}
            </div>
            <div className="text-muted-foreground text-xs">
              {status
                ? `${status.installed ? s.advancedInstalled : s.advancedNotInstalled} · ${status.message}`
                : s.loading}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {busy && (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          )}
          <Switch
            checked={status?.installed ?? false}
            onChange={onToggle}
            disabled={busy}
            label={s.advancedBackgroundDaemon}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="border-border hover:bg-muted/40 flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs"
          onClick={onKickstart}
          disabled={busy || !status?.installed}
        >
          <RefreshCw className="size-3.5" />
          {s.advancedKickstart}
        </button>
        <button
          className="border-border hover:bg-muted/40 flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs"
          onClick={refresh}
          disabled={busy}
        >
          {s.refresh}
        </button>
      </div>

      {error && <div className="text-xs text-red-500">{error}</div>}

      <div>
        <div className="text-muted-foreground mb-1 text-xs font-medium">
          {s.advancedRecentSidecarLogs}
        </div>
        <pre className="bg-muted/30 text-foreground/80 max-h-72 overflow-auto rounded-md p-3 text-[11px] leading-relaxed">
          {logs || s.advancedNoLogs}
        </pre>
      </div>
    </div>
  );
}
