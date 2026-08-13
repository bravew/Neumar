/**
 * MemoryDataActions — Reindex, Export, Import actions for the Memories tab.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Download, FolderOpen, RefreshCw, Upload } from 'lucide-react';

import { API_BASE_URL, APP_SLUG } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

const CARD = 'border-border rounded-lg border p-4';

export function MemoryDataActions({ cacheCount }: { cacheCount: number }) {
  const { t } = useLanguage();
  const [reindexing, setReindexing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const unmountedRef = useRef(false);
  const reindexAbortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      unmountedRef.current = true;
      reindexAbortRef.current?.abort();
    },
    [],
  );

  const handleReindex = useCallback(
    async (force = false) => {
      setReindexing(true);
      setStatusMsg(t.settings.memoryReindexing ?? 'Reindexing...');
      const reindexComplete =
        t.settings.memoryReindexComplete ?? 'Reindex complete';
      const reindexFailed = t.settings.memoryReindexFailed ?? 'Reindex failed';
      reindexAbortRef.current?.abort();
      const ctrl = new AbortController();
      reindexAbortRef.current = ctrl;
      try {
        const res = await fetch(
          `${API_BASE_URL}/memory/reindex?force=${force}`,
          { method: 'POST', signal: ctrl.signal },
        );
        if (unmountedRef.current) return;
        if (!res.ok) {
          setStatusMsg(reindexFailed);
          setReindexing(false);
          return;
        }
        // The POST returns 202 {status:'started'} immediately and runs the
        // reindex in the background. Poll the status endpoint until it
        // settles so the spinner reflects actual progress, not the kickoff.
        const startResp = (await res.json()) as { status?: string };
        if (startResp.status === 'completed') {
          setStatusMsg(reindexComplete);
          setReindexing(false);
          return;
        }

        const POLL_MS = 1000;
        const POLL_TIMEOUT_MS = 10 * 60 * 1000;
        const startedAt = Date.now();
        while (!unmountedRef.current) {
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            setStatusMsg(reindexFailed);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          if (unmountedRef.current) return;
          let progressData: {
            status?: string;
            processed?: number;
            total?: number;
            cached?: number;
            errors?: number;
          };
          try {
            const progressRes = await fetch(
              `${API_BASE_URL}/memory/reindex/status`,
              { signal: ctrl.signal },
            );
            if (!progressRes.ok) continue;
            progressData = await progressRes.json();
          } catch {
            continue;
          }
          if (!progressData?.status || progressData.status === 'idle') {
            // Server has no record of a running reindex — treat as done.
            setStatusMsg(reindexComplete);
            break;
          }
          if (progressData.status === 'running') {
            setStatusMsg(
              `${t.settings.memoryReindexing ?? 'Reindexing...'} (${progressData.processed ?? 0}/${progressData.total ?? 0})`,
            );
            continue;
          }
          if (progressData.status === 'completed') {
            setStatusMsg(
              `${reindexComplete}: ${progressData.processed ?? 0}/${progressData.total ?? 0}`,
            );
          } else {
            setStatusMsg(
              `${reindexFailed}${progressData.errors ? ` (${progressData.errors} errors)` : ''}`,
            );
          }
          break;
        }
      } catch (err) {
        if (
          !unmountedRef.current &&
          (err as { name?: string })?.name !== 'AbortError'
        )
          setStatusMsg(reindexFailed);
      } finally {
        if (!unmountedRef.current) setReindexing(false);
        if (reindexAbortRef.current === ctrl) reindexAbortRef.current = null;
      }
    },
    [t],
  );

  const handleExport = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/memory/export`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${APP_SLUG}-memories-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* */
    }
  }, []);

  const handleOpenFolder = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/memory/files/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pruneDeleted: false }),
      });
      const res = await fetch(`${API_BASE_URL}/memory/files/path`);
      if (!res.ok) {
        throw new Error(
          `Failed to resolve memory folder path (HTTP ${res.status})`,
        );
      }
      const data = (await res.json()) as { path?: string };
      if (!data.path) {
        throw new Error('API returned no path');
      }
      // openPath requires the Tauri opener plugin — silently fall back to
      // copying the path to the clipboard when running outside Tauri (browser
      // dev) so the user always has *some* way to act on the result.
      try {
        const { openPath } = await import('@tauri-apps/plugin-opener');
        await openPath(data.path);
      } catch (err) {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(data.path);
          setStatusMsg(
            `${t.settings.memoryFolderOpenFailed ?? 'Failed to open memory folder'}: path copied to clipboard (${data.path}) — ${err instanceof Error ? err.message : String(err)}`,
          );
          return;
        }
        throw err;
      }
      setStatusMsg(
        t.settings.memoryFolderOpened ?? `Opened memory folder: ${data.path}`,
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setStatusMsg(
        `${t.settings.memoryFolderOpenFailed ?? 'Failed to open memory folder'}: ${detail}`,
      );
    }
  }, [t]);

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const res = await fetch(`${API_BASE_URL}/memory/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json),
        });
        if (unmountedRef.current) return;
        if (res.ok) {
          const data = await res.json();
          const msg =
            t.settings.memoryImportSuccess ??
            'Imported {imported} memories ({skipped} skipped)';
          setStatusMsg(
            msg
              .replace('{imported}', String(data.imported ?? 0))
              .replace('{skipped}', String(data.skipped ?? 0)),
          );
        }
      } catch {
        if (!unmountedRef.current)
          setStatusMsg(t.settings.memoryImportFailed ?? 'Import failed');
      }
    },
    [t],
  );

  return (
    <div className={CARD}>
      <h3 className="text-foreground mb-3 text-sm font-semibold">
        {t.settings.memoryActions ?? 'Data Management'}
      </h3>
      <div className="flex flex-wrap gap-2">
        <ActionBtn
          icon={
            <RefreshCw size={13} className={reindexing ? 'animate-spin' : ''} />
          }
          label={t.settings.memoryReindex ?? 'Reindex'}
          onClick={() => handleReindex(false)}
          disabled={reindexing}
        />
        <ActionBtn
          icon={
            <RefreshCw size={13} className={reindexing ? 'animate-spin' : ''} />
          }
          label={t.settings.memoryForceReindex ?? 'Force Reindex'}
          onClick={() => handleReindex(true)}
          disabled={reindexing}
        />
        <ActionBtn
          icon={<Download size={13} />}
          label={t.settings.memoryExport ?? 'Export'}
          onClick={handleExport}
        />
        <ActionBtn
          icon={<Upload size={13} />}
          label={t.settings.memoryImport ?? 'Import'}
          onClick={() => importRef.current?.click()}
        />
        <ActionBtn
          icon={<FolderOpen size={13} />}
          label={t.settings.memoryOpenFolder ?? 'Open memory folder'}
          onClick={handleOpenFolder}
        />
        <input
          ref={importRef}
          type="file"
          accept=".json"
          className="hidden"
          aria-label="Import memories JSON file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImport(file);
            e.target.value = '';
          }}
        />
      </div>
      {statusMsg && (
        <p className="text-muted-foreground mt-2 text-xs">{statusMsg}</p>
      )}
      {cacheCount > 0 && (
        <p className="text-muted-foreground mt-1 text-xs">
          {t.settings.memoryCacheEntries ?? 'Cached embeddings'}: {cacheCount}
        </p>
      )}
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        'bg-muted hover:bg-muted/80 text-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
