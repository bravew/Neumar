import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoReferenceRun,
  VideoReferenceRunStep,
} from '@/shared/types/video';

import { completedStepCount, currentStep } from './useReferenceStudyStore';

interface ReferenceRunSummaryProps {
  run: VideoReferenceRun;
}

/**
 * One-line run state: a step-dot rail, a done/total count, and the step in
 * flight. Renders inline in the Reference tab so progress is visible without
 * opening anything, with the owner of the current step named — that is what
 * tells the user whether the panel or the chat is doing the work right now.
 */
export function ReferenceRunSummary({ run }: ReferenceRunSummaryProps) {
  const { t } = useLanguage();
  const labels = t.video.reference;
  const done = completedStepCount(run);
  const active = currentStep(run);
  const skippedCount = run.steps.filter(
    (step) => step.status === 'skipped',
  ).length;
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex items-center gap-2">
        <ol className="flex flex-1 items-center gap-1">
          {run.steps.map((step) => (
            <li
              key={step.id}
              title={`${labels.steps[step.id]} · ${labels.status[step.status]}`}
              className={cn('h-1.5 flex-1 rounded-full', dotClass(step))}
            />
          ))}
        </ol>
        <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
          {done}/{run.steps.length}
        </span>
      </div>
      <p className="text-muted-foreground text-[11px]">
        {active
          ? `${labels.steps[active.id]} · ${labels.owner[active.owner]}`
          : labels.status[run.status]}
      </p>
      {skippedCount > 0 ? (
        <p className="text-muted-foreground text-[11px]">
          {labels.skippedNote.replace('{count}', String(skippedCount))}
        </p>
      ) : null}
    </div>
  );
}

function dotClass(step: VideoReferenceRunStep): string {
  switch (step.status) {
    case 'done':
      return 'bg-primary';
    case 'skipped':
      return 'bg-muted-foreground/30';
    case 'waiting':
      return 'bg-amber-500/70';
    case 'running':
      return 'bg-primary animate-pulse';
    case 'error':
      return 'bg-destructive';
    case 'cancelled':
      return 'bg-muted-foreground/40';
    default:
      return 'bg-border';
  }
}
