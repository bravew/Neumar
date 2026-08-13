import type { ReactNode } from 'react';

import {
  AlertTriangle,
  Box,
  CheckCircle2,
  CircleDot,
  Download,
  FileText,
  FolderInput,
  Loader2,
  PlayCircle,
  RotateCcw,
  XCircle,
} from 'lucide-react';

import { recordCreativeDebugCounter } from '@/shared/creative-workflow/debug-counters';
import { useReducedMotionPreference } from '@/shared/hooks/useReducedMotionPreference';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type {
  CreativeFlowEdge,
  CreativeFlowNode,
  CreativeFlowNodeKind,
  CreativeFlowStatus,
  CreativeLedgerItem,
} from './CreativeFlowViewer';

export function FlowNodeCard({ node }: { node: CreativeFlowNode }) {
  const { t } = useLanguage();
  const labels = t.creative.flowViewer;
  const content = (
    <>
      <div className="flex items-center gap-2">
        <NodeKindIcon kind={node.kind} />
        <span className="text-muted-foreground text-[10px] font-medium uppercase">
          {labels.kind[node.kind]}
        </span>
      </div>
      <div className="text-foreground mt-2 line-clamp-2 text-xs font-semibold">
        {node.label}
      </div>
      {node.meta ? (
        <div className="text-muted-foreground mt-1 truncate text-[11px]">
          {node.meta}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-1 text-[11px]">
        <StatusIcon status={node.status} />
        <span>{labels.status[node.status]}</span>
      </div>
    </>
  );
  const className = cn(
    'border-border bg-background min-h-28 w-40 shrink-0 rounded-md border p-3 text-left',
    node.status === 'running' && 'border-primary/60',
    node.status === 'failed' && 'border-destructive/60',
    node.onFocus && 'hover:bg-accent cursor-pointer',
  );

  if (node.onFocus) {
    return (
      <button
        type="button"
        className={className}
        onClick={node.onFocus}
        aria-label={labels.focus.replace('{name}', node.label)}
      >
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}

export function FlowRelationships({
  edges,
  nodes,
}: {
  edges: CreativeFlowEdge[];
  nodes: CreativeFlowNode[];
}) {
  const { t } = useLanguage();
  const labels = t.creative.flowViewer;
  const nodeLabels = new Map(nodes.map((node) => [node.id, node.label]));

  if (edges.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="list"
      aria-label={labels.relationships}
    >
      {edges.slice(0, 8).map((edge) => {
        const from = nodeLabels.get(edge.from) ?? edge.from;
        const to = nodeLabels.get(edge.to) ?? edge.to;
        return (
          <span
            key={edge.id}
            role="listitem"
            className="border-border bg-muted/30 text-muted-foreground rounded border px-2 py-1 text-[11px]"
          >
            {from} -&gt; {to}: {edge.label ?? labels.edge.default}
          </span>
        );
      })}
    </div>
  );
}

export function ExecutionLedger({ items }: { items: CreativeLedgerItem[] }) {
  const { t } = useLanguage();
  const labels = t.creative.flowViewer;
  const running = items.filter(
    (item) => item.status === 'queued' || item.status === 'running',
  ).length;
  const failed = items.filter(
    (item) => item.status === 'failed' || item.status === 'blocked',
  ).length;
  const summary = labels.ledgerSummary
    .replace('{count}', String(items.length))
    .replace('{running}', String(running))
    .replace('{failed}', String(failed));

  return (
    <section
      className="border-border bg-muted/20 rounded-md border p-2"
      data-testid="creative-execution-ledger"
      aria-label={labels.ledgerTitle}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-muted-foreground text-[11px] font-semibold uppercase">
          {labels.ledgerTitle}
        </h4>
        <span
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {summary}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-xs">
          {labels.ledgerEmpty}
        </p>
      ) : (
        <div className="mt-2 space-y-1.5" role="list">
          {items.slice(0, 8).map((item) => (
            <LedgerRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

export function FlowDebugDisclosure({
  debugContent,
  onDownloadDebug,
}: {
  debugContent?: string;
  onDownloadDebug?: () => void;
}) {
  const { t } = useLanguage();
  const labels = t.creative.flowViewer;

  if (!debugContent) return null;

  return (
    <details className="border-border bg-muted/20 rounded-md border">
      <summary className="hover:bg-accent cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium">
        {labels.debug}
      </summary>
      <div className="space-y-2 px-2 pb-2">
        {onDownloadDebug ? (
          <button
            type="button"
            onClick={onDownloadDebug}
            className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
          >
            <Download className="size-3" />
            {labels.downloadJson}
          </button>
        ) : null}
        <pre
          className="bg-background text-foreground max-h-72 overflow-auto rounded-md p-3 text-[11px] leading-relaxed"
          tabIndex={0}
          aria-label={labels.debug}
        >
          {debugContent}
        </pre>
      </div>
    </details>
  );
}

function LedgerRow({ item }: { item: CreativeLedgerItem }) {
  const { t } = useLanguage();
  const labels = t.creative.flowViewer;
  const meta = [item.detail, item.costLabel, item.durationLabel]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="border-border bg-background flex items-start justify-between gap-2 rounded border px-2 py-1.5"
      role="listitem"
    >
      <div className="min-w-0">
        <div className="text-foreground flex items-center gap-1.5 text-xs font-medium">
          <StatusIcon status={item.status} />
          <span className="truncate">{item.title}</span>
        </div>
        <div className="text-muted-foreground mt-0.5 text-[11px]">
          {labels.status[item.status]}
          {meta ? ` · ${meta}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {item.onOpen ? (
          <IconButton
            label={`${labels.open}: ${item.title}`}
            onClick={item.onOpen}
          >
            <PlayCircle className="size-3.5" />
          </IconButton>
        ) : null}
        {item.onRetry ? (
          <IconButton
            label={`${labels.retry}: ${item.title}`}
            onClick={item.onRetry}
          >
            <RotateCcw className="size-3.5" />
          </IconButton>
        ) : null}
        {item.onCancel ? (
          <IconButton
            label={`${labels.cancel}: ${item.title}`}
            onClick={item.onCancel}
          >
            <XCircle className="size-3.5" />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        recordCreativeDebugCounter('recovery.action.used');
        onClick();
      }}
      className="hover:bg-accent rounded p-1"
    >
      {children}
    </button>
  );
}

function NodeKindIcon({ kind }: { kind: CreativeFlowNodeKind }) {
  if (kind === 'brief') return <FileText className="size-3.5" />;
  if (kind === 'source') return <FolderInput className="size-3.5" />;
  if (kind === 'asset') return <Box className="size-3.5" />;
  if (kind === 'job') return <Loader2 className="size-3.5" />;
  if (kind === 'export') return <Download className="size-3.5" />;
  return <CircleDot className="size-3.5" />;
}

function StatusIcon({ status }: { status: CreativeFlowStatus }) {
  const reducedMotion = useReducedMotionPreference();
  if (status === 'running' || status === 'queued') {
    return (
      <Loader2
        className={cn(
          'text-primary size-3.5',
          !reducedMotion && 'animate-spin',
        )}
      />
    );
  }
  if (status === 'failed' || status === 'blocked') {
    return <AlertTriangle className="text-destructive size-3.5" />;
  }
  if (status === 'cancelled') {
    return <XCircle className="text-muted-foreground size-3.5" />;
  }
  if (status === 'complete') {
    return <CheckCircle2 className="size-3.5 text-emerald-600" />;
  }
  return <CircleDot className="text-muted-foreground size-3.5" />;
}
