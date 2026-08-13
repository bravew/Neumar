import { Play } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignRoutine } from '@/shared/types/design-mode';

export function RoutineRow({
  routine,
  runStatus,
  highlighted,
  rowRef,
  onRun,
  onToggle,
}: {
  routine: DesignRoutine;
  runStatus?: string;
  highlighted?: boolean;
  rowRef?: (node: HTMLElement | null) => void;
  onRun: () => void;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  return (
    <article
      ref={rowRef}
      tabIndex={highlighted ? -1 : undefined}
      className={cn(
        'rounded-md border p-4 transition-colors',
        highlighted && 'border-primary bg-primary/5 ring-primary/30 ring-2',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{routine.name}</h3>
          <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
            {routine.prompt}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs',
            routine.enabled
              ? 'bg-emerald-500/10 text-emerald-700'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {routine.enabled ? t.settings.enabled : t.settings.disabled}
        </span>
      </div>
      <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>{t.design.surfaces[routine.surface]}</span>
        <span>
          {routine.targetMode === 'new_project'
            ? t.design.routines.targetNewProject
            : t.design.routines.targetExistingProject}
        </span>
        <span>
          {routine.nextRunAt
            ? t.design.routines.nextRun.replace(
                '{time}',
                new Date(routine.nextRunAt).toLocaleString(),
              )
            : t.design.routines.manualOnly}
        </span>
      </div>
      {routine.lastRunSummary && (
        <p className="text-muted-foreground mt-2 text-xs">
          {routine.lastRunSummary}
        </p>
      )}
      {routine.lastRunError && (
        <p className="text-destructive mt-2 text-xs">
          {t.design.routines.failureReason.replace(
            '{reason}',
            () => routine.lastRunError ?? '',
          )}
        </p>
      )}
      {runStatus && <p className="mt-2 text-xs">{runStatus}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRun}
          className="border-input bg-background hover:bg-accent inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm"
        >
          <Play className="size-3.5" />
          {t.design.routines.runNow}
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="border-input bg-background hover:bg-accent h-8 rounded-md border px-3 text-sm"
        >
          {routine.enabled
            ? t.design.routines.disable
            : t.design.routines.enable}
        </button>
      </div>
    </article>
  );
}
