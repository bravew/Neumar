import { useState } from 'react';

import type { PermissionRequestState } from '@/shared/hooks/usePermissionRequests';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { useTaskThreadActions } from './task-thread-actions';

const RISK_STYLES = {
  low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  medium:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
} as const;

export function IntentApprovalCard({
  permission,
}: {
  permission: PermissionRequestState;
}) {
  const actions = useTaskThreadActions();
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(permission.command ?? '');
  const resolved = permission.resolved === true;
  const defaultToNo = permission.default_to_no === true;
  const risk = permission.risk_level ?? 'medium';
  const riskLabel =
    risk === 'low'
      ? t.task.riskLow
      : risk === 'high'
        ? t.task.riskHigh
        : t.task.riskMedium;
  const command = permission.command;

  const approve = () => {
    if (!actions) return;
    if (editing && draft.trim() && draft.trim() !== (command ?? '').trim()) {
      actions.respondToPermission(permission.id, 'deny');
      actions.sendMessage(draft.trim());
      return;
    }
    actions.respondToPermission(permission.id, 'allow');
  };

  const cancelEdit = () => {
    setDraft(command ?? '');
    setEditing(false);
  };

  return (
    <div
      role="region"
      aria-label={t.task.permissionRequired}
      className={cn(
        'border-border bg-card my-3 rounded-xl border p-4',
        risk === 'high' && 'border-red-300 dark:border-red-800',
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-foreground text-sm font-medium">
          {t.task.permissionRequired}
        </p>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            RISK_STYLES[risk],
          )}
        >
          {riskLabel}
        </span>
      </div>
      <dl className="mb-3 space-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">
            {t.task.approvalWhat}
          </dt>
          <dd className="text-foreground">{permission.tool}</dd>
        </div>
        {command ? (
          <div>
            <dt className="text-muted-foreground text-xs">
              {t.task.approvalWhere}
            </dt>
            <dd className="text-foreground font-mono text-xs break-all">
              {editing ? (
                <textarea
                  aria-label={t.task.approvalEdit}
                  className="border-border bg-background mt-1 w-full rounded-md border p-2 font-mono text-xs"
                  rows={3}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              ) : (
                command
              )}
            </dd>
          </div>
        ) : null}
        {permission.description ? (
          <div>
            <dt className="text-muted-foreground text-xs">
              {t.task.approvalWhy}
            </dt>
            <dd className="text-foreground">{permission.description}</dd>
          </div>
        ) : null}
      </dl>
      {permission.mcp_server ? (
        <p className="text-muted-foreground mb-2 text-xs">
          {t.task.permissionMcpServer}: {permission.mcp_server.name}
        </p>
      ) : null}
      {defaultToNo && !resolved ? (
        <p className="text-muted-foreground mb-2 text-xs">
          {t.task.permissionDefaultToNoHint}
        </p>
      ) : null}
      {resolved ? (
        <p
          className={cn(
            'text-xs font-medium',
            permission.decision === 'deny'
              ? 'text-destructive'
              : 'text-green-600 dark:text-green-400',
          )}
        >
          {permission.decision === 'deny'
            ? t.task.permissionDeniedLabel
            : t.task.permissionApproved}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            autoFocus={defaultToNo}
            className="border-destructive/30 text-destructive hover:bg-destructive/10 rounded-lg border px-3 py-1.5 text-sm"
            onClick={() => actions?.respondToPermission(permission.id, 'deny')}
          >
            {t.task.approvalDeny}
          </button>
          {editing ? (
            <button
              type="button"
              className="border-border hover:bg-muted rounded-lg border px-3 py-1.5 text-sm"
              onClick={cancelEdit}
            >
              {t.common.cancel}
            </button>
          ) : command ? (
            <button
              type="button"
              className="border-border hover:bg-muted rounded-lg border px-3 py-1.5 text-sm"
              onClick={() => setEditing(true)}
            >
              {t.task.approvalEdit}
            </button>
          ) : null}
          <button
            type="button"
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-3 py-1.5 text-sm"
            onClick={approve}
          >
            {t.task.approvalApprove}
          </button>
        </div>
      )}
    </div>
  );
}
