import type { PermissionRequest } from '@/shared/hooks/agent-types';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface Props {
  permission: PermissionRequest;
  onRespond: (id: string, decision: 'allow' | 'deny' | 'always_allow') => void;
  isResolved?: boolean;
  resolvedDecision?: 'allow' | 'deny' | 'always_allow';
}

const RISK_STYLES = {
  low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  medium:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
} as const;

export function PermissionDialog({
  permission,
  onRespond,
  isResolved,
  resolvedDecision,
}: Props) {
  const { t } = useLanguage();
  const risk = permission.risk_level ?? 'medium';
  const riskLabel =
    risk === 'low'
      ? (t.task.riskLow ?? 'Low Risk')
      : risk === 'high'
        ? (t.task.riskHigh ?? 'High Risk')
        : (t.task.riskMedium ?? 'Medium Risk');

  return (
    <div
      role="alertdialog"
      aria-label={t.task.permissionRequired ?? 'Permission Required'}
      className={cn(
        'border-border/60 bg-card my-2 max-w-md rounded-lg border p-3 shadow-sm',
        risk === 'high' && 'border-red-300 dark:border-red-800',
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">
          {t.task.permissionRequired ?? 'Permission Required'}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            RISK_STYLES[risk],
          )}
        >
          {riskLabel}
        </span>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-xs">
          {permission.tool}
        </span>
      </div>

      {permission.command && (
        <div className="bg-muted/50 mb-3 rounded p-2 font-mono text-xs break-all">
          {permission.command.length > 150
            ? permission.command.slice(0, 150) + '...'
            : permission.command}
        </div>
      )}

      {isResolved ? (
        <div
          className={cn(
            'text-center text-xs font-medium',
            resolvedDecision === 'deny'
              ? 'text-destructive'
              : 'text-green-600 dark:text-green-400',
          )}
        >
          {resolvedDecision === 'deny'
            ? (t.task.permissionDeniedLabel ?? 'Denied')
            : (t.task.permissionApproved ?? 'Approved')}
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            className="border-destructive/30 text-destructive hover:bg-destructive/10 flex-1 rounded border px-3 py-1.5 text-xs font-medium transition"
            onClick={() => onRespond(permission.id, 'deny')}
          >
            {t.task.permissionDeny ?? 'Deny'}
          </button>
          <button
            type="button"
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 rounded px-3 py-1.5 text-xs font-medium transition"
            onClick={() => onRespond(permission.id, 'allow')}
          >
            {t.task.permissionAllowOnce ?? 'Allow Once'}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:bg-muted flex-1 rounded px-3 py-1.5 text-xs font-medium transition"
            onClick={() => onRespond(permission.id, 'always_allow')}
          >
            {t.task.permissionAlwaysAllow ?? 'Always Allow'}
          </button>
        </div>
      )}
    </div>
  );
}
