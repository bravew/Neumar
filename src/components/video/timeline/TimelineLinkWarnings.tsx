import { RefreshCw, Unlink, X } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

import type { TimelineTrackLabels } from './TimelineLabels';
import type { TimelineLinkGroupStatus } from './timelineLinkGroups';
import type { TimelineEditWarning } from './useTimelineEditorStore';

interface TimelineLinkWarningsProps {
  blockedWarning: TimelineEditWarning | null;
  outOfSyncGroups: TimelineLinkGroupStatus[];
  labels: Pick<
    TimelineTrackLabels,
    | 'clearWarning'
    | 'resyncGroup'
    | 'syncLockBlocked'
    | 'unlinkGroup'
    | 'outOfSyncGroup'
  >;
  onClearWarning: () => void;
  onResyncGroup: (linkGroupId: string) => void;
  onUnlinkGroup: (linkGroupId: string) => void;
}

export function TimelineLinkWarnings({
  blockedWarning,
  outOfSyncGroups,
  labels,
  onClearWarning,
  onResyncGroup,
  onUnlinkGroup,
}: TimelineLinkWarningsProps) {
  if (!blockedWarning && outOfSyncGroups.length === 0) return null;
  return (
    <div className="border-border bg-background/95 sticky top-0 z-30 border-b px-3 py-2 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {blockedWarning ? (
          <WarningPill
            text={labels.syncLockBlocked
              .replace('{count}', String(blockedWarning.clipIds.length))
              .replace('{tracks}', blockedWarning.trackIds.join(', '))}
            onClear={onClearWarning}
            clearLabel={labels.clearWarning}
          />
        ) : null}
        {outOfSyncGroups.map((group) => (
          <div
            key={group.linkGroupId}
            className={cn(
              'border-border text-muted-foreground flex items-center gap-2 rounded-md border px-2 py-1 text-[11px]',
              group.syncLocked && 'border-amber-500/50 text-amber-700',
            )}
          >
            <span>
              {labels.outOfSyncGroup
                .replace('{group}', group.linkGroupId)
                .replace('{drift}', String(group.driftMs))}
            </span>
            <button
              type="button"
              className="hover:text-foreground inline-flex items-center gap-1"
              onClick={() => onResyncGroup(group.linkGroupId)}
            >
              <RefreshCw className="size-3" />
              <span>{labels.resyncGroup}</span>
            </button>
            <button
              type="button"
              className="hover:text-destructive inline-flex items-center gap-1"
              onClick={() => onUnlinkGroup(group.linkGroupId)}
            >
              <Unlink className="size-3" />
              <span>{labels.unlinkGroup}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function WarningPill({
  clearLabel,
  onClear,
  text,
}: {
  clearLabel: string;
  onClear: () => void;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/50 px-2 py-1 text-[11px] text-amber-700">
      <span>{text}</span>
      <button
        type="button"
        className="hover:text-foreground"
        aria-label={clearLabel}
        onClick={onClear}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
