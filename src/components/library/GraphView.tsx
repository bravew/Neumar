/**
 * GraphView — embeds the existing graphify-out/graph.html in an iframe and
 * surfaces rebuild controls + a side panel with GRAPH_REPORT.md.
 *
 * v1 deliberately reuses the rendered HTML (which already has the force
 * layout, search, and god-node panel) rather than re-implementing it with
 * react-force-graph. Switching to native React rendering is a follow-up.
 */

import { useCallback, useEffect, useState } from 'react';

import { toast } from 'sonner';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface GraphifyStatus {
  state: 'idle' | 'pending' | 'running' | 'error' | 'disabled';
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  manifestUpdatedAt: string | null;
  graphHtmlPath: string | null;
  graphJsonPath: string | null;
  reportPath: string | null;
  workDir: string;
}

const STATE_KEY: Record<GraphifyStatus['state'], string> = {
  idle: 'graphifyStateIdle',
  pending: 'graphifyStatePending',
  running: 'graphifyStateRunning',
  error: 'graphifyStateError',
  disabled: 'graphifyStateDisabled',
};

const STATE_FALLBACK: Record<GraphifyStatus['state'], string> = {
  idle: 'Idle',
  pending: 'Queued',
  running: 'Rebuilding…',
  error: 'Error',
  disabled: 'Not installed',
};

export function GraphView() {
  const { t } = useLanguage();
  const s = (t.library ?? {}) as Record<string, string>;
  const [status, setStatus] = useState<GraphifyStatus | null>(null);
  const [report, setReport] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const fetchStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE_URL}/graphify/status`, { signal });
      if (!res.ok) return;
      const data = (await res.json()) as GraphifyStatus;
      setStatus(data);
    } catch {
      /* noop */
    }
  }, []);

  const fetchReport = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE_URL}/graphify/report`, { signal });
      if (!res.ok) {
        setReport('');
        return;
      }
      setReport(await res.text());
    } catch {
      setReport('');
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchStatus(ctrl.signal);
    fetchReport(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchStatus, fetchReport]);

  useEffect(() => {
    if (!status || status.state === 'idle' || status.state === 'disabled')
      return;
    const ctrl = new AbortController();
    const id = setInterval(() => fetchStatus(ctrl.signal), 5000);
    return () => {
      clearInterval(id);
      ctrl.abort();
    };
  }, [status, fetchStatus]);

  const rebuild = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/graphify/rebuild?immediate=true`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GraphifyStatus;
      setStatus(data);
      await fetchReport();
      if (data.state === 'idle') {
        toast.success(s.graphifyRebuildDone ?? 'Graph rebuilt');
      } else if (data.state === 'disabled') {
        toast.warning(
          s.graphifyDisabled ??
            'graphify is not installed. Run `pip install graphify` in this workspace.',
        );
      } else if (data.state === 'error') {
        toast.error(
          `${s.graphifyError ?? 'Graph rebuild failed'}: ${data.lastError ?? ''}`,
        );
      }
    } catch (err) {
      toast.error(
        `${s.graphifyError ?? 'Rebuild failed'}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setBusy(false);
    }
  }, [fetchReport, s]);

  const isWindowsPath =
    !!status?.graphHtmlPath && /^[a-zA-Z]:/.test(status.graphHtmlPath);
  const graphSrc =
    status?.graphHtmlPath && !isWindowsPath
      ? `file://${status.graphHtmlPath}`
      : null;

  return (
    <div className="flex h-[calc(100vh-12rem)] flex-col gap-3">
      <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-lg border p-3">
        <div className="flex flex-col">
          <span className="text-foreground text-sm font-semibold">
            {s.graphifyTitle ?? 'Knowledge graph'}
          </span>
          <span className="text-muted-foreground text-xs">
            {status?.workDir ?? ''}
          </span>
        </div>
        <div className="text-muted-foreground ml-auto flex items-center gap-3 text-xs">
          <span>
            {s[STATE_KEY[status?.state ?? 'idle']] ??
              STATE_FALLBACK[status?.state ?? 'idle']}
          </span>
          {status?.lastRunAt && (
            <span title={status.lastRunAt}>
              {s.graphifyLastRun ?? 'Last run'}:{' '}
              {new Date(status.lastRunAt).toLocaleString()}
            </span>
          )}
          <button
            type="button"
            onClick={rebuild}
            disabled={busy || status?.state === 'running'}
            aria-label={s.graphifyRebuild ?? 'Rebuild knowledge graph'}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium',
              'bg-primary text-primary-foreground',
              'disabled:opacity-50',
            )}
          >
            {busy || status?.state === 'running'
              ? (s.graphifyRebuilding ?? 'Rebuilding…')
              : (s.graphifyRebuild ?? 'Rebuild now')}
          </button>
        </div>
      </div>

      {status?.state === 'disabled' && (
        <div className="border-border bg-muted/30 rounded-md border p-3 text-xs">
          {s.graphifyDisabledHint ??
            'graphify is not installed in this workspace. Run `pip install graphify` (or your environment equivalent) and try Rebuild again.'}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[1fr_320px]">
        <div className="border-border bg-card overflow-hidden rounded-lg border">
          {graphSrc ? (
            <iframe
              src={graphSrc}
              title="Knowledge graph"
              className="h-full w-full"
              sandbox="allow-scripts allow-downloads"
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-sm">
              {isWindowsPath
                ? (s.graphifyWindowsUnsupported ??
                  'Inline graph viewer is not supported on Windows yet — open graphify-out/graph.html manually.')
                : (s.graphifyEmpty ??
                  'No graph generated yet. Click Rebuild to create one.')}
            </div>
          )}
        </div>

        <aside className="border-border bg-card overflow-y-auto rounded-lg border p-4">
          <h4 className="text-foreground mb-2 text-sm font-semibold">
            {s.graphifyReport ?? 'Graph report'}
          </h4>
          {report ? (
            <pre className="text-foreground/90 text-[11px] break-words whitespace-pre-wrap">
              {report.slice(0, 8000)}
              {report.length > 8000 ? '\n[…]' : ''}
            </pre>
          ) : (
            <p className="text-muted-foreground text-xs">
              {s.graphifyNoReport ?? 'No report available.'}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
