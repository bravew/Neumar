// DB-backed counterpart to SubAgentPanel — survives reloads, shows
// historical fan-outs that the live event stream no longer holds.

import { useEffect, useState } from 'react';

import { CheckCircle2, ChevronRight, Loader2, XCircle } from 'lucide-react';

import { ExecutionDiagnosticsPanel } from '@/components/shared/run-diagnostics/ExecutionDiagnosticsPanel';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  type RunTreeNode,
  type RunStatus,
  useRunTreeStore,
} from '@/shared/stores/run-tree-store';

const STATUS_DOT: Record<RunStatus, string> = {
  running: 'bg-amber-500',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-400',
};

function StatusIcon({ status }: { status: RunStatus }) {
  if (status === 'running') {
    return <Loader2 className="size-3 animate-spin text-amber-500" />;
  }
  if (status === 'failed') {
    return <XCircle className="size-3 text-red-500" />;
  }
  if (status === 'cancelled') {
    return <XCircle className="size-3 text-gray-400" />;
  }
  return <CheckCircle2 className="size-3 text-emerald-500" />;
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function RunNodeRow({ node, depth }: { node: RunTreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(node.status === 'running');
  const hasChildren = node.children.length > 0;
  const details = [
    node.runtimeVersion ? `v${node.runtimeVersion}` : null,
    node.attempt > 0 ? `#${node.attempt + 1}` : null,
    node.sessionHandleKind,
    node.invalidationReason,
  ].filter((value): value is string => Boolean(value));

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-label={`${node.provider} run, ${node.status}`}
        className={cn(
          'hover:bg-muted/40 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
          !hasChildren && 'cursor-default',
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <ChevronRight
          className={cn(
            'text-muted-foreground size-3 shrink-0 transition-transform duration-150',
            expanded && hasChildren && 'rotate-90',
            !hasChildren && 'opacity-0',
          )}
        />
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            STATUS_DOT[node.status],
          )}
        />
        <span className="text-foreground truncate font-medium">
          {node.provider}
          {node.model ? (
            <span className="text-muted-foreground/70 ml-1 font-normal">
              {node.model}
            </span>
          ) : null}
        </span>
        <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-3">
          <StatusIcon status={node.status} />
          {node.costUsd > 0 && <span>{formatCost(node.costUsd)}</span>}
          {(node.tokensIn > 0 || node.tokensOut > 0) && (
            <span className="text-muted-foreground/70">
              {formatTokens(node.tokensIn)}↑ {formatTokens(node.tokensOut)}↓
            </span>
          )}
        </span>
      </button>
      {expanded && node.error && (
        <div
          className="text-destructive mt-0.5 text-xs"
          style={{ paddingLeft: `${depth * 14 + 30}px` }}
        >
          {node.error}
        </div>
      )}
      {expanded && details.length > 0 && (
        <div
          className="text-muted-foreground mt-0.5 text-xs"
          style={{ paddingLeft: `${depth * 14 + 30}px` }}
        >
          {details.join(' · ')}
        </div>
      )}
      {expanded && (
        <ExecutionDiagnosticsPanel runId={node.id} className="mx-2 my-1" />
      )}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <RunNodeRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function RunTreeView({ taskId }: { taskId: string }) {
  const { t } = useLanguage();
  const taskTree = useRunTreeStore((s) => s.byTaskId[taskId]);
  const fetchTree = useRunTreeStore((s) => s.fetch);

  useEffect(() => {
    // The store owns this request's lifetime (bounded timeout, shared across
    // callers), so there is no per-component signal to abort here.
    void fetchTree(taskId);
  }, [taskId, fetchTree]);

  if (!taskTree || taskTree.tree.length === 0) return null;

  const { tree, rollup } = taskTree;

  return (
    <div className="border-border/40 bg-muted/20 my-2 overflow-hidden rounded-lg border">
      <div className="border-border/30 flex items-center gap-3 border-b px-3 py-1.5 text-xs">
        <span className="text-muted-foreground font-medium">
          {(t.task.runTreeTitle ?? 'Run tree ({count})').replace(
            '{count}',
            String(rollup.runCount),
          )}
        </span>
        {rollup.runningCount > 0 && (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <Loader2 className="size-3 animate-spin" />
            {(t.task.subAgentsRunningCount ?? '{count} running').replace(
              '{count}',
              String(rollup.runningCount),
            )}
          </span>
        )}
        <span className="text-muted-foreground ml-auto flex items-center gap-3">
          {rollup.totalCostUsd > 0 && (
            <span>{formatCost(rollup.totalCostUsd)}</span>
          )}
          <span>
            {formatTokens(rollup.totalTokensIn)}↑{' '}
            {formatTokens(rollup.totalTokensOut)}↓
          </span>
        </span>
      </div>
      <div className="py-1">
        {tree.map((root) => (
          <RunNodeRow key={root.id} node={root} depth={0} />
        ))}
      </div>
    </div>
  );
}
