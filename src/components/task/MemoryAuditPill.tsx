/**
 * MemoryAuditPill — toolbar button that surfaces per-session recall provenance.
 *
 * Polls `GET /memory/audit/:sessionId` while the popover is open and shows
 * the count of injected memories as a badge when closed. Click opens a
 * Radix Popover containing the full <MemoryAuditPanel /> scoped to the
 * active session, so the user can verify what context the agent saw without
 * leaving TaskDetail.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import * as Popover from '@radix-ui/react-popover';
import { Brain } from 'lucide-react';

import {
  MemoryAuditPanel,
  type RecallAuditEntry,
} from '@/components/settings/components/MemoryAuditPanel';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface Props {
  sessionId: string | undefined;
}

export function MemoryAuditPill({ sessionId }: Props) {
  const { t } = useLanguage();
  const task = (t.task ?? {}) as Record<string, string>;
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<RecallAuditEntry[]>([]);
  const count = entries.length;

  const fetchEntries = useCallback(
    async (signal?: AbortSignal) => {
      if (!sessionId) return;
      try {
        const res = await fetch(
          `${API_BASE_URL}/memory/audit/${encodeURIComponent(sessionId)}?limit=200`,
          { signal },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { entries: RecallAuditEntry[] };
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      } catch {
        /* noop */
      }
    },
    [sessionId],
  );

  // Fetch once on mount + whenever session changes; refresh on popover open.
  useEffect(() => {
    if (!sessionId) return;
    const ctrl = new AbortController();
    fetchEntries(ctrl.signal);
    return () => ctrl.abort();
  }, [sessionId, fetchEntries]);

  useEffect(() => {
    if (!open || !sessionId) return;
    const ctrl = new AbortController();
    fetchEntries(ctrl.signal);
    const id = setInterval(() => fetchEntries(ctrl.signal), 5000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [open, sessionId, fetchEntries]);

  const label = useMemo(() => {
    return `${task.memoryLoaded ?? 'Memory'} (${count})`;
  }, [count, task.memoryLoaded]);

  if (!sessionId) return null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={
            count != null && count > 0
              ? (task.memoryLoadedTooltip ?? 'View per-turn memory provenance')
              : (task.memoryLoadedNone ??
                'No memories injected yet for this session.')
          }
          className={cn(
            'text-muted-foreground hover:bg-accent hover:text-foreground',
            'flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5',
            'text-xs font-medium transition-colors',
            count != null && count > 0 && 'text-foreground',
          )}
        >
          <Brain className="size-3.5" />
          <span>{label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className={cn(
            'border-border bg-popover text-popover-foreground z-50',
            'max-h-[70vh] w-[420px] overflow-y-auto rounded-lg border p-4 shadow-lg',
          )}
        >
          {/* Pass entries down so the panel doesn't re-fetch the same endpoint. */}
          <MemoryAuditPanel
            sessionId={sessionId}
            refreshIntervalMs={0}
            externalEntries={entries}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
