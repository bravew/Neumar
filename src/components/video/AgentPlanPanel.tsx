import { useCallback, useEffect, useMemo, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import type { VideoAgentPlan, VideoAgentPlanStep } from '@/shared/types/video';

type ExecutionPhase =
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'partial-success'
  | 'skipped'
  | 'rolled-back';

interface ExecutionRecord {
  sequence: number;
  stepId: string;
  attempt: number;
  phase: ExecutionPhase;
  operation: string;
  projectRevisionAfter?: number;
  journalEntryIds?: string[];
  verification?: Record<string, unknown>;
  error?: { code: string; message: string; committed: boolean };
}

interface PlanProgress {
  status: 'ready' | 'complete' | 'paused';
  projectRevision: number;
  expectedProjectRevision: number;
  nextStep?: VideoAgentPlanStep;
  reason?: string;
  uncertainOperations: Array<{
    stepId: string;
    operation: string;
    attempt: number;
  }>;
}

interface PanelData {
  plan?: VideoAgentPlan;
  drifted: boolean;
  progress?: PlanProgress;
  records: ExecutionRecord[];
}

export interface AgentPlanPanelLabels {
  title: string;
  plan: string;
  executionLog: string;
  refresh: string;
  loading: string;
  loadFailed: string;
  driftWarning: string;
  revisionWarning: string;
  nextStep: string;
  step: string;
  attempt: string;
  verification: string;
  committed: string;
  yes: string;
  no: string;
  noRecords: string;
  resume: string;
  retry: string;
  rollback: string;
  confirmRetry: string;
  confirmRollback: string;
  resumePrompt: string;
  retryPrompt: string;
  statuses: Record<VideoAgentPlan['status'], string>;
  phases: Record<ExecutionPhase, string>;
}

interface AgentPlanPanelProps {
  projectId: string;
  projectRevision: number;
  disabled?: boolean;
  labels: AgentPlanPanelLabels;
  onSend: (prompt: string) => void;
  onRollback: (journalEntryId: string) => void;
}

export function AgentPlanPanel({
  projectId,
  projectRevision,
  disabled,
  labels,
  onSend,
  onRollback,
}: AgentPlanPanelProps) {
  const [data, setData] = useState<PanelData>();
  const [error, setError] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const refresh = useCallback(() => setRefreshNonce((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void Promise.all([
      fetch(
        `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/agent-plan`,
        { signal: controller.signal },
      ),
      fetch(
        `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/execution-log?limit=100`,
        { signal: controller.signal },
      ),
    ])
      .then(async ([planResponse, logResponse]) => {
        if (!planResponse.ok || !logResponse.ok) throw new Error('load failed');
        const plan = (await planResponse.json()) as Omit<PanelData, 'records'>;
        const log = (await logResponse.json()) as {
          records: ExecutionRecord[];
        };
        setData({ ...plan, records: log.records });
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(true);
        }
      });
    return () => controller.abort();
  }, [projectId, projectRevision, refreshNonce]);

  const records = data?.records ?? [];
  const latest = records.at(-1);
  const terminal = useMemo(
    () => [...records].reverse().find((record) => record.phase !== 'started'),
    [records],
  );
  const rollbackId = terminal?.journalEntryIds?.at(-1);
  const retryable =
    terminal?.phase === 'failed' || terminal?.phase === 'partial-success';
  if (!data?.plan && !error) return null;

  const conflict =
    data?.progress?.status === 'paused' &&
    data.progress.projectRevision !== data.progress.expectedProjectRevision;
  return (
    <section className="border-border/60 bg-muted/15 mb-2 rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold">{labels.title}</h3>
        {data?.plan ? (
          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">
            {labels.statuses[data.plan.status]} · v{data.plan.revision}
          </span>
        ) : null}
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground ml-auto text-[10px]"
          onClick={refresh}
        >
          {labels.refresh}
        </button>
      </div>
      {error ? (
        <p className="text-destructive mt-2 text-[11px]">{labels.loadFailed}</p>
      ) : null}
      {data?.drifted ? (
        <p className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
          {labels.driftWarning}
        </p>
      ) : null}
      {conflict ? (
        <p className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
          {labels.revisionWarning} {data?.progress?.reason}
        </p>
      ) : null}
      {data?.plan ? (
        <details className="mt-2 text-[11px]">
          <summary className="cursor-pointer font-medium">
            {labels.plan}
          </summary>
          <p className="text-muted-foreground mt-1">{data.plan.request}</p>
          <ol className="mt-1 space-y-1 pl-4">
            {data.plan.steps.map((step) => (
              <li key={step.id} className="list-decimal">
                <span className="font-medium">{step.title}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {step.operation}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <details className="mt-2 text-[11px]" open={Boolean(latest?.error)}>
        <summary className="cursor-pointer font-medium">
          {labels.executionLog}
        </summary>
        {records.length === 0 ? (
          <p className="text-muted-foreground mt-1">{labels.noRecords}</p>
        ) : (
          <div className="mt-1 space-y-1">
            {records.slice(-8).map((record) => (
              <ExecutionRow
                key={record.sequence}
                record={record}
                labels={labels}
              />
            ))}
          </div>
        )}
      </details>
      {data?.progress?.nextStep ? (
        <p className="text-muted-foreground mt-2 text-[11px]">
          {labels.nextStep}: {data.progress.nextStep.title}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {data?.progress?.status === 'ready' ? (
          <ActionButton
            disabled={disabled}
            onClick={() =>
              onSend(
                fillPrompt(labels.resumePrompt, data.progress!.nextStep?.id),
              )
            }
          >
            {labels.resume}
          </ActionButton>
        ) : null}
        {retryable && terminal ? (
          <ActionButton
            disabled={disabled}
            onClick={() => {
              if (window.confirm(labels.confirmRetry)) {
                onSend(fillPrompt(labels.retryPrompt, terminal.stepId));
              }
            }}
          >
            {labels.retry}
          </ActionButton>
        ) : null}
        {rollbackId ? (
          <ActionButton
            disabled={disabled}
            onClick={() => {
              if (window.confirm(labels.confirmRollback))
                onRollback(rollbackId);
            }}
          >
            {labels.rollback}
          </ActionButton>
        ) : null}
      </div>
    </section>
  );
}

function ExecutionRow({
  record,
  labels,
}: {
  record: ExecutionRecord;
  labels: AgentPlanPanelLabels;
}) {
  return (
    <div
      className={cn(
        'rounded border px-2 py-1',
        record.phase === 'partial-success' &&
          'border-amber-500/40 bg-amber-500/10',
        record.phase === 'failed' && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <div className="flex gap-2">
        <span>{labels.phases[record.phase]}</span>
        <span className="text-muted-foreground ml-auto">
          {labels.step} {record.stepId} · {labels.attempt} {record.attempt}
        </span>
      </div>
      {record.verification ? (
        <p className="text-muted-foreground">
          {labels.verification}: {JSON.stringify(record.verification)}
        </p>
      ) : null}
      {record.error ? (
        <p className="text-destructive">
          {record.error.message} · {labels.committed}:{' '}
          {record.error.committed ? labels.yes : labels.no}
        </p>
      ) : null}
    </div>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="border-border hover:bg-accent rounded border px-2 py-1 text-[11px] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function fillPrompt(template: string, stepId?: string): string {
  return template.replace('{step}', stepId ?? 'next');
}
