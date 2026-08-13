import { useLanguage } from '@/shared/providers/language-provider';

type CapabilityState = 'configured' | 'unsupported' | 'needs-setup';

export function MediaCapabilityBadge({ state }: { state: CapabilityState }) {
  const { t } = useLanguage();
  const color =
    state === 'configured'
      ? 'bg-emerald-500'
      : state === 'unsupported'
        ? 'bg-muted-foreground'
        : 'bg-amber-500';
  const label =
    state === 'configured'
      ? t.design.capability.configured
      : state === 'unsupported'
        ? t.design.capability.unsupported
        : t.design.capability.needsSetup;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={`size-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
