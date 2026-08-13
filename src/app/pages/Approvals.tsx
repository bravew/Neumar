import { useCallback, useEffect, useRef, useState } from 'react';

import { ClipboardCheck } from 'lucide-react';

import { ApprovalCard } from '@/components/approval/ApprovalCard';
import type { RiskLevel } from '@/components/approval/RiskBadge';
import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface Approval {
  id: string;
  approval_type: string;
  status: string;
  title: string;
  description: string | null;
  payload: string | null;
  entity_type: string;
  entity_id: string;
  expires_at: string | null;
  created_at: string;
  risk_level?: RiskLevel;
}

type Tab = 'pending' | 'history';

export function ApprovalsPage() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [pending, setPending] = useState<Approval[]>([]);
  const [history, setHistory] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  // Resume tokens echo back at decide time for risk-gated approvals;
  // kept out of `pending` so they don't leak through state-shape consumers.
  const resumeTokensRef = useRef<Map<string, string>>(new Map());
  const [decideError, setDecideError] = useState<string | null>(null);

  const fetchHistory = useCallback(async (signal?: AbortSignal) => {
    try {
      const [approvedRes, rejectedRes] = await Promise.all([
        fetch(`${API_BASE_URL}/approvals?status=approved&limit=25`, { signal }),
        fetch(`${API_BASE_URL}/approvals?status=rejected&limit=25`, { signal }),
      ]);
      const approved = approvedRes.ok
        ? ((await approvedRes.json()) as { approvals: Approval[] }).approvals
        : [];
      const rejected = rejectedRes.ok
        ? ((await rejectedRes.json()) as { approvals: Approval[] }).approvals
        : [];
      setHistory(
        [...approved, ...rejected].sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
        ),
      );
    } catch {
      // ignore abort
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchHistory(controller.signal).finally(() => setLoading(false));

    // EventSource auto-reconnects on transient drops; the server replays
    // `snapshot` on each connect, so reconciliation stays correct.
    const es = new EventSource(`${API_BASE_URL}/approvals/stream`);

    const parseSse = <T,>(e: MessageEvent): T | null => {
      try {
        return JSON.parse(e.data) as T;
      } catch {
        return null;
      }
    };

    const applySnapshot = (e: MessageEvent) => {
      const data = parseSse<{ approvals: Approval[] }>(e);
      if (!data) return;
      const approvals = data.approvals ?? [];
      setPending(approvals);
      // Drop tokens for approvals decided/expired during disconnect — the
      // map would otherwise grow unbounded across reconnects.
      const live = new Set(approvals.map((a) => a.id));
      for (const id of resumeTokensRef.current.keys()) {
        if (!live.has(id)) resumeTokensRef.current.delete(id);
      }
    };
    const applyCreated = (e: MessageEvent) => {
      const evt = parseSse<{ approval: Approval; resumeToken?: string }>(e);
      if (!evt) return;
      if (evt.resumeToken) {
        resumeTokensRef.current.set(evt.approval.id, evt.resumeToken);
      }
      setPending((prev) =>
        prev.some((p) => p.id === evt.approval.id)
          ? prev
          : [evt.approval, ...prev],
      );
    };
    const applyDecided = (e: MessageEvent) => {
      const evt = parseSse<{ approval: Approval }>(e);
      if (!evt) return;
      resumeTokensRef.current.delete(evt.approval.id);
      setPending((prev) => prev.filter((p) => p.id !== evt.approval.id));
      // Optimistic prepend; next visit refetches the authoritative ordering.
      setHistory((prev) =>
        prev.some((p) => p.id === evt.approval.id)
          ? prev
          : [evt.approval, ...prev],
      );
    };

    es.addEventListener('snapshot', applySnapshot);
    es.addEventListener('created', applyCreated);
    es.addEventListener('decided', applyDecided);

    return () => {
      controller.abort();
      es.removeEventListener('snapshot', applySnapshot);
      es.removeEventListener('created', applyCreated);
      es.removeEventListener('decided', applyDecided);
      es.close();
    };
  }, [fetchHistory]);

  const handleDecide = useCallback(
    async (
      id: string,
      decision: 'approved' | 'rejected',
      reason: string | undefined,
      resumeToken: string | undefined,
    ) => {
      setDecideError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/approvals/${id}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision,
            reason,
            resumeToken: resumeToken ?? resumeTokensRef.current.get(id),
          }),
        });
        if (res.ok) return;
        // 401: bad/missing token; 410: token expired — both surface to the
        // user so they know to reload for a fresh approval row.
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setDecideError(body?.error ?? `Decision failed (HTTP ${res.status})`);
      } catch (err) {
        setDecideError(err instanceof Error ? err.message : 'Decision failed');
      }
    },
    [],
  );

  return (
    <SidebarProvider>
      <div className="flex h-svh overflow-hidden" data-testid="approvals-page">
        <LeftSidebar tasks={[]} />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="border-border border-b px-6 py-4">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="text-primary size-5" />
              <h1 className="text-foreground text-lg font-semibold">
                {t.approvals?.title ?? 'Approvals'}
              </h1>
              {pending.length > 0 && (
                <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                  {pending.length}
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-1">
              {(['pending', 'history'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm transition-colors',
                    activeTab === tab
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  {tab === 'pending'
                    ? (t.approvals?.pending ?? 'Pending')
                    : (t.approvals?.history ?? 'History')}
                  {tab === 'pending' && pending.length > 0 && (
                    <span className="ml-1.5 text-xs opacity-70">
                      ({pending.length})
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {decideError && (
              <div
                role="alert"
                className="mb-3 max-w-2xl rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              >
                {decideError}
              </div>
            )}
            {loading ? (
              <div className="text-muted-foreground flex items-center justify-center py-12 text-sm">
                {t.approvals?.loading ?? 'Loading...'}
              </div>
            ) : activeTab === 'pending' ? (
              pending.length === 0 ? (
                <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-16">
                  <ClipboardCheck className="size-10 opacity-30" />
                  <p className="text-sm">
                    {t.approvals?.empty ?? 'No pending approvals'}
                  </p>
                </div>
              ) : (
                <div className="max-w-2xl space-y-3">
                  {pending.map((a) => (
                    <ApprovalCard
                      key={a.id}
                      approval={a}
                      resumeToken={resumeTokensRef.current.get(a.id)}
                      onDecide={handleDecide}
                    />
                  ))}
                </div>
              )
            ) : history.length === 0 ? (
              <div className="text-muted-foreground flex items-center justify-center py-16 text-sm">
                {t.approvals?.noHistory ?? 'No history yet'}
              </div>
            ) : (
              <div className="max-w-2xl space-y-3">
                {history.map((a) => (
                  <div
                    key={a.id}
                    className="border-border bg-card rounded-lg border p-3 opacity-70"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          a.status === 'approved'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700',
                        )}
                      >
                        {a.status === 'approved'
                          ? (t.approvals?.statusApproved ?? 'Approved')
                          : (t.approvals?.statusRejected ?? 'Rejected')}
                      </span>
                      <span className="text-foreground text-sm">{a.title}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
