import { useEffect, useState } from 'react';

import { CheckCircle, Clock, XCircle } from 'lucide-react';

import { RiskBadge, type RiskLevel } from '@/components/approval/RiskBadge';
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

interface ApprovalCardProps {
  approval: Approval;
  /**
   * HMAC resume token issued with the original INTERRUPT event. The
   * server requires this on decide for high/critical-risk approvals.
   */
  resumeToken?: string;
  onDecide: (
    id: string,
    decision: 'approved' | 'rejected',
    reason: string | undefined,
    resumeToken: string | undefined,
  ) => void;
}

const TYPE_COLORS: Record<string, string> = {
  plan: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  delegation:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  budget_override:
    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  external_action:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  sensitive_fs: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  automation_change:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

function Countdown({
  expiresAt,
  expiredLabel,
}: {
  expiresAt: string;
  expiredLabel: string;
}) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining(expiredLabel);
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${m}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, expiredLabel]);

  return (
    <span className="text-muted-foreground flex items-center gap-1 text-xs">
      <Clock className="size-3" />
      {remaining}
    </span>
  );
}

export function ApprovalCard({
  approval,
  resumeToken,
  onDecide,
}: ApprovalCardProps) {
  const { t } = useLanguage();
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  let planInfo: { goal?: string; steps?: number } | null = null;
  if (approval.approval_type === 'plan' && approval.payload) {
    try {
      const plan = JSON.parse(approval.payload) as {
        goal?: string;
        steps?: unknown[];
      };
      planInfo = { goal: plan.goal, steps: plan.steps?.length };
    } catch {
      // ignore
    }
  }

  const typeLabel =
    t.approvals?.type?.[
      approval.approval_type as keyof typeof t.approvals.type
    ] ?? approval.approval_type;
  const typeColor =
    TYPE_COLORS[approval.approval_type] ?? 'bg-gray-100 text-gray-700';

  const handleApprove = () =>
    onDecide(approval.id, 'approved', undefined, resumeToken);
  const handleReject = () => {
    if (showRejectInput) {
      onDecide(approval.id, 'rejected', rejectReason || undefined, resumeToken);
      setShowRejectInput(false);
      setRejectReason('');
    } else {
      setShowRejectInput(true);
    }
  };

  return (
    <div className="border-border bg-card rounded-lg border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                typeColor,
              )}
            >
              {typeLabel}
            </span>
            {approval.risk_level && <RiskBadge level={approval.risk_level} />}
            {approval.expires_at && (
              <Countdown
                expiresAt={approval.expires_at}
                expiredLabel={t.approvals?.expired ?? 'Expired'}
              />
            )}
          </div>
          <h3 className="text-foreground truncate text-sm font-medium">
            {approval.title}
          </h3>
          {approval.description && (
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
              {approval.description}
            </p>
          )}
          {planInfo && (
            <div className="text-muted-foreground mt-1 text-xs">
              {planInfo.goal && (
                <span>
                  {t.approvals?.goal ?? 'Goal'}: {planInfo.goal}
                </span>
              )}
              {planInfo.steps !== undefined && (
                <span className="ml-2">
                  {(t.approvals?.steps ?? '{count} steps').replace(
                    '{count}',
                    String(planInfo.steps),
                  )}
                </span>
              )}
            </div>
          )}
          <p className="text-muted-foreground mt-1 text-xs">
            {approval.entity_type}: {approval.entity_id.slice(0, 8)}...
          </p>
        </div>
      </div>

      {showRejectInput && (
        <div className="mt-3">
          <input
            className="border-border bg-background text-foreground w-full rounded border px-2 py-1 text-xs"
            placeholder={t.approvals?.reason ?? 'Reason (optional)'}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            autoFocus
          />
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={handleApprove}
          className="flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700"
        >
          <CheckCircle className="size-3" />
          {t.approvals?.approve ?? 'Approve'}
        </button>
        <button
          onClick={handleReject}
          className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700"
        >
          <XCircle className="size-3" />
          {showRejectInput
            ? (t.approvals?.confirmReject ?? 'Confirm Reject')
            : (t.approvals?.reject ?? 'Reject')}
        </button>
        {showRejectInput && (
          <button
            onClick={() => {
              setShowRejectInput(false);
              setRejectReason('');
            }}
            className="text-muted-foreground hover:text-foreground px-2 text-xs transition-colors"
          >
            {t.approvals?.cancel ?? 'Cancel'}
          </button>
        )}
      </div>
    </div>
  );
}
