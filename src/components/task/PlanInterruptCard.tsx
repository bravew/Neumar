import type { Interrupt } from '@ag-ui/core';
import { useInterrupt } from '@copilotkit/react-core/v2';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface PlanStepMetadata {
  id: string;
  description: string;
  status: string;
}

interface PlanDecisionMetadata {
  kind?: string;
  plan?: {
    id?: string;
    goal?: string;
    steps?: PlanStepMetadata[];
  };
}

/**
 * Plan approval card for the standard AG-UI interrupt flow.
 *
 * The planning run ends with `RUN_FINISHED.outcome.type === 'interrupt'`; this
 * card answers the interrupt named in `interrupt.id`. `resolve` submits the
 * standard `resume` entry; `cancel` submits `status: 'cancelled'`. Both are
 * bound to that id, so a stale card cannot approve a newer plan.
 *
 * The live task surface renders its own progress card (TaskV2Thread); this
 * component is the shared standard-card reference for decision surfaces.
 */
export function PlanInterruptCard() {
  const { t } = useLanguage();

  const element = useInterrupt({
    renderInChat: false,
    enabled: (event) => {
      const value = event.value as Interrupt | undefined;
      return value?.reason === 'plan_approval';
    },
    render: ({ interrupt, resolve, cancel }) => {
      const decision = interrupt?.metadata?.decision as
        | PlanDecisionMetadata
        | undefined;
      const plan = decision?.plan;
      const steps = plan?.steps ?? [];

      return (
        <div className="border-border bg-muted/30 mx-4 my-2 rounded-lg border p-3 text-sm">
          <p className="text-foreground mb-2 font-medium">
            {plan?.goal ?? interrupt?.message ?? (t.approvals?.title || '')}
          </p>
          {steps.length > 0 && (
            <ol className="mb-3 space-y-1">
              {steps.map((step, i) => (
                <li
                  key={step.id ?? i}
                  className="text-muted-foreground flex items-start gap-2"
                >
                  <span className="shrink-0 font-mono text-xs">{i + 1}.</span>
                  <span>{step.description}</span>
                </li>
              ))}
            </ol>
          )}
          <div className="flex gap-2">
            <button
              onClick={() =>
                void resolve({ approved: true }, interrupt?.id ?? undefined)
              }
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              {t.approvals?.approve ?? 'Approve'}
            </button>
            <button
              onClick={() =>
                void resolve({ approved: false }, interrupt?.id ?? undefined)
              }
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                'border-destructive/50 text-destructive hover:bg-destructive/10 border',
              )}
            >
              {t.approvals?.reject ?? 'Reject'}
            </button>
            <button
              onClick={() => void cancel(interrupt?.id ?? undefined)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                'border-border text-muted-foreground hover:bg-muted border',
              )}
            >
              {t.approvals?.cancel ?? 'Cancel'}
            </button>
          </div>
        </div>
      );
    },
  });

  return <>{element}</>;
}
