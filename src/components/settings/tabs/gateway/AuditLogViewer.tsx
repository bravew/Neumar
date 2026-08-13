import { useCallback, useEffect, useRef, useState } from 'react';

import { Loader2, Trash2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

interface AuditEntry {
  id: string;
  identity_id: string | null;
  channel_id: string | null;
  action: string;
  details: string;
  created_at: string;
}

export function AuditLogViewer() {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const pageRef = useRef(1);
  const abortRef = useRef<AbortController | null>(null);

  const fetchLog = useCallback(
    async (pageNum: number, signal?: AbortSignal) => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/gateway/audit-log?page=${pageNum}&limit=20`,
          { signal },
        );
        if (signal?.aborted) return;
        const data = await res.json();
        if (pageNum === 1) {
          setEntries(data.entries);
        } else {
          setEntries((prev) => [...prev, ...data.entries]);
        }
        setTotal(data.total);
      } catch {
        // Ignore abort errors
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    fetchLog(1, controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchLog]);

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    setClearing(true);
    setConfirmClear(false);
    try {
      await fetch(`${API_BASE_URL}/gateway/audit-log`, { method: 'DELETE' });
      setEntries([]);
      setTotal(0);
      pageRef.current = 1;
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-foreground text-sm font-medium">
            {t.settings.gatewayAuditLog}
          </h3>
          <p className="text-muted-foreground text-xs">
            {t.settings.gatewayAuditLogDescription}
          </p>
        </div>
        <button
          type="button"
          onClick={handleClear}
          disabled={clearing}
          className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
            confirmClear
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          {clearing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Trash2 className="size-3" />
          )}
          {confirmClear ? 'Confirm clear?' : 'Clear log'}
        </button>
      </div>

      <div className="border-border rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                {t.settings.gatewayAuditTime}
              </th>
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                {t.settings.gatewayAuditAction}
              </th>
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                {t.settings.gatewayAuditIdentity}
              </th>
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                {t.settings.gatewayAuditChannel}
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="text-muted-foreground px-3 py-2 text-xs whitespace-nowrap">
                  {formatTime(entry.created_at)}
                </td>
                <td className="text-foreground px-3 py-2 text-xs font-medium">
                  {entry.action}
                </td>
                <td className="text-muted-foreground px-3 py-2 text-xs">
                  {entry.identity_id?.slice(0, 8) ?? '-'}
                </td>
                <td className="text-muted-foreground px-3 py-2 text-xs">
                  {entry.channel_id ?? '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && (
          <div className="text-muted-foreground px-4 py-6 text-center text-sm">
            {t.settings.gatewayAuditEmpty}
          </div>
        )}
      </div>

      {entries.length < total && (
        <button
          onClick={() => {
            const next = pageRef.current + 1;
            pageRef.current = next;
            // Abort any in-flight request before starting the next one
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            fetchLog(next, controller.signal);
          }}
          className="text-muted-foreground hover:text-foreground cursor-pointer text-xs"
        >
          {t.settings.gatewayAuditLoadMore}
        </button>
      )}
    </div>
  );
}
