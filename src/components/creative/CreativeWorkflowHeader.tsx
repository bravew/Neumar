import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleDot,
} from 'lucide-react';

import type {
  CreativeWorkflowState,
  CreativeWorkflowStep,
  CreativeWorkflowStepState,
} from '@/shared/creative-workflow';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface CreativeWorkflowHeaderProps {
  workflow: CreativeWorkflowState;
  onPrimaryAction?: () => void;
  onStepSelect?: (step: CreativeWorkflowStep) => void;
  /**
   * The step currently on screen. Distinct from each step's *status*: a step
   * can be "not started" and still be what you are looking at. Without this
   * the row is navigation that never acknowledges being navigated.
   */
  selectedStep?: CreativeWorkflowStep;
}

export function CreativeWorkflowHeader({
  workflow,
  onPrimaryAction,
  onStepSelect,
  selectedStep,
}: CreativeWorkflowHeaderProps) {
  const { t } = useLanguage();
  const primaryDisabled = workflow.primaryAction.disabled || !onPrimaryAction;
  const assetSummary = t.creative.workflowHeader.assetSummary
    .replace('{count}', String(workflow.assetSummary.total))
    .replace('{generated}', String(workflow.assetSummary.generated));

  return (
    <section
      className="border-border bg-muted/20 flex shrink-0 flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center"
      data-testid="creative-workflow-header"
      aria-label={t.creative.workflowHeader.label}
    >
      <div className="min-w-0 lg:w-56">
        <p className="text-muted-foreground text-xs font-medium">
          {t.creative.workflowHeader.current}
        </p>
        <h2 className="text-foreground truncate text-sm font-semibold">
          {t.creative.workflowStep[selectedStep ?? workflow.currentStep]}
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">{assetSummary}</p>
      </div>
      <ol className="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="list">
        {workflow.steps.map((step) => (
          <li key={step.step} className="min-w-24 flex-1">
            <WorkflowStepPill
              step={step}
              label={t.creative.workflowStep[step.step]}
              statusLabel={t.creative.workflowStatus[step.status]}
              selected={step.step === selectedStep}
              onSelect={onStepSelect}
            />
          </li>
        ))}
      </ol>
      <button
        type="button"
        disabled={primaryDisabled}
        onClick={onPrimaryAction}
        className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex shrink-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="truncate">
          {t.creative.workflowAction[workflow.primaryAction.id]}
        </span>
        <ArrowRight className="size-4 shrink-0" />
      </button>
    </section>
  );
}

function WorkflowStepPill({
  step,
  label,
  statusLabel,
  selected = false,
  onSelect,
}: {
  step: CreativeWorkflowStepState;
  label: string;
  statusLabel: string;
  selected?: boolean;
  onSelect?: (step: CreativeWorkflowStep) => void;
}) {
  const content = (
    <>
      <StatusIcon status={step.status} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="sr-only">{statusLabel}</span>
      <span className="text-muted-foreground hidden text-[10px] xl:inline">
        {statusLabel}
      </span>
    </>
  );
  const className = cn(
    'border-border bg-background text-muted-foreground flex w-full items-center gap-1.5 rounded-md border px-2.5 py-2 text-left text-xs',
    step.status === 'active' && 'border-primary text-foreground',
    step.status === 'complete' && 'text-foreground',
    (step.status === 'failed' || step.status === 'blocked') &&
      'border-destructive/50 text-destructive',
    // Selection is where you are, so it has to win visually over status.
    selected && 'bg-accent text-foreground ring-primary shadow-sm ring-2',
    onSelect && 'hover:bg-accent cursor-pointer',
  );
  const accessibleName = `${label}: ${statusLabel}`;

  if (!onSelect) {
    return (
      <div
        className={className}
        aria-label={accessibleName}
        aria-current={selected ? 'step' : undefined}
        data-status={step.status}
        data-selected={selected || undefined}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={accessibleName}
      aria-current={selected ? 'step' : undefined}
      aria-pressed={selected}
      data-status={step.status}
      data-selected={selected || undefined}
      onClick={() => onSelect(step.step)}
    >
      {content}
    </button>
  );
}

function StatusIcon({
  status,
}: {
  status: CreativeWorkflowStepState['status'];
}) {
  if (status === 'complete') {
    return <CheckCircle2 className="size-3.5 shrink-0" />;
  }
  if (status === 'active') {
    return <CircleDot className="size-3.5 shrink-0" />;
  }
  if (status === 'failed' || status === 'blocked') {
    return <AlertTriangle className="size-3.5 shrink-0" />;
  }
  return <Circle className="size-3.5 shrink-0" />;
}
