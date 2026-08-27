import { useLanguage } from '@/shared/providers/language-provider';
import type { ExecutionOutcomeSummary } from '@/shared/stores/run-tree-store';
import type {
  DiagnosticValue,
  ExecutionDiagnosticsV1,
} from '@/shared/types/execution-diagnostics';

import { useDiagnosticsLabels } from './useDiagnosticsLabels';

function displayValue<T>(
  value: DiagnosticValue<T>,
  unavailable: string,
  format: (available: T) => string = String,
): { value: string; missingReason?: string } {
  if (value.state === 'available') return { value: format(value.value) };
  return { value: unavailable, missingReason: value.missingReason };
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: { value: string; missingReason?: string };
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground truncate text-[11px]">{label}</dt>
      <dd className="text-foreground truncate text-xs font-medium">
        {value.value}
      </dd>
      {value.missingReason ? (
        <dd className="text-muted-foreground mt-0.5 text-[10px] leading-tight">
          {value.missingReason}
        </dd>
      ) : null}
    </div>
  );
}

export function DiagnosticsGrid({
  diagnostics,
  outcome,
}: {
  diagnostics: ExecutionDiagnosticsV1;
  outcome?: ExecutionOutcomeSummary;
}) {
  const { t } = useLanguage();
  const labels = useDiagnosticsLabels();
  const unavailable = labels.unavailable;
  const milliseconds = (value: number) => `${Math.round(value)} ms`;
  const number = (value: number) => value.toLocaleString();
  const recoveryLabels: Record<
    NonNullable<ExecutionOutcomeSummary['recoveryActions'][number]>,
    string
  > = {
    retry: t.task.retry,
    continue: t.task.continueRun,
    answer_question: t.task.answeredQuestion,
    switch_runtime: t.task.configureModel,
    resume_after_restart: t.task.resumeSession,
  };
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      <Metric
        label={`${labels.timing} · model`}
        value={displayValue(
          diagnostics.timing.model_call,
          unavailable,
          milliseconds,
        )}
      />
      <Metric
        label={labels.tools}
        value={displayValue(diagnostics.tools.total, unavailable, number)}
      />
      <Metric
        label={labels.environment}
        value={displayValue(diagnostics.environment.runtimeId, unavailable)}
      />
      <Metric
        label={t.task.runSummaryModel}
        value={displayValue(diagnostics.environment.resolvedModel, unavailable)}
      />
      <Metric
        label={labels.usage}
        value={displayValue(diagnostics.usage.inputTokens, unavailable, number)}
      />
      <Metric
        label={labels.files}
        value={displayValue(
          diagnostics.artifactDelivery.producedFileCount,
          unavailable,
          number,
        )}
      />
      <Metric
        label={labels.attempts}
        value={displayValue(
          diagnostics.environment.attempt,
          unavailable,
          (value) => String(value + 1),
        )}
      />
      <Metric
        label={labels.continuations}
        value={displayValue(
          diagnostics.environment.continuationAttempts,
          unavailable,
          number,
        )}
      />
      <Metric
        label={labels.delivery}
        value={displayValue(diagnostics.artifactDelivery.verdict, unavailable)}
      />
      {outcome ? (
        <Metric
          label={labels.recovery}
          value={{
            value:
              outcome.recoveryActions.length > 0
                ? outcome.recoveryActions
                    .map((action) => recoveryLabels[action])
                    .join(', ')
                : '0',
          }}
        />
      ) : null}
    </div>
  );
}
