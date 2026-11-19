import { Check, Circle, ListTodo, Loader2, X } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { PlanActivity } from './planActivity';

function StepIcon({ status }: { status: string }) {
  if (status === 'completed') {
    return <Check className="size-3 shrink-0 text-emerald-500" aria-hidden />;
  }
  if (status === 'in_progress') {
    return (
      <Loader2
        className="text-primary size-3 shrink-0 animate-spin motion-reduce:animate-none"
        aria-hidden
      />
    );
  }
  if (status === 'failed') {
    return <X className="text-destructive size-3 shrink-0" aria-hidden />;
  }
  return (
    <Circle className="text-muted-foreground size-3 shrink-0" aria-hidden />
  );
}

/**
 * The plan/checklist activity for the V2 thread: one widget per plan id,
 * replaced when its execution run starts and patched when the work ends.
 *
 * It is not interactive — approval stays in the plan interrupt card — so a
 * patch cannot disturb focus or collapse state. Step state is carried by an
 * icon plus a visually hidden label rather than an announcement region.
 */
export function PlanActivityWidget({ plan }: { plan: PlanActivity }) {
  const { t } = useLanguage();
  const phaseLabel =
    plan.phase === 'awaiting_approval'
      ? t.task.planAwaitingApproval
      : plan.phase === 'running'
        ? t.task.planInProgress
        : plan.phase === 'failed'
          ? t.task.planFailed
          : plan.phase === 'cancelled'
            ? t.task.planCancelled
            : t.task.planCompleted;
  const stepLabel = (status: string) =>
    status === 'completed'
      ? t.task.planCompleted
      : status === 'in_progress'
        ? t.task.planInProgress
        : status === 'failed'
          ? t.task.planFailed
          : t.task.planStepPending;

  return (
    <div className="mx-auto max-w-4xl px-4 py-2">
      <section
        aria-label={t.task.planTitle}
        className="border-border/60 bg-muted/20 rounded-lg border p-3 text-sm"
      >
        <div className="mb-2 flex items-center gap-2">
          <ListTodo className="text-primary size-4 shrink-0" aria-hidden />
          <span className="text-foreground min-w-0 truncate font-medium">
            {plan.goal}
          </span>
          <span className="text-muted-foreground ml-auto shrink-0 text-xs">
            {phaseLabel}
          </span>
        </div>
        <ol className="space-y-1">
          {plan.steps.map((step, index) => (
            <li
              key={step.id ?? index}
              className="flex items-start gap-2 text-xs"
            >
              <StepIcon status={step.status} />
              <span
                className={cn(
                  'min-w-0 flex-1',
                  step.status === 'completed'
                    ? 'text-muted-foreground'
                    : 'text-foreground',
                )}
              >
                {step.description}
              </span>
              <span className="sr-only">{stepLabel(step.status)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
