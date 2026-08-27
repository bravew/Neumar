import { ArrowRight, CheckCircle2 } from 'lucide-react';

import type { CreativeWorkflowState } from '@/shared/creative-workflow';
import { useLanguage } from '@/shared/providers/language-provider';

/**
 * How far the project has come, and the one thing to do next.
 *
 * Deliberately not navigable. The editor tabs are the only way to move between
 * canvases; a second clickable row of stages read as a competing stepper, and
 * because several stages share a canvas it could never agree with the tabs
 * about where the user was.
 */
export function VideoWorkflowSummary({
  workflow,
  onPrimaryAction,
}: {
  workflow: CreativeWorkflowState;
  onPrimaryAction?: () => void;
}) {
  const { t } = useLanguage();
  const done = workflow.steps.filter(
    (step) => step.status === 'complete',
  ).length;
  const total = workflow.steps.length;
  const failed = workflow.steps.find((step) => step.status === 'failed');

  return (
    <section
      className="border-border bg-muted/20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2"
      data-testid="video-workflow-summary"
      aria-label={t.creative.workflowHeader.label}
    >
      <span className="flex items-center gap-1.5 text-xs">
        <CheckCircle2 className="text-muted-foreground size-3.5" />
        <span className="text-muted-foreground">
          {t.video.editor.workflowSummary.progress
            .replace('{done}', String(done))
            .replace('{total}', String(total))}
        </span>
      </span>
      <span
        className={
          failed
            ? 'text-destructive text-xs font-medium'
            : 'text-foreground text-xs font-medium'
        }
      >
        {failed
          ? t.video.editor.workflowSummary.blocked.replace(
              '{stage}',
              t.creative.workflowStep[failed.step],
            )
          : t.creative.workflowStep[workflow.currentStep]}
      </span>
      {onPrimaryAction ? (
        <button
          type="button"
          disabled={workflow.primaryAction.disabled}
          onClick={onPrimaryAction}
          className="bg-primary text-primary-foreground hover:bg-primary/90 ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="truncate">
            {t.creative.workflowAction[workflow.primaryAction.id]}
          </span>
          <ArrowRight className="size-3.5 shrink-0" />
        </button>
      ) : null}
    </section>
  );
}
