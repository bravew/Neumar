import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
} from 'lucide-react';

import type { CallType, UsageLog } from '@/shared/db/usage-api';
import {
  fetchRequestLogs,
  formatMicroCost,
  formatTokens,
  getEffectiveCost,
} from '@/shared/db/usage-api';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { getTimeRangeStart, type TimeRange } from './UsageDateFilter';

interface UsageRequestLogProps {
  timeRange: TimeRange;
  source?: 'channel' | 'desktop';
}

const PAGE_SIZES = [20, 50, 100, 200] as const;
type PageSize = (typeof PAGE_SIZES)[number];

const BILLING_BADGE_STYLES: Record<string, string> = {
  api: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  subscription: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  free: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

type SortField = 'created_at' | 'total_cost' | 'tokens' | 'latency_ms';
type SortDir = 'asc' | 'desc';

const CALL_TYPES: CallType[] = [
  'agent',
  'ptc',
  'title',
  'embedding',
  'image',
  'speech',
  'other',
];
const PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'gemini',
  'byteplus',
] as const;

// Default column widths in px: Time, Provider, Model, Type, Billing, In/Out, Cost, Latency
const DEFAULT_COL_WIDTHS = [70, 60, 140, 80, 50, 100, 40, 40];
const MIN_COL_WIDTH = 30;

/** Format timestamp as yyyy/mm/dd hh:mm:ss */
function formatTime(iso: string): string {
  const d = new Date(iso + 'Z');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format latency in seconds */
function formatLatency(ms: number): string {
  if (ms <= 0) return '-';
  return `${(ms / 1000).toFixed(2)}s`;
}

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

async function exportLogsToCsv(
  logs: UsageLog[],
  headers: string[],
): Promise<void> {
  const rows = logs.map((log) => [
    formatTime(log.created_at),
    log.provider ?? '',
    log.model ?? '',
    log.call_type,
    log.billing_type,
    String(log.input_tokens),
    String(log.output_tokens),
    String(log.cache_read_tokens),
    String(log.cache_creation_tokens),
    (getEffectiveCost(log.total_cost, log.billing_type) / 1_000_000).toFixed(6),
    log.latency_ms > 0 ? (log.latency_ms / 1000).toFixed(3) : '',
    log.status,
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const filename = `usage-log-${new Date().toISOString().slice(0, 10)}.csv`;
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: filename,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (path) await writeFile(path, new TextEncoder().encode('\uFEFF' + csv));
  } else {
    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export function UsageRequestLog({ timeRange, source }: UsageRequestLogProps) {
  const { t } = useLanguage();
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterProvider, setFilterProvider] = useState<string>('');
  const [filterCallType, setFilterCallType] = useState<string>('');
  const [filterLocal, setFilterLocal] = useState<'all' | 'local' | 'non_local'>(
    'all',
  );
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [colWidths, setColWidths] = useState<number[]>(DEFAULT_COL_WIDTHS);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  // Column resize drag state (stored in refs to avoid re-renders during drag)
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;
  // Track active drag listeners so they can be removed if the component unmounts mid-drag
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const startResize = useCallback((colIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidthsRef.current[colIdx];

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(MIN_COL_WIDTH, startWidth + delta);
      setColWidths((prev) => {
        const next = [...prev];
        next[colIdx] = newWidth;
        return next;
      });
    };

    const cleanup = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', cleanup);
      dragCleanupRef.current = null;
    };

    dragCleanupRef.current = cleanup;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', cleanup);
  }, []);

  const loadLogs = useCallback(
    async (pageNum: number) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      try {
        const result = await fetchRequestLogs({
          start: getTimeRangeStart(timeRange),
          source,
          limit: pageSize,
          offset: pageNum * pageSize,
          provider: filterProvider || undefined,
          callType: (filterCallType as CallType) || undefined,
          locality: filterLocal !== 'all' ? filterLocal : undefined,
          sortField,
          sortDir,
          signal: ac.signal,
        });
        if (mountedRef.current) {
          setLogs(result.items);
          setTotal(result.total);
        }
      } catch {
        // Aborted or failed
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [
      timeRange,
      source,
      filterProvider,
      filterCallType,
      sortField,
      sortDir,
      filterLocal,
      pageSize,
    ],
  );

  useEffect(() => {
    mountedRef.current = true;
    setPage(0);
    loadLogs(0);
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, [loadLogs]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage);
      loadLogs(newPage);
    },
    [loadLogs],
  );

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('desc');
      }
    },
    [sortField],
  );

  const totalPages = Math.ceil(total / pageSize);
  const tableWidth = useMemo(
    () => colWidths.reduce((s, w) => s + w, 0),
    [colWidths],
  );

  return (
    <div className="space-y-3">
      {/* Filters + Export */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <select
            value={filterProvider}
            onChange={(e) => setFilterProvider(e.target.value)}
            className="border-border bg-background rounded-md border px-3 py-1.5 text-[13px]"
          >
            <option value="">{t.settings.usageColProvider}</option>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={filterCallType}
            onChange={(e) => setFilterCallType(e.target.value)}
            className="border-border bg-background rounded-md border px-3 py-1.5 text-[13px]"
          >
            <option value="">{t.settings.usageColType}</option>
            {CALL_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {ct}
              </option>
            ))}
          </select>
          <select
            value={filterLocal}
            onChange={(e) =>
              setFilterLocal(e.target.value as 'all' | 'local' | 'non_local')
            }
            className="border-border bg-background rounded-md border px-3 py-1.5 text-[13px]"
          >
            <option value="all">{t.settings.usageAll}</option>
            <option value="local">{t.settings.usageLocalOnly}</option>
            <option value="non_local">{t.settings.usageNonLocal}</option>
          </select>
        </div>
        <button
          onClick={() =>
            exportLogsToCsv(logs, [
              t.settings.csvHeaderTime,
              t.settings.csvHeaderProvider,
              t.settings.csvHeaderModel,
              t.settings.csvHeaderType,
              t.settings.csvHeaderBilling,
              t.settings.csvHeaderInputTokens,
              t.settings.csvHeaderOutputTokens,
              t.settings.csvHeaderCacheReadTokens,
              t.settings.csvHeaderCacheCreationTokens,
              t.settings.csvHeaderCostUsd,
              t.settings.csvHeaderLatency,
              t.settings.csvHeaderStatus,
            ])
          }
          disabled={logs.length === 0}
          className="border-border bg-background hover:bg-muted flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] disabled:opacity-40"
        >
          <Download className="size-3.5" />
          {t.settings.usageExportCsv}
        </button>
      </div>

      {/* Table */}
      <div className="border-border overflow-x-auto rounded-lg border">
        <table
          className="text-[13px]"
          style={{
            tableLayout: 'fixed',
            width: `${tableWidth}px`,
            minWidth: '100%',
          }}
        >
          <colgroup>
            {colWidths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-border bg-muted/50 text-muted-foreground border-b text-left">
              <ResizableSortHeader
                label={t.settings.usageColTime}
                field="created_at"
                currentField={sortField}
                currentDir={sortDir}
                onSort={handleSort}
                colIdx={0}
                onResizeStart={startResize}
              />
              <ResizableTh colIdx={1} onResizeStart={startResize}>
                {t.settings.usageColProvider}
              </ResizableTh>
              <ResizableTh colIdx={2} onResizeStart={startResize}>
                {t.settings.usageColModel}
              </ResizableTh>
              <ResizableTh colIdx={3} onResizeStart={startResize}>
                {t.settings.usageColType}
              </ResizableTh>
              <ResizableTh colIdx={4} onResizeStart={startResize}>
                {t.settings.usageColBilling}
              </ResizableTh>
              <ResizableSortHeader
                label={t.settings.usageColInputOutput}
                field="tokens"
                currentField={sortField}
                currentDir={sortDir}
                onSort={handleSort}
                align="right"
                colIdx={5}
                onResizeStart={startResize}
              />
              <ResizableSortHeader
                label={t.settings.usageColCost}
                field="total_cost"
                currentField={sortField}
                currentDir={sortDir}
                onSort={handleSort}
                align="right"
                colIdx={6}
                onResizeStart={startResize}
              />
              <ResizableSortHeader
                label={t.settings.usageColLatency}
                field="latency_ms"
                currentField={sortField}
                currentDir={sortDir}
                onSort={handleSort}
                align="right"
                colIdx={7}
                onResizeStart={startResize}
              />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-border border-b">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-3 py-2">
                      <div className="bg-muted h-3 w-12 animate-pulse rounded" />
                    </td>
                  ))}
                </tr>
              ))
            ) : logs.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="text-muted-foreground px-3 py-8 text-center"
                >
                  {t.settings.usageNoLogs}
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-border hover:bg-muted/30 border-b transition-colors duration-150"
                >
                  <td className="text-muted-foreground truncate overflow-hidden px-3 py-2 font-mono text-[12px] whitespace-nowrap">
                    {formatTime(log.created_at)}
                  </td>
                  <td className="truncate overflow-hidden px-3 py-2">
                    {log.provider ?? '-'}
                  </td>
                  <td className="truncate overflow-hidden px-3 py-2 font-mono">
                    {log.model ?? '-'}
                  </td>
                  <td className="truncate overflow-hidden px-3 py-2">
                    {log.call_type}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-medium',
                        BILLING_BADGE_STYLES[log.billing_type] ?? '',
                      )}
                    >
                      {log.billing_type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                    <span className="text-blue-600 dark:text-blue-400">
                      {formatTokens(log.input_tokens)}
                    </span>
                    <span className="text-muted-foreground mx-0.5">/</span>
                    <span className="text-green-600 dark:text-green-400">
                      {formatTokens(log.output_tokens)}
                    </span>
                    {log.cache_read_tokens + log.cache_creation_tokens > 0 && (
                      <span className="ml-1 text-[11px] text-orange-500 dark:text-orange-400">
                        ·
                        {formatTokens(
                          log.cache_read_tokens + log.cache_creation_tokens,
                        )}
                        ↩
                      </span>
                    )}
                  </td>
                  <td className="text-muted-foreground px-3 py-2 text-right font-mono">
                    {getEffectiveCost(log.total_cost, log.billing_type) === 0
                      ? '-'
                      : formatMicroCost(
                          getEffectiveCost(log.total_cost, log.billing_type),
                        )}
                  </td>
                  <td className="text-muted-foreground px-3 py-2 text-right">
                    {formatLatency(log.latency_ms)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          {total} {t.settings.usageRequests.toLowerCase()}
        </span>
        <div className="flex items-center gap-2">
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) as PageSize);
              setPage(0);
            }}
            className="border-border bg-background rounded-md border px-2 py-1 text-[12px]"
            aria-label="Rows per page"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 0}
            className="hover:bg-muted rounded p-1 disabled:opacity-30"
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-xs">
            {totalPages > 0 ? `${page + 1} / ${totalPages}` : '0 / 0'}
          </span>
          <button
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages - 1}
            className="hover:bg-muted rounded p-1 disabled:opacity-30"
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Resize handle ────────────────────────────────────────────────────────────

interface ResizeHandleProps {
  colIdx: number;
  onResizeStart: (colIdx: number, e: React.MouseEvent) => void;
}

function ResizeHandle({ colIdx, onResizeStart }: ResizeHandleProps) {
  return (
    <div
      className="hover:bg-foreground/20 active:bg-foreground/30 absolute top-0 right-0 h-full w-1 cursor-col-resize select-none"
      onMouseDown={(e) => onResizeStart(colIdx, e)}
    />
  );
}

// ─── Plain resizable th ───────────────────────────────────────────────────────

function ResizableTh({
  colIdx,
  onResizeStart,
  children,
}: {
  colIdx: number;
  onResizeStart: (colIdx: number, e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <th className="relative overflow-hidden px-3 py-2 select-none">
      {children}
      <ResizeHandle colIdx={colIdx} onResizeStart={onResizeStart} />
    </th>
  );
}

// ─── Sortable + resizable th ──────────────────────────────────────────────────

function ResizableSortHeader({
  label,
  field,
  currentField,
  currentDir,
  onSort,
  align,
  colIdx,
  onResizeStart,
}: {
  label: string;
  field: SortField;
  currentField: SortField;
  currentDir: SortDir;
  onSort: (field: SortField) => void;
  align?: 'right';
  colIdx: number;
  onResizeStart: (colIdx: number, e: React.MouseEvent) => void;
}) {
  const isActive = currentField === field;
  return (
    <th
      className={cn(
        'hover:text-foreground relative cursor-pointer overflow-hidden px-3 py-2 transition-colors select-none',
        align === 'right' && 'text-right',
      )}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {isActive &&
          (currentDir === 'asc' ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          ))}
      </span>
      <ResizeHandle colIdx={colIdx} onResizeStart={onResizeStart} />
    </th>
  );
}
