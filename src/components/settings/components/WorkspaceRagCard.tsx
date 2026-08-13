/**
 * WorkspaceRagCard — drives the workspace RAG index from Memory settings.
 *
 * Surfaces last-run stats, exposes a "Reindex now" button (with optional
 * "Skip embeddings" for FTS-only fast preview), and includes a one-shot
 * search playground so users can verify the index is healthy.
 */

import { useCallback, useEffect, useState } from 'react';

import { toast } from 'sonner';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface IndexStats {
  scanned: number;
  indexed: number;
  skipped: number;
  pruned: number;
  errored: number;
  durationMs: number;
}

interface IndexSummary {
  totalChunks: number;
  totalFiles: number;
  lastRunAt: string | null;
  lastRoot: string | null;
  lastStats: IndexStats | null;
}

interface SearchHit {
  chunk: {
    id: string;
    path: string;
    startLine: number;
    endLine: number;
    symbol: string | null;
    language: string;
    content: string;
  };
  score: number;
  source: 'fts' | 'vector' | 'hybrid';
}

export function WorkspaceRagCard() {
  const { t } = useLanguage();
  const s = (t.settings ?? {}) as Record<string, string>;
  const [summary, setSummary] = useState<IndexSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [skipEmbed, setSkipEmbed] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const fetchStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE_URL}/rag/status`, { signal });
      if (!res.ok) return;
      const data = (await res.json()) as {
        summary: IndexSummary;
        busy: boolean;
      };
      setSummary(data.summary);
      setBusy(data.busy);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchStatus(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchStatus]);

  // Poll while a reindex is in flight on the server side.
  useEffect(() => {
    if (!busy) return;
    const ctrl = new AbortController();
    const id = setInterval(() => fetchStatus(ctrl.signal), 5000);
    return () => {
      clearInterval(id);
      ctrl.abort();
    };
  }, [busy, fetchStatus]);

  const reindex = useCallback(async () => {
    setReindexing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/rag/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prune: true, skipEmbedding: skipEmbed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success(s.workspaceRagReindexDone ?? 'Workspace reindex complete');
      await fetchStatus();
    } catch (err) {
      toast.error(
        `${s.workspaceRagReindexFailed ?? 'Reindex failed'}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setReindexing(false);
    }
  }, [skipEmbed, s, fetchStatus]);

  const search = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!query.trim()) return;
      setSearching(true);
      try {
        const res = await fetch(`${API_BASE_URL}/rag/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, limit: 5 }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { results: SearchHit[] };
        setHits(data.results);
      } catch (err) {
        toast.error(
          `${s.workspaceRagSearchFailed ?? 'Search failed'}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      } finally {
        setSearching(false);
      }
    },
    [query, s],
  );

  const lastStats = summary?.lastStats;

  return (
    <div className="border-border bg-card space-y-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {s.workspaceRagTitle ?? 'Workspace knowledge'}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {s.workspaceRagSubtitle ??
              'Local hybrid search over your workspace, exposed to agents as the workspace_search tool.'}
          </p>
        </div>
        <button
          type="button"
          onClick={reindex}
          disabled={reindexing || busy}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium',
            'bg-primary text-primary-foreground',
            'disabled:opacity-50',
          )}
        >
          {reindexing || busy
            ? (s.workspaceRagReindexing ?? 'Indexing…')
            : (s.workspaceRagReindex ?? 'Reindex now')}
        </button>
      </div>

      <div className="text-muted-foreground grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <div className="text-foreground text-base font-semibold">
            {summary?.totalFiles ?? 0}
          </div>
          {s.workspaceRagFiles ?? 'files'}
        </div>
        <div>
          <div className="text-foreground text-base font-semibold">
            {summary?.totalChunks ?? 0}
          </div>
          {s.workspaceRagChunks ?? 'chunks'}
        </div>
        <div>
          <div className="text-foreground text-base font-semibold">
            {lastStats ? `${(lastStats.durationMs / 1000).toFixed(1)}s` : '—'}
          </div>
          {s.workspaceRagLastRun ?? 'last run'}
        </div>
        <div>
          <div
            className="text-foreground truncate text-base font-semibold"
            title={summary?.lastRunAt ?? ''}
          >
            {summary?.lastRunAt
              ? new Date(summary.lastRunAt).toLocaleTimeString()
              : '—'}
          </div>
          {s.workspaceRagLastRunAt ?? 'finished at'}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={skipEmbed}
          onChange={(e) => setSkipEmbed(e.target.checked)}
        />
        {s.workspaceRagSkipEmbed ??
          'Skip embeddings (FTS only — much faster, no semantic search)'}
      </label>

      <form
        onSubmit={search}
        className="border-border space-y-2 rounded-md border p-3"
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              s.workspaceRagSearchPlaceholder ??
              'Try a query (e.g. "where is recall implemented")'
            }
            className="border-border bg-background flex-1 rounded-md border px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="bg-secondary text-secondary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {searching
              ? (s.workspaceRagSearching ?? 'Searching…')
              : (s.workspaceRagSearch ?? 'Search')}
          </button>
        </div>
        {hits && hits.length === 0 && (
          <p className="text-muted-foreground text-xs">
            {s.workspaceRagNoHits ?? 'No matches.'}
          </p>
        )}
        {hits && hits.length > 0 && (
          <ul className="space-y-2">
            {hits.map((hit) => (
              <li
                key={hit.chunk.id}
                className="border-border rounded-md border p-2 text-xs"
              >
                <div className="text-muted-foreground mb-1 flex items-center justify-between gap-2">
                  <span className="font-mono">
                    {hit.chunk.path}:{hit.chunk.startLine}-{hit.chunk.endLine}
                  </span>
                  <span>
                    {hit.source} · {hit.score.toFixed(3)}
                  </span>
                </div>
                <pre className="text-foreground/90 max-h-32 overflow-auto text-[11px] break-words whitespace-pre-wrap">
                  {hit.chunk.content.slice(0, 600)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </form>
    </div>
  );
}
