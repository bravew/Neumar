import { useState } from 'react';

import type { PermissionRequestState } from '@/shared/hooks/usePermissionRequests';
import { rewriteDisplayPaths } from '@/shared/lib/rewriteDisplayPaths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { useTaskThreadActions } from './task-thread-actions';

export function IntentApprovalCard({
  permission,
}: {
  permission: PermissionRequestState;
}) {
  const actions = useTaskThreadActions();
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(permission.command ?? '');
  const sessionRoot = actions?.sessionRoot;
  const where = permission.command
    ? rewriteDisplayPaths(permission.command, sessionRoot)
    : undefined;
  const resolved = permission.resolved === true;
  const defaultToNo = permission.default_to_no === true;

  const approve = () => {
    if (!actions) return;
    if (
      editing &&
      draft.trim() &&
      draft.trim() !== (permission.command ?? '').trim()
    ) {
      actions.respondToPermission(permission.id, 'deny');
      actions.sendMessage(draft.trim());
      return;
    }
    actions.respondToPermission(permission.id, 'allow');
  };

  return (
    <div
      role="region"
      aria-label={t.task.permissionRequired}
      className="border-border bg-card my-3 rounded-xl border p-4"
    >
      <p className="text-foreground mb-3 text-sm font-medium">
        {t.task.permissionRequired}
      </p>
      <dl className="mb-3 space-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">
            {t.task.approvalWhat}
          </dt>
          <dd className="text-foreground">{permission.tool}</dd>
        </div>
        {where ? (
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
                where
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
          <button
            type="button"
            className="border-border hover:bg-muted rounded-lg border px-3 py-1.5 text-sm"
            onClick={() => setEditing(true)}
          >
            {t.task.approvalEdit}
          </button>
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
