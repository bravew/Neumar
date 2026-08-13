import { useInterrupt } from '@copilotkit/react-core/v2';

import type { TaskPlan } from '@/shared/hooks/agent-types';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface PlanInterruptValue {
  type: 'plan_approval';
  plan: TaskPlan;
  runId: string;
}

/**
 * Plan approval card using CopilotKit's useInterrupt hook.
 *
 * Renders outside the chat message list (renderInChat: false).
 * Appears when the agent emits a CUSTOM 'on_interrupt' event with
 * type: 'plan_approval'. The user approves or rejects, and resolve()
 * resumes the agent with { approved: true/false }.
 *
 * Flow: agent emits on_interrupt → RUN_FINISHED → useInterrupt surfaces UI
 *       → user clicks → resolve() → copilotkit.runAgent() with
 *       forwardedProps.command.resume → backend maps to activeQueryStore.pushReply()
 */
export function PlanInterruptCard() {
  const { t } = useLanguage();

  const element = useInterrupt<PlanInterruptValue, false>({
    renderInChat: false,
    enabled: (event) => event.value?.type === 'plan_approval',
    render: ({ event, resolve }) => {
      const value = event.value as PlanInterruptValue;
      const plan = value.plan;

      return (
        <div className="border-border bg-muted/30 mx-4 my-2 rounded-lg border p-3 text-sm">
          <p className="text-foreground mb-2 font-medium">
            {plan.goal ?? (t.approvals?.title || '')}
          </p>
          {plan.steps && plan.steps.length > 0 && (
            <ol className="mb-3 space-y-1">
              {plan.steps.map((step, i) => (
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
              onClick={() => resolve({ approved: true })}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              {t.approvals?.approve ?? 'Approve'}
            </button>
            <button
              onClick={() => resolve({ approved: false })}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                'border-destructive/50 text-destructive hover:bg-destructive/10 border',
              )}
            >
              {t.approvals?.reject ?? 'Reject'}
            </button>
          </div>
        </div>
      );
    },
  });

  return <>{element}</>;
}
