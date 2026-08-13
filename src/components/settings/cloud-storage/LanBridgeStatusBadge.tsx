import { Link2, Link2Off, ShieldCheck } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface LanBridgeStatusBadgeProps {
  available: boolean;
  verifiedMappings: number;
  totalMappings: number;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

export function LanBridgeStatusBadge({
  available,
  verifiedMappings,
  totalMappings,
  disabled = false,
  onClick,
  className,
}: LanBridgeStatusBadgeProps) {
  const { t, tt } = useLanguage();
  const s = t.cloudStorage;

  const state = getState({
    available,
    disabled,
    verifiedMappings,
    totalMappings,
  });
  const Icon =
    state === 'active' ? ShieldCheck : state === 'disabled' ? Link2Off : Link2;
  const label =
    state === 'active'
      ? tt('cloudStorage.lanBridgeActive', {
          verified: verifiedMappings,
          total: totalMappings,
        })
      : state === 'disabled'
        ? s.lanBridgeDisabled
        : s.lanBridgeSetupAvailable;

  const content = (
    <>
      <Icon className="size-3.5" />
      <span className="truncate">{label}</span>
    </>
  );

  const classes = cn(
    'inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
    state === 'active' &&
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    state === 'available' &&
      'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    state === 'disabled' && 'border-border bg-muted text-muted-foreground',
    onClick && 'hover:bg-muted/70 cursor-pointer',
    className,
  );

  if (!onClick) {
    return <span className={classes}>{content}</span>;
  }

  return (
    <button type="button" className={classes} onClick={onClick}>
      {content}
    </button>
  );
}

function getState(input: {
  available: boolean;
  disabled: boolean;
  verifiedMappings: number;
  totalMappings: number;
}): 'active' | 'available' | 'disabled' {
  if (input.disabled || !input.available) return 'disabled';
  if (input.verifiedMappings > 0 && input.totalMappings > 0) return 'active';
  return 'available';
}
