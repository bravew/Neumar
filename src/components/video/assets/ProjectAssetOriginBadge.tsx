import { Link2, Link2Off } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface ProjectAssetOriginBadgeProps {
  /** Absent for managed assets — this badge only speaks about linked ones. */
  origin: 'managed' | 'external' | undefined;
  /** False once a status check found the master unreachable. */
  online: boolean;
}

/**
 * Marks an asset whose master is the user's own file, kept where they put it.
 *
 * Worth a badge because the tradeoff is real and invisible otherwise: the
 * project takes almost no disk, but it depends on storage this app does not
 * control. When that storage goes away the badge is how the user finds out —
 * at edit time, rather than when a render fails.
 */
export function ProjectAssetOriginBadge({
  origin,
  online,
}: ProjectAssetOriginBadgeProps) {
  const { t } = useLanguage();
  if (origin !== 'external') return null;
  const labels = t.video.editor.assetsRail;
  const Icon = online ? Link2 : Link2Off;
  const label = online ? labels.linkedAsset : labels.offlineAsset;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 text-[9px] font-semibold',
        online
          ? 'bg-muted text-muted-foreground'
          : 'bg-destructive text-destructive-foreground',
      )}
      title={label}
      aria-label={label}
    >
      <Icon className="size-2.5" aria-hidden />
    </span>
  );
}
