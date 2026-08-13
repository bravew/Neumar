import { useEffect } from 'react';

import { recordCreativeDebugCounterOnce } from '@/shared/creative-workflow/debug-counters';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  ExecutionLedger,
  FlowDebugDisclosure,
  FlowNodeCard,
  FlowRelationships,
} from './CreativeFlowViewerParts';

export type CreativeFlowNodeKind =
  | 'brief'
  | 'source'
  | 'asset'
  | 'plan'
  | 'job'
  | 'output'
  | 'export';

export type CreativeFlowStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'failed'
  | 'complete'
  | 'cancelled'
  | 'ready'
  | 'unknown';

export interface CreativeFlowNode {
  id: string;
  kind: CreativeFlowNodeKind;
  label: string;
  status: CreativeFlowStatus;
  meta?: string;
  onFocus?: () => void;
}

export interface CreativeFlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface CreativeLedgerItem {
  id: string;
  title: string;
  status: CreativeFlowStatus;
  detail?: string;
  costLabel?: string;
  durationLabel?: string;
  onRetry?: () => void;
  onCancel?: () => void;
  onOpen?: () => void;
}

interface CreativeFlowViewerProps {
  title?: string;
  description?: string;
  nodes: CreativeFlowNode[];
  edges: CreativeFlowEdge[];
  ledgerItems?: CreativeLedgerItem[];
  debugContent?: string;
  onDownloadDebug?: () => void;
}

export function CreativeFlowViewer({
  title,
  description,
  nodes,
  edges,
  ledgerItems = [],
  debugContent,
  onDownloadDebug,
}: CreativeFlowViewerProps) {
  const { t } = useLanguage();
  const labels = t.creative.flowViewer;

  useEffect(() => {
    recordCreativeDebugCounterOnce('flow.viewer.opened', 'creative-flow');
  }, []);

  return (
    <section
      className="border-border bg-card flex flex-col gap-3 rounded-md border p-3"
      data-testid="creative-flow-viewer"
      aria-label={labels.label}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-foreground text-sm font-semibold">
            {title ?? labels.title}
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {description ?? labels.description}
          </p>
        </div>
        <div className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
          <span>{labels.nodes.replace('{count}', String(nodes.length))}</span>
          <span>{labels.edges.replace('{count}', String(edges.length))}</span>
        </div>
      </div>

      {nodes.length > 0 ? (
        <div
          className="flex gap-2 overflow-x-auto pb-1"
          role="list"
          aria-label={labels.graph}
          tabIndex={0}
        >
          {nodes.map((node) => (
            <div
              key={node.id}
              className="flex shrink-0 items-center gap-2"
              role="listitem"
            >
              <FlowNodeCard node={node} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs" role="status">
          {labels.emptyGraph}
        </p>
      )}

      <FlowRelationships edges={edges} nodes={nodes} />
      <ExecutionLedger items={ledgerItems} />
      <FlowDebugDisclosure
        debugContent={debugContent}
        onDownloadDebug={onDownloadDebug}
      />
    </section>
  );
}
