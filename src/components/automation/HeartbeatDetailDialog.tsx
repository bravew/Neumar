/**
 * HeartbeatDetailDialog
 *
 * Modal dialog showing heartbeat/automation details, run history, and actions.
 * Triggered from the notification toast when the user clicks "View".
 *
 * Features:
 * - Automation info (name, schedule, delivery, costs, status)
 * - Recent run history with status badges
 * - Pause/Resume toggle
 * - Cancel (delete) with confirmation
 */

import { useCallback, useEffect, useState } from 'react';

import { code } from '@streamdown/code';
import { Clock, Pause, Play, Trash2 } from 'lucide-react';
import { Streamdown } from 'streamdown';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_BASE_URL } from '@/config';
import { preprocessMarkdown } from '@/shared/lib/markdown-utils';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { Automation, AutomationRun } from '@/shared/types/automation';

import { AutomationStatusBadge } from './AutomationStatusBadge';
import { formatDuration, formatRelativeTime } from './utils';

const STREAMDOWN_PLUGINS = { code };

// ============================================================================
// Types
// ============================================================================

interface HeartbeatDetailDialogProps {
  automationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============================================================================
// Component
// ============================================================================

export function HeartbeatDetailDialog({
  automationId,
  open,
  onOpenChange,
}: HeartbeatDetailDialogProps) {
  const { t } = useLanguage();
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Fetch automation details + run history
  useEffect(() => {
    if (!automationId || !open) return;

    const controller = new AbortController();
    setLoading(true);
    setConfirmDelete(false);

    Promise.all([
      fetch(`${API_BASE_URL}/automation/${automationId}`, {
        signal: controller.signal,
      }).then((r) => r.json()),
      fetch(`${API_BASE_URL}/automation/${automationId}/runs`, {
        signal: controller.signal,
      }).then((r) => r.json()),
    ])
      .then(([autoData, runsData]) => {
        if (controller.signal.aborted) return;
        if (autoData.success) setAutomation(autoData.data);
        if (runsData.success) setRuns(runsData.data);
      })
      .catch(() => {
        // Aborted or network error — dialog will show loading state
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [automationId, open]);

  const handleToggle = useCallback(async () => {
    if (!automation) return;
    setToggling(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/automation/${automation.id}/toggle`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !automation.enabled }),
        },
      );
      const data = await res.json();
      if (data.success) {
        setAutomation(data.data);
      }
    } finally {
      setToggling(false);
    }
  }, [automation]);

  const handleDelete = useCallback(async () => {
    if (!automation) return;
    setDeleting(true);
    try {
      await fetch(`${API_BASE_URL}/automation/${automation.id}`, {
        method: 'DELETE',
      });
      onOpenChange(false);
    } finally {
      setDeleting(false);
    }
  }, [automation, onOpenChange]);

  const recentRuns = runs.slice(-10).reverse();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {loading || !automation ? (
          <div className="flex items-center justify-center py-12">
            <Clock className="text-muted-foreground size-6 animate-spin" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock className="text-primary size-5" />
                {automation.name}
              </DialogTitle>
              <DialogDescription>
                {automation.description ?? automation.prompt.slice(0, 100)}
              </DialogDescription>
            </DialogHeader>

            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <InfoCard
                label={t.automation.run?.status ?? 'Status'}
                value={
                  automation.enabled
                    ? (t.automation.active ?? 'Active')
                    : (t.automation.inactive ?? 'Disabled')
                }
                className={
                  automation.enabled ? 'text-green-600' : 'text-gray-500'
                }
              />
              <InfoCard
                label={t.automation.fields?.schedule ?? 'Schedule'}
                value={getScheduleDescription(automation)}
              />
              <InfoCard
                label={t.automation.run?.cost ?? 'Cost'}
                value={`$${automation.totalCost.toFixed(2)}`}
              />
              <InfoCard
                label={
                  t.automation.runCountLabel?.replace('{count}', '') ?? 'Runs'
                }
                value={String(automation.runCount)}
              />
            </div>

            {/* Delivery & Lifecycle */}
            <div className="grid grid-cols-2 gap-3">
              <InfoCard
                label={t.automation.channelDelivery?.platform ?? 'Delivery'}
                value={automation.channelDelivery?.platform ?? 'desktop'}
              />
              <InfoCard
                label={t.automation.lifecycle?.expiryLabel ?? 'Expires'}
                value={
                  automation.expiresAt
                    ? new Date(automation.expiresAt).toLocaleDateString()
                    : (t.automation.lifecycle?.never ?? 'Never')
                }
              />
            </div>

            {/* Latest Run Result */}
            {recentRuns[0]?.result && (
              <div className="rounded-lg border p-4">
                <h4 className="text-foreground mb-2 text-sm font-medium">
                  {t.automation.run?.result ?? 'Latest Result'}
                </h4>
                <div className="prose prose-sm text-foreground [&_:not(pre)>code]:bg-muted max-h-64 max-w-none min-w-0 overflow-y-auto break-words [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-[0.85em] [&_:not(pre)>code]:before:content-none [&_:not(pre)>code]:after:content-none [&_pre]:max-w-full [&_pre]:overflow-x-auto">
                  <Streamdown plugins={STREAMDOWN_PLUGINS}>
                    {preprocessMarkdown(recentRuns[0].result)}
                  </Streamdown>
                </div>
              </div>
            )}

            {/* Run History */}
            <div>
              <h4 className="text-foreground mb-2 text-sm font-medium">
                {t.automation.run?.runHistory ?? 'Run History'}
              </h4>
              {recentRuns.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t.automation.run?.noRuns ?? 'No runs yet'}
                </p>
              ) : (
                <div className="divide-border max-h-60 divide-y overflow-y-auto rounded-md border">
                  {recentRuns.map((run) => (
                    <RunRow key={run.id} run={run} />
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <DialogFooter className="gap-2 sm:gap-0">
              {/* Delete with confirmation */}
              {confirmDelete ? (
                <div className="mr-auto flex items-center gap-2">
                  <span className="text-destructive text-xs">
                    {t.automation.deleteConfirm ?? 'Delete?'}
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {t.automation.delete ?? 'Delete'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(false)}
                  >
                    {t.automation.notifications?.dismiss ?? 'Cancel'}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive mr-auto"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="mr-1 size-3.5" />
                  {t.automation.delete ?? 'Delete'}
                </Button>
              )}

              {/* Pause/Resume */}
              <Button
                variant={automation.enabled ? 'outline' : 'default'}
                size="sm"
                onClick={handleToggle}
                disabled={toggling}
              >
                {automation.enabled ? (
                  <>
                    <Pause className="mr-1 size-3.5" />
                    {t.automation.disable ?? 'Pause'}
                  </>
                ) : (
                  <>
                    <Play className="mr-1 size-3.5" />
                    {t.automation.enable ?? 'Resume'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

function InfoCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="bg-muted/50 rounded-lg p-2.5">
      <p className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        {label}
      </p>
      <p className={cn('text-foreground text-sm font-medium', className)}>
        {value}
      </p>
    </div>
  );
}

function RunRow({ run }: { run: AutomationRun }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div
        className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 px-3 py-2 text-xs"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
      >
        <AutomationStatusBadge status={run.status} />
        <span className="text-muted-foreground">
          {run.startedAt ? formatRelativeTime(run.startedAt) : 'pending'}
        </span>
        {run.durationMs != null && (
          <span className="text-muted-foreground">
            {formatDuration(run.durationMs)}
          </span>
        )}
        {run.cost != null && (
          <span className="text-muted-foreground ml-auto">
            ${run.cost.toFixed(4)}
          </span>
        )}
      </div>
      {expanded && (run.result || run.error) && (
        <div className="bg-muted/30 border-t px-3 py-2">
          {run.error ? (
            <pre className="text-muted-foreground max-h-32 overflow-auto text-[11px] whitespace-pre-wrap">
              {run.error}
            </pre>
          ) : (
            <div className="prose prose-xs text-foreground [&_:not(pre)>code]:bg-muted max-h-32 max-w-none min-w-0 overflow-auto text-[11px] break-words [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:text-[0.85em] [&_:not(pre)>code]:before:content-none [&_:not(pre)>code]:after:content-none [&_pre]:max-w-full [&_pre]:overflow-x-auto">
              <Streamdown plugins={STREAMDOWN_PLUGINS}>
                {preprocessMarkdown(run.result!)}
              </Streamdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getScheduleDescription(automation: Automation): string {
  const { trigger } = automation;
  if (trigger.type === 'heartbeat') {
    const mins = Math.round(trigger.heartbeat.intervalMs / 60_000);
    return mins < 60 ? `Every ${mins}m` : `Every ${mins / 60}h`;
  }
  if (trigger.type === 'cron' && trigger.schedule.cronExpr) {
    return trigger.schedule.cronExpr;
  }
  return trigger.type;
}
