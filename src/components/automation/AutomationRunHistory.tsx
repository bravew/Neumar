/**
 * AutomationRunHistory
 *
 * Run history table with timestamp, status badges, multi-select, and batch delete.
 */

import { useCallback, useMemo, useState } from 'react';

import { Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/config';
import { useAutomationRuns } from '@/shared/hooks/useAutomationRuns';
import { useLanguage } from '@/shared/providers/language-provider';
import type { AutomationRun } from '@/shared/types/automation';

import { AutomationStatusBadge } from './AutomationStatusBadge';
import { formatDuration, formatRelativeTime } from './utils';

interface AutomationRunHistoryProps {
  automationId: string;
  onSelectRun?: (run: AutomationRun) => void;
}

export function AutomationRunHistory({
  automationId,
  onSelectRun,
}: AutomationRunHistoryProps) {
  const { t } = useLanguage();
  const { runs, loading, refresh } = useAutomationRuns(automationId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const allSelectable = useMemo(
    () =>
      runs.filter(
        (r) =>
          r.status === 'completed' ||
          r.status === 'failed' ||
          r.status === 'cancelled',
      ),
    [runs],
  );
  const allSelected =
    allSelectable.length > 0 && allSelectable.every((r) => selected.has(r.id));

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allSelectable.map((r) => r.id)));
    }
  }, [allSelected, allSelectable]);

  const handleDelete = useCallback(async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/automation/${automationId}/runs`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runIds: Array.from(selected) }),
        },
      );
      if (res.ok) {
        setSelected(new Set());
        refresh();
      }
    } catch {
      // ignore — user can retry
    } finally {
      setDeleting(false);
    }
  }, [selected, automationId, refresh]);

  if (loading) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        {t.common.loading}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        {t.automation.run.noRuns}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Batch actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {t.automation.run.nSelected
              ? t.automation.run.nSelected.replace('{n}', String(selected.size))
              : `${selected.size} selected`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive h-7 gap-1 px-2 text-xs"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
            {t.automation.delete ?? 'Delete'}
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm" aria-label="Run history">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="accent-primary size-3.5 cursor-pointer rounded"
                  aria-label="Select all runs"
                />
              </th>
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                {t.automation.run.triggeredBy}
              </th>
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                {t.automation.run.status}
              </th>
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                {t.automation.run.started}
              </th>
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                {t.automation.run.timestamp ?? 'Timestamp'}
              </th>
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                {t.automation.run.duration}
              </th>
              <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">
                {t.automation.run.cost}
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const isSelectable =
                run.status === 'completed' ||
                run.status === 'failed' ||
                run.status === 'cancelled';
              return (
                <tr
                  key={run.id}
                  className="hover:bg-muted/30 cursor-pointer border-b transition-colors last:border-b-0"
                  onClick={() => onSelectRun?.(run)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onSelectRun?.(run)}
                  aria-label={`Run triggered by ${run.triggeredBy}, status ${run.status}`}
                >
                  <td
                    className="w-8 px-2 py-2.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isSelectable && (
                      <input
                        type="checkbox"
                        checked={selected.has(run.id)}
                        onChange={() => toggleOne(run.id)}
                        className="accent-primary size-3.5 cursor-pointer rounded"
                        aria-label={`Select run ${run.id.slice(0, 8)}`}
                      />
                    )}
                  </td>
                  <td className="text-foreground px-3 py-2.5 capitalize">
                    {run.triggeredBy}
                  </td>
                  <td className="px-3 py-2.5">
                    <AutomationStatusBadge status={run.status} />
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5">
                    {run.startedAt ? formatRelativeTime(run.startedAt) : '---'}
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5 text-xs">
                    {run.startedAt
                      ? new Date(run.startedAt).toLocaleString()
                      : run.queuedAt
                        ? new Date(run.queuedAt).toLocaleString()
                        : '---'}
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5">
                    {run.durationMs ? formatDuration(run.durationMs) : '---'}
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5">
                    {run.cost ? `$${run.cost.toFixed(4)}` : '---'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
