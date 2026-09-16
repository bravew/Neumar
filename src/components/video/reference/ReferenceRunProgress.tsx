import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoReferenceRun,
  VideoReferenceRunStep,
  VideoReferenceRunStepStatus,
} from '@/shared/types/video';

interface ReferenceRunProgressProps {
  run: VideoReferenceRun;
}

export function ReferenceRunProgress({ run }: ReferenceRunProgressProps) {
  const { t } = useLanguage();
  return (
    <ol className="space-y-2" aria-live="polite">
      {run.steps.map((step) => (
        <li
          key={step.id}
          className="border-border bg-background rounded-md border px-2 py-1.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-foreground text-xs font-medium">
              {t.video.reference.steps[step.id]}
            </span>
            <span className="text-muted-foreground text-[10px] uppercase">
              {statusLabel(t, step.status)}
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            {elapsedLabel(step)}
            {step.producedArtifactIds.length > 0
              ? ` · ${step.producedArtifactIds.join(', ')}`
              : ''}
          </p>
          {step.note ? (
            <p className="text-foreground mt-1 text-[11px]">{step.note}</p>
          ) : null}
          {step.error ? (
            <p className="text-destructive mt-1 text-[11px]">
              {step.error.message}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function statusLabel(
  t: ReturnType<typeof useLanguage>['t'],
  status: VideoReferenceRunStepStatus,
): string {
  return t.video.reference.status[status];
}

function elapsedLabel(step: VideoReferenceRunStep): string {
  if (!step.startedAt) return '—';
  const end = step.endedAt ? Date.parse(step.endedAt) : Date.now();
  const start = Date.parse(step.startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return '—';
  }
  return `${Math.max(0, Math.round((end - start) / 1000))}s`;
}
