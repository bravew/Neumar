import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

type Enforcement = 'hard' | 'reduced' | 'none';

interface SandboxProviderBadgeProps {
  enforcement: Enforcement;
  marketplaceEligible?: boolean;
  reducedReason?: string;
  className?: string;
}

const STYLE: Record<Enforcement, string> = {
  hard: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-800',
  reduced:
    'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-800',
  none: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:ring-rose-800',
};

const ICON: Record<Enforcement, typeof ShieldCheck> = {
  hard: ShieldCheck,
  reduced: ShieldAlert,
  none: ShieldOff,
};

export function SandboxProviderBadge({
  enforcement,
  marketplaceEligible,
  reducedReason,
  className,
}: SandboxProviderBadgeProps) {
  const { t } = useLanguage();
  const Icon = ICON[enforcement];
  const labelKey =
    enforcement === 'hard'
      ? 'sandboxEnforcementHard'
      : enforcement === 'reduced'
        ? 'sandboxEnforcementReduced'
        : 'sandboxEnforcementNone';
  const label = (t.settings as Record<string, string>)[labelKey] ?? enforcement;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
        STYLE[enforcement],
        className,
      )}
      title={reducedReason}
      aria-label={
        marketplaceEligible
          ? `${label} — ${(t.settings as Record<string, string>).sandboxMarketplaceEligible ?? 'marketplace eligible'}`
          : label
      }
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}
