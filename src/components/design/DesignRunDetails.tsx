import {
  CheckCircle2,
  ChevronDown,
  ListTree,
  Loader2,
  XCircle,
} from 'lucide-react';

import { MediaProgressCard } from '@/components/artifacts/media/MediaProgressCard';
import {
  CreativeFlowViewer,
  type CreativeFlowEdge,
  type CreativeFlowNode,
  type CreativeFlowStatus,
  type CreativeLedgerItem,
} from '@/components/creative/CreativeFlowViewer';
import { OwnerRunDiagnostics } from '@/components/shared/run-diagnostics/ExecutionDiagnosticsPanel';
import { MarkdownProse } from '@/components/task/TaskV2MarkdownProse';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignTaskRecord } from '@/shared/types/design-mode';

export interface DesignRunDetailsFlow {
  nodes: CreativeFlowNode[];
  edges: CreativeFlowEdge[];
  ledgerItems: CreativeLedgerItem[];
}

export function MediaTaskSummaryCard({
  task,
  labels,
  projectFilePaths,
  onProjectFileOpen,
}: {
  task: DesignTaskRecord;
  labels: ReturnType<typeof useLanguage>['t'];
  projectFilePaths?: string[];
  onProjectFileOpen?: (path: string) => void;
}) {
  const failed = task.state === 'failed' || task.state === 'cancelled';
  const done = task.state === 'done';
  const lastLine = task.progressLines[task.progressLines.length - 1];
  const surfaceLabel = labels.design.surfaces[task.surface];
  const provider =
    task.provider ?? labels.creative.mediaGeneration.projectDefaults;
  const detail = task.prompt?.trim() || lastLine;
  const progressClass = failed
    ? 'bg-destructive'
    : done
      ? 'bg-emerald-600'
      : 'bg-primary';
  const outputPath = task.outputPath;
  const outputName = outputPath?.split('/').pop() ?? outputPath;

  return (
    <article
      className="border-border bg-card rounded-md border p-3"
      data-testid="media-task-summary-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {surfaceLabel} · {task.model}
          </h3>
          <p className="text-muted-foreground text-xs">
            {provider} ·{' '}
            {labels.creative.flowViewer.status[summaryTaskStatus(task.state)]}
          </p>
        </div>
        {done ? (
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
        ) : failed ? (
          <XCircle className="text-destructive size-5 shrink-0" />
        ) : (
          <Loader2 className="text-primary size-5 shrink-0 animate-spin" />
        )}
      </div>
      <div className="bg-muted mt-3 h-2 overflow-hidden rounded-full">
        <div
          className={`h-full transition-all ${progressClass}`}
          style={{ width: done || failed ? '100%' : '45%' }}
        />
      </div>
      {detail && (
        <div className="text-muted-foreground mt-2 line-clamp-2 text-xs">
          <MarkdownProse
            animated={false}
            content={detail}
            projectFilePaths={projectFilePaths}
            onProjectFileOpen={onProjectFileOpen}
          />
        </div>
      )}
      {outputPath && (
        <div className="mt-3">
          {onProjectFileOpen ? (
            <button
              type="button"
              className="text-primary hover:text-primary/80 text-xs font-medium"
              onClick={() => onProjectFileOpen(outputPath)}
            >
              {labels.creative.flowViewer.taskOutput}: {outputName}
            </button>
          ) : (
            <p className="text-muted-foreground text-xs">
              {labels.creative.flowViewer.taskOutput}: {outputName}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function summaryTaskStatus(
  state: DesignTaskRecord['state'],
): CreativeFlowStatus {
  if (state === 'queued') return 'queued';
  if (state === 'running') return 'running';
  if (state === 'done') return 'complete';
  if (state === 'failed') return 'failed';
  return 'cancelled';
}

export function RunDetailsDisclosure({
  open,
  onOpenChange,
  flow,
  tasks,
  ownerKey,
  projectFilePaths,
  onProjectFileOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flow: DesignRunDetailsFlow;
  tasks: DesignTaskRecord[];
  ownerKey: string;
  projectFilePaths?: string[];
  onProjectFileOpen?: (path: string) => void;
}) {
  const { t } = useLanguage();
  const detailsId = 'design-run-details-panel';

  return (
    <section
      className="border-border bg-background rounded-md border p-3"
      data-testid="design-run-details"
    >
      <button
        type="button"
        className="hover:bg-accent flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm font-medium"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => onOpenChange(!open)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <ListTree className="size-4 shrink-0" />
          <span>{t.creative.flowViewer.runDetails}</span>
        </span>
        <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
          {open
            ? t.creative.flowViewer.hideRunDetails
            : t.creative.flowViewer.showRunDetails}
          <ChevronDown
            className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      <p className="text-muted-foreground px-2 pb-2 text-xs">
        {t.creative.flowViewer.runDetailsDescription}
      </p>
      {open && (
        <div id={detailsId} className="mt-3 space-y-3">
          <CreativeFlowViewer
            title={t.creative.flowViewer.designTitle}
            description={t.creative.flowViewer.designDescription}
            nodes={flow.nodes}
            edges={flow.edges}
            ledgerItems={flow.ledgerItems}
          />
          <OwnerRunDiagnostics mode="design" ownerKey={ownerKey} />
          <div className="space-y-2">
            {tasks.map((task) => (
              <MediaProgressCard
                key={task.taskId}
                task={task}
                projectFilePaths={projectFilePaths}
                onProjectFileOpen={onProjectFileOpen}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
