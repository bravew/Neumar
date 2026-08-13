/**
 * MemoryAuditPanel — surfaces per-session recall provenance.
 *
 * Lists every memory injected into the prompt for a given session, including
 * the score and retrieval method (vector / fts / hybrid / pinned / file).
 * Used in MemorySettings (audit tab) and the TaskDetail right-sidebar.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { toast } from 'sonner';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface RecallAuditMemory {
  id: string;
  content: string;
  category?: string;
  importance?: number;
  memoryType?: string;
  scopeType?: string;
}

export interface RecallAuditEntry {
  id: number;
  sessionId: string;
  memoryId: string;
  score: number;
  method: 'vector' | 'fts' | 'hybrid' | 'pinned' | 'file';
  query: string | null;
  recalledAt: string;
  memory?: RecallAuditMemory;
}

interface Props {
  /** Session id to audit. When omitted the panel renders an input chooser. */
  sessionId?: string;
  /** Show the session chooser even when sessionId is provided (Settings tab). */
  allowSessionChooser?: boolean;
  /** Auto-refresh interval in ms (0 = manual). */
  refreshIntervalMs?: number;
  /** Externally-provided entries — when set, panel skips its own fetch. */
  externalEntries?: RecallAuditEntry[];
}

const METHOD_BADGE: Record<RecallAuditEntry['method'], string> = {
  vector: 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
  fts: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  hybrid: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  pinned: 'bg-pink-500/15 text-pink-600 dark:text-pink-300',
  file: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
};

function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export function MemoryAuditPanel({
  sessionId: initialSessionId,
  allowSessionChooser = false,
  refreshIntervalMs = 0,
  externalEntries,
}: Props) {
  const { t } = useLanguage();
  const s = (t.settings ?? {}) as Record<string, string>;
  const [sessionId, setSessionId] = useState(initialSessionId ?? '');
  const [entries, setEntries] = useState<RecallAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSessionId) setSessionId(initialSessionId);
  }, [initialSessionId]);

  const load = useCallback(async (id: string, signal?: AbortSignal) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/memory/audit/${encodeURIComponent(id)}?limit=200`,
        { signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries: RecallAuditEntry[] };
      setEntries(data.entries ?? []);
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (externalEntries) {
      setEntries(externalEntries);
    }
  }, [externalEntries]);

  useEffect(() => {
    if (!sessionId) return;
    // Parent owns the fetch — skip our own to avoid duplicate requests.
    if (externalEntries) return;
    const ctrl = new AbortController();
    load(sessionId, ctrl.signal);
    if (refreshIntervalMs > 0) {
      const t = setInterval(
        () => load(sessionId, ctrl.signal),
        refreshIntervalMs,
      );
      return () => {
        ctrl.abort();
        clearInterval(t);
      };
    }
    return () => ctrl.abort();
  }, [sessionId, refreshIntervalMs, load, externalEntries]);

  const reportDrift = useCallback(
    async (memoryId: string) => {
      try {
        const res = await fetch(`${API_BASE_URL}/memory/${memoryId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lifecycleStatus: 'stale' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success(s.memoryAuditDriftReported ?? 'Marked memory as stale');
      } catch (err) {
        toast.error(
          `${s.memoryAuditDriftFailed ?? 'Failed to report drift'}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
    [s],
  );

  const groups = useMemo(() => {
    const byMethod = new Map<string, number>();
    for (const e of entries) {
      byMethod.set(e.method, (byMethod.get(e.method) ?? 0) + 1);
    }
    return Array.from(byMethod.entries()).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  return (
    <div className="space-y-4">
      {allowSessionChooser && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder={s.memoryAuditSessionPlaceholder ?? 'Session id'}
            className="border-border bg-background flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => sessionId && load(sessionId)}
            className="bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm"
          >
            {s.memoryAuditLoad ?? 'Load'}
          </button>
        </div>
      )}

      {!sessionId && (
        <p className="text-muted-foreground text-sm">
          {s.memoryAuditEmpty ??
            'No session selected. Choose a session to inspect injected memories.'}
        </p>
      )}

      {error && (
        <p className="text-destructive text-sm">
          {s.memoryAuditError ?? 'Failed to load audit'}: {error}
        </p>
      )}

      {sessionId && !loading && !error && entries.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {s.memoryAuditNone ??
            'No memories were injected for this session yet.'}
        </p>
      )}

      {groups.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {groups.map(([method, count]) => (
            <span
              key={method}
              className={cn(
                'rounded-full px-2 py-0.5 font-medium',
                METHOD_BADGE[method as RecallAuditEntry['method']] ?? '',
              )}
            >
              {method} · {count}
            </span>
          ))}
        </div>
      )}

      <ul className="space-y-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="border-border bg-card rounded-md border p-3"
          >
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 font-medium',
                    METHOD_BADGE[entry.method],
                  )}
                >
                  {entry.method}
                </span>
                <span className="text-muted-foreground">
                  {Math.round(entry.score * 100)}% · {fmtAge(entry.recalledAt)}
                </span>
                {entry.memory?.category && (
                  <span className="text-muted-foreground">
                    · {entry.memory.category}
                  </span>
                )}
              </div>
              {entry.method !== 'file' && (
                <button
                  type="button"
                  onClick={() => reportDrift(entry.memoryId)}
                  className="text-muted-foreground hover:text-destructive text-xs underline-offset-2 hover:underline"
                >
                  {s.memoryAuditReportDrift ?? 'Report drift'}
                </button>
              )}
            </div>
            <p className="text-foreground text-sm break-words whitespace-pre-wrap">
              {entry.method === 'file'
                ? entry.memoryId
                : (entry.memory?.content ?? entry.memoryId)}
            </p>
            {entry.query && (
              <p className="text-muted-foreground mt-1 text-xs italic">
                ↳ {entry.query}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
