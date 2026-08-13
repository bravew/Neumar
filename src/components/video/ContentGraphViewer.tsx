import { useMemo } from 'react';

import {
  topoSortContentGraph,
  type ContentGraph,
  type ContentGraphNode,
} from '@neumar/video-ir';

import {
  CreativeFlowViewer,
  type CreativeFlowEdge,
  type CreativeFlowNode,
  type CreativeFlowStatus,
  type CreativeLedgerItem,
} from '@/components/creative/CreativeFlowViewer';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAgentJournalEntry,
  VideoJob,
  VideoProject,
  VideoRenderOutput,
} from '@/shared/types/video';

interface ContentGraphViewerProps {
  graph: ContentGraph | null;
  /** Used to name the downloaded file. */
  projectId?: string;
  jobs?: VideoJob[];
  agentJournal?: VideoAgentJournalEntry[];
  renderStatus?: VideoProject['render'];
  outputs?: VideoRenderOutput[];
}

export function ContentGraphViewer({
  graph,
  projectId,
  jobs = [],
  agentJournal = [],
  renderStatus,
  outputs = [],
}: ContentGraphViewerProps) {
  const { t } = useLanguage();
  const g = t.video.contentGraph;
  const flowLabels = t.creative.flowViewer;

  const json = useMemo(
    () => (graph ? JSON.stringify(graph, null, 2) : ''),
    [graph],
  );
  const nodes = useMemo(
    () => (graph ? buildContentFlowNodes(graph, outputs, g) : []),
    [g, graph, outputs],
  );
  const edges = useMemo(
    () => (graph ? buildContentFlowEdges(graph, outputs, flowLabels) : []),
    [flowLabels, graph, outputs],
  );
  const ledgerItems = useMemo(
    () => buildLedgerItems({ jobs, agentJournal, renderStatus, outputs, g }),
    [agentJournal, g, jobs, outputs, renderStatus],
  );

  if (!graph) {
    return (
      <div className="text-muted-foreground text-xs" role="status">
        {g.empty}
      </div>
    );
  }

  const download = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `content-graph-${projectId ?? 'project'}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div data-testid="content-graph-viewer">
      <CreativeFlowViewer
        title={g.flowTitle}
        description={graph.synopsis ?? g.flowDescription}
        nodes={nodes}
        edges={edges}
        ledgerItems={ledgerItems}
        debugContent={json}
        onDownloadDebug={download}
      />
    </div>
  );
}

function buildContentFlowNodes(
  graph: ContentGraph,
  outputs: VideoRenderOutput[],
  labels: ReturnType<typeof useLanguage>['t']['video']['contentGraph'],
): CreativeFlowNode[] {
  const orderedNodes = orderedGraphNodes(graph);
  const nodes: CreativeFlowNode[] = [
    {
      id: 'brief',
      kind: 'brief',
      label: graph.synopsis || graph.intent,
      status: 'complete',
      meta: labels.intentLabel.replace('{intent}', graph.intent),
    },
  ];
  nodes.push(
    ...orderedNodes.map((node) => ({
      id: graphNodeId(node.id),
      kind: graphNodeKind(node),
      label: graphNodeLabel(node),
      status: 'complete' as const,
      meta: contentNodeKindLabel(node.kind, labels),
    })),
  );
  nodes.push(
    ...outputs.slice(0, 4).map((output) => ({
      id: `output:${output.aspectRatio}:${output.path}`,
      kind: 'output' as const,
      label: output.path.split('/').pop() ?? output.path,
      status: 'complete' as const,
      meta: output.aspectRatio,
    })),
  );
  return nodes;
}

function buildContentFlowEdges(
  graph: ContentGraph,
  outputs: VideoRenderOutput[],
  labels: ReturnType<typeof useLanguage>['t']['creative']['flowViewer'],
): CreativeFlowEdge[] {
  const edges: CreativeFlowEdge[] = [];
  const orderedNodes = orderedGraphNodes(graph);
  const firstNode = orderedNodes[0];
  if (firstNode) {
    edges.push({
      id: 'brief:first-node',
      from: 'brief',
      to: graphNodeId(firstNode.id),
      label: labels.edge.generatedFrom,
    });
  }
  edges.push(
    ...graph.edges.map((edge, index) => ({
      id: `graph:${index}:${edge.from}:${edge.to}`,
      from: graphNodeId(edge.from),
      to: graphNodeId(edge.to),
      label: labels.edge[edge.kind] ?? labels.edge.default,
    })),
  );
  const lastNode = orderedNodes[orderedNodes.length - 1];
  if (lastNode) {
    edges.push(
      ...outputs.slice(0, 4).map((output) => ({
        id: `output:${output.aspectRatio}:${output.path}`,
        from: graphNodeId(lastNode.id),
        to: `output:${output.aspectRatio}:${output.path}`,
        label: labels.edge.exportedAs,
      })),
    );
  }
  return edges;
}

function buildLedgerItems({
  jobs,
  agentJournal,
  renderStatus,
  outputs,
  g,
}: {
  jobs: VideoJob[];
  agentJournal: VideoAgentJournalEntry[];
  renderStatus?: VideoProject['render'];
  outputs: VideoRenderOutput[];
  g: ReturnType<typeof useLanguage>['t']['video']['contentGraph'];
}): CreativeLedgerItem[] {
  const jobItems = jobs.slice(0, 4).map((job) => ({
    id: `job:${job.id}`,
    title: g.jobTitle.replace('{kind}', jobKindLabel(job.kind, g)),
    status: videoJobStatus(job.status),
    detail: callerLabel(job.caller, g),
    costLabel:
      typeof job.costCents === 'number'
        ? g.costCents.replace('{cents}', String(job.costCents))
        : undefined,
  }));
  const renderItem = renderStatus
    ? [
        {
          id: 'render:current',
          title: g.renderJob,
          status: looseStatus(renderStatus.status),
          detail: renderStatus.message ?? renderStatus.where,
        } satisfies CreativeLedgerItem,
      ]
    : [];
  const journalItems = agentJournal.slice(-3).map((entry) => ({
    id: `journal:${entry.id}`,
    title: g.agentAction.replace('{tool}', entry.tool),
    status: journalStatus(entry),
    detail: entry.ts,
  }));
  const outputItems = outputs.slice(-3).map((output) => ({
    id: `output-ledger:${output.aspectRatio}:${output.path}`,
    title: g.outputTitle.replace('{aspect}', output.aspectRatio),
    status: 'complete' as const,
    detail: output.path,
    durationLabel: g.durationSeconds.replace(
      '{seconds}',
      String(Math.round(output.durationSec)),
    ),
  }));
  return [...jobItems, ...renderItem, ...journalItems, ...outputItems];
}

function orderedGraphNodes(graph: ContentGraph): ContentGraphNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  try {
    return topoSortContentGraph(graph)
      .map((id) => byId.get(id))
      .filter((node): node is ContentGraphNode => Boolean(node));
  } catch {
    return graph.nodes;
  }
}

function contentNodeKindLabel(
  kind: ContentGraphNode['kind'],
  labels: ReturnType<typeof useLanguage>['t']['video']['contentGraph'],
): string {
  return labels.nodeKind[kind] ?? labels.nodeKind.unknown;
}

function jobKindLabel(
  kind: VideoJob['kind'],
  labels: ReturnType<typeof useLanguage>['t']['video']['contentGraph'],
): string {
  return labels.jobKind[kind] ?? labels.jobKind.unknown;
}

function callerLabel(
  caller: VideoJob['caller'],
  labels: ReturnType<typeof useLanguage>['t']['video']['contentGraph'],
): string {
  return labels.caller[caller] ?? labels.caller.unknown;
}

function graphNodeId(id: string): string {
  return `node:${id}`;
}

function graphNodeKind(node: ContentGraphNode): CreativeFlowNode['kind'] {
  if (node.kind === 'data') return 'asset';
  if (node.kind === 'text') return 'plan';
  return 'plan';
}

function graphNodeLabel(node: ContentGraphNode): string {
  if (node.label) return node.label;
  if (node.kind === 'text') return trimLabel(node.text);
  if (node.frameIntent) return node.frameIntent;
  return node.id;
}

function trimLabel(value: string): string {
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean.length > 48 ? `${clean.slice(0, 45)}...` : clean;
}

function videoJobStatus(status: VideoJob['status']): CreativeFlowStatus {
  if (status === 'queued') return 'queued';
  if (status === 'running') return 'running';
  if (status === 'done') return 'complete';
  if (status === 'error') return 'failed';
  return 'cancelled';
}

function journalStatus(entry: VideoAgentJournalEntry): CreativeFlowStatus {
  if (entry.undone) return 'cancelled';
  const result = entry.result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const status = (result as { status?: unknown }).status;
    if (status === 'failed') return 'failed';
  }
  return 'complete';
}

function looseStatus(status: string): CreativeFlowStatus {
  const value = status.toLowerCase();
  if (value.includes('queue')) return 'queued';
  if (value.includes('run') || value.includes('render')) return 'running';
  if (value.includes('fail') || value.includes('error')) return 'failed';
  if (value.includes('cancel')) return 'cancelled';
  if (value.includes('done') || value.includes('complete')) return 'complete';
  return 'unknown';
}
