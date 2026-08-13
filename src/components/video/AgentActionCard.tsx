import { useState } from 'react';

import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquareText,
  RotateCcw,
  XCircle,
} from 'lucide-react';

import { ArgList, ReasoningList } from './AgentActionCardArgs';
import { CompactActionRow } from './AgentActionCardCompact';
import { TimelineOpDiffSummary } from './TimelineOpDiffSummary';
import type { TimelineOpDiffLabels } from './TimelineOpDiffSummary';
import type { AgentActionRecord } from './useAgentDock';

interface AgentActionCardProps {
  action: AgentActionRecord;
  title: string;
  labels: {
    accept: string;
    reject: string;
    refine: string;
    retry: string;
    cancel: string;
    pending: string;
    running: string;
    completed: string;
    rejected: string;
    failed: string;
    cancelled: string;
    why: string;
    hideWhy: string;
    considered: string;
    sourceClips: string;
    arguments: string;
    timelineDiff: TimelineOpDiffLabels;
  };
  onAccept: () => void;
  onReject: () => void;
  onRefine: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

/**
 * For terminal-state actions that no longer need user input we render a
 * one-line collapsed row (status dot + title + summary, expandable for
 * args/diffs). The full card is reserved for pending/running actions where
 * the user actually has to act — those are the ones that earn the vertical
 * space.
 */
function shouldRenderCompact(action: AgentActionRecord): boolean {
  if (action.status === 'pending' || action.status === 'running') return false;
  return true;
}

function isTimelineEditAction(action: AgentActionRecord): boolean {
  return (
    action.name === 'applyTimelineOp' || action.name === 'applyTimelineOps'
  );
}

export function AgentActionCard({
  action,
  title,
  labels,
  onAccept,
  onReject,
  onRefine,
  onRetry,
  onCancel,
}: AgentActionCardProps) {
  if (shouldRenderCompact(action)) {
    return (
      <CompactActionRow
        action={action}
        title={title}
        labels={labels}
        onRetry={onRetry}
        details={
          isTimelineEditAction(action) ? (
            <TimelineOpDiffSummary
              action={action}
              labels={labels.timelineDiff}
            />
          ) : undefined
        }
      />
    );
  }
  return (
    <FullActionCard
      action={action}
      title={title}
      labels={labels}
      onAccept={onAccept}
      onReject={onReject}
      onRefine={onRefine}
      onRetry={onRetry}
      onCancel={onCancel}
    />
  );
}

function FullActionCard({
  action,
  title,
  labels,
  onAccept,
  onReject,
  onRefine,
  onRetry,
  onCancel,
}: AgentActionCardProps) {
  const canAccept = action.status === 'pending';
  const canRetry = action.status === 'failed';
  const canCancel = action.status === 'running';
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasReasoning = Boolean(
    action.reasoning?.rationale ||
    action.reasoning?.considered?.length ||
    action.reasoning?.sourceClips?.length,
  );
  const argEntries = Object.entries(action.args);

  return (
    <div className="border-border bg-card rounded-md border p-3 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-foreground text-xs font-semibold">{title}</div>
          <div className="text-muted-foreground mt-1 text-xs">
            {action.summary}
          </div>
        </div>
        <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px]">
          {labels[action.status]}
        </span>
      </div>
      {action.error ? (
        <div className="text-destructive mb-2 text-xs">{action.error}</div>
      ) : null}
      {isTimelineEditAction(action) ? (
        <TimelineOpDiffSummary action={action} labels={labels.timelineDiff} />
      ) : null}
      {hasReasoning ? (
        <div className="border-border bg-muted/20 mb-3 rounded-md border">
          <button
            type="button"
            className="hover:bg-accent flex w-full items-center justify-between gap-2 rounded-t-md px-2 py-1.5 text-left text-[11px] font-medium"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <span>{detailsOpen ? labels.hideWhy : labels.why}</span>
            {detailsOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </button>
          {detailsOpen ? (
            <div className="space-y-2 px-2 pb-2">
              {action.reasoning?.rationale ? (
                <p className="text-muted-foreground text-xs">
                  {action.reasoning.rationale}
                </p>
              ) : null}
              {action.reasoning?.considered?.length ? (
                <ReasoningList
                  heading={labels.considered}
                  items={action.reasoning.considered}
                />
              ) : null}
              {action.reasoning?.sourceClips?.length ? (
                <ReasoningList
                  heading={labels.sourceClips}
                  items={action.reasoning.sourceClips}
                />
              ) : null}
              {argEntries.length > 0 ? (
                <div>
                  <div className="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
                    {labels.arguments}
                  </div>
                  <ArgList args={action.args} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : argEntries.length > 0 ? (
        <div className="mb-3">
          <div className="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
            {labels.arguments}
          </div>
          <ArgList args={action.args} />
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {canAccept ? (
          <>
            <button
              type="button"
              onClick={onReject}
              className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
            >
              <XCircle className="size-3" />
              {labels.reject}
            </button>
            <button
              type="button"
              onClick={onRefine}
              className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
            >
              <MessageSquareText className="size-3" />
              {labels.refine}
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
            >
              <CheckCircle2 className="size-3" />
              {labels.accept}
            </button>
          </>
        ) : null}
        {canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
          >
            <RotateCcw className="size-3" />
            {labels.retry}
          </button>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
          >
            <Ban className="size-3" />
            {labels.cancel}
          </button>
        ) : null}
        {action.status === 'running' ? (
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        ) : null}
      </div>
    </div>
  );
}
