import { ShieldAlert, ShieldCheck } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

const STYLES: Record<RiskLevel, string> = {
  low: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  medium:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const FALLBACK_LABELS: Record<RiskLevel, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  critical: 'Critical risk',
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  const { t } = useLanguage();
  const label = t.approvals?.risk?.[level] ?? FALLBACK_LABELS[level];
  const Icon = level === 'low' ? ShieldCheck : ShieldAlert;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        STYLES[level],
      )}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}
