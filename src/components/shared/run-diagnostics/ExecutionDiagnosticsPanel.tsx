import { useEffect, useState } from 'react';

import { Activity, ChevronDown, Download, Loader2 } from 'lucide-react';

import { API_BASE_URL, EXECUTION_DIAGNOSTICS_UI_ENABLED } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  type ExecutionOutcomeSummary,
  useRunTreeStore,
} from '@/shared/stores/run-tree-store';
import type { ExecutionDiagnosticsV1 } from '@/shared/types/execution-diagnostics';

import { DiagnosticsGrid } from './DiagnosticsGrid';
import { useSupportBundleExport } from './use-support-bundle-export';
import { useDiagnosticsLabels } from './useDiagnosticsLabels';

const DIAGNOSTICS_REQUEST_TIMEOUT_MS = 12_000;

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
    // A local GET that outlives this has not been served slowly, it has been
    // queued behind the browser's per-host connection cap. Time it out so the
    // socket is freed and the panel settles instead of spinning forever.
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DIAGNOSTICS_REQUEST_TIMEOUT_MS);
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
        // An abort we did not schedule is the unmount cleanup — leave state be.
        const aborted = reason instanceof Error && reason.name === 'AbortError';
        if (aborted && !timedOut) return;
        failed = true;
        setError(true);
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (!failed && controller.signal.aborted) return;
        setLoading(false);
      });
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
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
    // The store owns this request's lifetime — it is shared between every
    // consumer of the same owner key and bounded by its own timeout, so a
    // signal from this component would cancel it for the others too.
    void fetchOwner(mode, ownerKey);
  }, [fetchOwner, mode, ownerKey]);

  if (ownerTree?.loading && ownerTree.tree.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        {t.task.runDiagnosticsLoading}
      </p>
    );
  }
  if (ownerTree?.error && ownerTree.executions.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        {t.task.runDiagnosticsFailedLoad}
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
