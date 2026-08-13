import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  CreativeFlowEdge,
  CreativeFlowNode,
  CreativeFlowStatus,
  CreativeLedgerItem,
} from '@/components/creative/CreativeFlowViewer';
import type {
  PromptLibrarySample,
  PromptLibrarySurface,
} from '@/shared/design/prompt-library-types';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignJuryRun,
  DesignSurface,
  DesignTaskRecord,
} from '@/shared/types/design-mode';

import { BriefDrawer } from './BriefDrawer';
import { DesignJuryCard } from './critique/DesignJuryCard';
import { MediaTaskSummaryCard, RunDetailsDisclosure } from './DesignRunDetails';
import { DesignStarters } from './DesignStarters';
import { MessageFeedback } from './MessageFeedback';
import { ProviderErrorBanner } from './ProviderErrorBanner';

export function DesignProjectActivity({
  brief,
  tasks,
  sendError,
  juryRun,
  juryError,
  emptyHint,
  scrollStorageKey,
  onBriefSubmit,
  onSampleSelected,
  promptLibrarySurface,
  projectId,
  projectFilePaths,
  onProjectFileOpen,
  surface,
  startersTitle,
  onStarterSelect,
}: {
  projectId: string;
  brief: Record<string, unknown>;
  tasks: DesignTaskRecord[];
  sendError: string | null;
  juryRun: DesignJuryRun | null;
  juryError: string | null;
  emptyHint: string;
  scrollStorageKey?: string;
  onBriefSubmit: (brief: Record<string, unknown>) => Promise<void>;
  onSampleSelected?: (sample: PromptLibrarySample) => void;
  promptLibrarySurface?: PromptLibrarySurface;
  projectFilePaths?: string[];
  onProjectFileOpen?: (path: string) => void;
  surface?: DesignSurface;
  startersTitle?: string;
  onStarterSelect?: (prompt: string) => void;
}) {
  const { t } = useLanguage();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [runDetailsOpen, setRunDetailsOpen] = useState(false);
  const flow = useMemo(
    () => buildDesignFlow({ brief, tasks, t }),
    [brief, t, tasks],
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !scrollStorageKey) return;
    const saved = Number(sessionStorage.getItem(scrollStorageKey) ?? 0);
    if (Number.isFinite(saved) && saved > 0) {
      node.scrollTop = saved;
    }
    return () => {
      sessionStorage.setItem(scrollStorageKey, String(node.scrollTop));
    };
  }, [scrollStorageKey]);

  return (
    <div
      ref={scrollRef}
      data-testid="design-project-activity"
      className="min-h-0 flex-1 space-y-3 overflow-auto p-3"
      onScroll={(event) => {
        if (scrollStorageKey) {
          sessionStorage.setItem(
            scrollStorageKey,
            String(event.currentTarget.scrollTop),
          );
        }
      }}
    >
      <BriefDrawer
        brief={brief}
        initialLibrarySurface={promptLibrarySurface}
        onSubmit={onBriefSubmit}
        onSampleSelected={onSampleSelected}
      />
      {tasks.map((task) => (
        <div key={task.taskId} className="space-y-2">
          <MediaTaskSummaryCard
            task={task}
            labels={t}
            projectFilePaths={projectFilePaths}
            onProjectFileOpen={onProjectFileOpen}
          />
          <ProviderErrorBanner message={task.providerError} />
          {task.state === 'done' && task.progressLines.length > 0 && (
            <MessageFeedback
              projectId={projectId}
              messageId={task.taskId}
              artifactRef={task.outputPath}
              runId={task.taskId}
            />
          )}
        </div>
      ))}
      {tasks.length > 0 ? (
        <RunDetailsDisclosure
          ownerKey={projectId}
          open={runDetailsOpen}
          onOpenChange={setRunDetailsOpen}
          flow={flow}
          tasks={tasks}
          projectFilePaths={projectFilePaths}
          onProjectFileOpen={onProjectFileOpen}
        />
      ) : null}
      {tasks.length === 0 && (
        <div className="space-y-4">
          {surface && onStarterSelect && (
            <DesignStarters
              surface={surface}
              title={startersTitle ?? ''}
              onSelect={onStarterSelect}
            />
          )}
          <p className="text-muted-foreground text-sm">{emptyHint}</p>
        </div>
      )}
      {sendError && (
        <p className="text-destructive border-destructive/30 rounded-md border p-2 text-sm">
          {sendError}
        </p>
      )}
      {(juryRun || juryError) && (
        <DesignJuryCard
          projectId={juryRun?.projectId ?? ''}
          run={juryRun}
          error={juryError}
        />
      )}
    </div>
  );
}

function buildDesignFlow({
  brief,
  tasks,
  t,
}: {
  brief: Record<string, unknown>;
  tasks: DesignTaskRecord[];
  t: ReturnType<typeof useLanguage>['t'];
}): {
  nodes: CreativeFlowNode[];
  edges: CreativeFlowEdge[];
  ledgerItems: CreativeLedgerItem[];
} {
  const hasBrief = Object.keys(brief).length > 0;
  const nodes: CreativeFlowNode[] = [
    {
      id: 'brief',
      kind: 'brief',
      label: t.design.brief,
      status: hasBrief ? 'complete' : 'ready',
      meta: hasBrief
        ? t.creative.flowViewer.briefReady
        : t.creative.flowViewer.briefEmpty,
    },
  ];
  const edges: CreativeFlowEdge[] = [];
  const ledgerItems: CreativeLedgerItem[] = [];

  tasks.forEach((task) => {
    const taskNodeId = `task:${task.taskId}`;
    const surfaceLabel = t.design.surfaces[task.surface];
    nodes.push({
      id: taskNodeId,
      kind: 'job',
      label: `${surfaceLabel} · ${task.model}`,
      status: designTaskStatus(task.state),
      meta: task.provider ?? t.creative.mediaGeneration.projectDefaults,
    });
    edges.push({
      id: `brief:${task.taskId}`,
      from: 'brief',
      to: taskNodeId,
      label: t.creative.flowViewer.edge.generatedFrom,
    });

    if (task.outputPath) {
      const outputNodeId = `output:${task.taskId}`;
      nodes.push({
        id: outputNodeId,
        kind: 'output',
        label: task.outputPath.split('/').pop() ?? task.outputPath,
        status: 'complete',
        meta: task.outputPath,
      });
      edges.push({
        id: `task-output:${task.taskId}`,
        from: taskNodeId,
        to: outputNodeId,
        label: t.creative.flowViewer.edge.exportedAs,
      });
    }

    ledgerItems.push({
      id: task.taskId,
      title: `${surfaceLabel} · ${task.model}`,
      status: designTaskStatus(task.state),
      detail: task.providerError ?? task.provider ?? task.outputPath,
      durationLabel:
        typeof task.durationMs === 'number'
          ? t.creative.flowViewer.durationMs.replace(
              '{ms}',
              String(task.durationMs),
            )
          : undefined,
    });
  });

  return { nodes, edges, ledgerItems };
}

function designTaskStatus(
  state: DesignTaskRecord['state'],
): CreativeFlowStatus {
  if (state === 'queued') return 'queued';
  if (state === 'running') return 'running';
  if (state === 'done') return 'complete';
  if (state === 'failed') return 'failed';
  return 'cancelled';
}
