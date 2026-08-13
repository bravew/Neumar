import { useEffect, useState } from 'react';

import { Activity, ChevronDown, Download, Loader2 } from 'lucide-react';

import { API_BASE_URL, EXECUTION_DIAGNOSTICS_UI_ENABLED } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  type ExecutionOutcomeSummary,
  useRunTreeStore,
} from '@/shared/stores/run-tree-store';
import type {
  DiagnosticValue,
  ExecutionDiagnosticsV1,
} from '@/shared/types/execution-diagnostics';

import { useSupportBundleExport } from './use-support-bundle-export';

function useDiagnosticsLabels() {
  const { t } = useLanguage();
  return {
    title: t.task.runDiagnosticsTitle,
    partial: t.task.runDiagnosticsPartial,
    timing: t.task.runDiagnosticsTiming,
    tools: t.task.runDiagnosticsTools,
    environment: t.task.runDiagnosticsEnvironment,
    usage: t.task.runDiagnosticsUsage,
    delivery: t.task.runDiagnosticsDelivery,
    unavailable: t.task.runDiagnosticsUnavailable,
    attempts: t.task.runDiagnosticsAttempts,
    continuations: t.task.runDiagnosticsContinuations,
    files: t.task.runDiagnosticsFiles,
    recovery: t.task.runDiagnosticsRecovery,
    loading: t.task.runDiagnosticsLoading,
    failedLoad: t.task.runDiagnosticsFailedLoad,
    exportBundle: t.task.runDiagnosticsExportBundle,
    exportingBundle: t.task.runDiagnosticsExportingBundle,
    exportFailed: t.task.runDiagnosticsExportFailed,
  };
}

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

export function ExecutionDiagnosticsPanel({
  runId,
  outcome,
  className,
}: {
  runId: string;
  outcome?: ExecutionOutcomeSummary;
  className?: string;
}) {
  if (!EXECUTION_DIAGNOSTICS_UI_ENABLED) return null;
  return (
    <EnabledExecutionDiagnosticsPanel
      runId={runId}
      outcome={outcome}
      className={className}
    />
  );
}

function EnabledExecutionDiagnosticsPanel({
  runId,
  outcome,
  className,
}: {
  runId: string;
  outcome?: ExecutionOutcomeSummary;
  className?: string;
}) {
  const labels = useDiagnosticsLabels();
  const [diagnostics, setDiagnostics] = useState<ExecutionDiagnosticsV1 | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const { exporting, exportError, exportSupportBundle } =
    useSupportBundleExport(runId, diagnostics);

  useEffect(() => {
    const controller = new AbortController();
    let failed = false;
    setLoading(true);
    setError(false);
    void fetch(
      `${API_BASE_URL}/runs/${encodeURIComponent(runId)}/diagnostics`,
      {
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setDiagnostics((await response.json()) as ExecutionDiagnosticsV1);
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        failed = true;
        setError(true);
      })
      .finally(() => {
        if (!failed && controller.signal.aborted) return;
        setLoading(false);
      });
    return () => controller.abort();
  }, [runId]);

  return (
    <details
      className={cn(
        'border-border/50 bg-muted/10 rounded-md border',
        className,
      )}
      data-testid="execution-diagnostics-panel"
    >
      <summary className="hover:bg-muted/40 flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-xs">
        <Activity className="text-muted-foreground size-3.5" />
        <span className="font-medium">{labels.title}</span>
        {diagnostics?.eventStreamCompleteness === 'partial' ? (
          <span className="text-amber-600 dark:text-amber-400">
            {labels.partial}
          </span>
        ) : null}
        {outcome ? (
          <span className="text-muted-foreground ml-auto">
            {labels.attempts}: {outcome.attemptCount}
          </span>
        ) : null}
        <ChevronDown className="text-muted-foreground size-3" />
      </summary>
      <div className="border-border/40 border-t p-2">
        {loading ? (
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <Loader2 className="size-3 animate-spin" /> {labels.loading}
          </p>
        ) : error || !diagnostics ? (
          <p className="text-muted-foreground text-xs">{labels.failedLoad}</p>
        ) : (
          <>
            <DiagnosticsGrid diagnostics={diagnostics} outcome={outcome} />
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className="border-border hover:bg-muted inline-flex items-center gap-1 rounded border px-2 py-1 text-xs"
                disabled={exporting}
                onClick={() => void exportSupportBundle()}
              >
                {exporting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Download className="size-3" />
                )}
                {exporting ? labels.exportingBundle : labels.exportBundle}
              </button>
              {exportError ? (
                <span className="text-destructive text-xs">
                  {labels.exportFailed}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function DiagnosticsGrid({
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

export function OwnerRunDiagnostics({
  mode,
  ownerKey,
  className,
}: {
  mode: 'design' | 'video';
  ownerKey: string;
  className?: string;
}) {
  if (!EXECUTION_DIAGNOSTICS_UI_ENABLED) return null;
  return (
    <EnabledOwnerRunDiagnostics
      mode={mode}
      ownerKey={ownerKey}
      className={className}
    />
  );
}

function EnabledOwnerRunDiagnostics({
  mode,
  ownerKey,
  className,
}: {
  mode: 'design' | 'video';
  ownerKey: string;
  className?: string;
}) {
  const { t } = useLanguage();
  const key = `${mode}:${ownerKey}`;
  const ownerTree = useRunTreeStore((state) => state.byOwner[key]);
  const fetchOwner = useRunTreeStore((state) => state.fetchOwner);

  useEffect(() => {
    const controller = new AbortController();
    void fetchOwner(mode, ownerKey, controller.signal);
    return () => controller.abort();
  }, [fetchOwner, mode, ownerKey]);

  if (ownerTree?.loading && ownerTree.tree.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        {t.task.runDiagnosticsLoading}
      </p>
    );
  }
  if (!ownerTree || ownerTree.executions.length === 0) return null;
  return (
    <div className={cn('space-y-2', className)}>
      {ownerTree.executions.map((outcome) => (
        <ExecutionDiagnosticsPanel
          key={outcome.executionId}
          runId={outcome.latestRunId}
          outcome={outcome}
        />
      ))}
    </div>
  );
}
