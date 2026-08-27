import { useState, type ReactNode } from 'react';

import { ChevronRight, RotateCcw } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

import { ArgList } from './AgentActionCardArgs';
import type { AgentActionRecord } from './useAgentDock';

export interface CompactActionLabels {
  retry: string;
  pending: string;
  running: string;
  completed: string;
  partial: string;
  rejected: string;
  failed: string;
  cancelled: string;
}

/**
 * One-line collapsed row used for terminal-state actions (completed,
 * rejected, failed, cancelled) where the user no longer needs to make a
 * decision. The full card stays reserved for actions awaiting input or
 * carrying inline diff payloads.
 */
export function CompactActionRow({
  action,
  title,
  labels,
  onRetry,
  details,
}: {
  action: AgentActionRecord;
  title: string;
  labels: CompactActionLabels;
  onRetry: () => void;
  details?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const argEntries = Object.entries(action.args);
  const hasDetails =
    Boolean(details) || argEntries.length > 0 || Boolean(action.error);
  return (
    <div className="border-border/40 bg-muted/20 my-1 overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((value) => !value)}
        className={cn(
          'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors',
          hasDetails && 'hover:bg-muted/40',
          !hasDetails && 'cursor-default',
        )}
        aria-expanded={hasDetails ? open : undefined}
      >
        <StatusDot status={action.status} />
        <span className="text-foreground shrink-0 font-medium">{title}</span>
        <span className="text-muted-foreground min-w-0 truncate">
          · {compactArgsSummary(action.args) || action.summary}
        </span>
        <span className="text-muted-foreground/70 ml-auto shrink-0 text-[10px] uppercase">
          {labels[action.status]}
        </span>
        {hasDetails ? (
          <ChevronRight
            className={cn(
              'text-muted-foreground/50 size-3 shrink-0 transition-transform',
              open && 'rotate-90',
            )}
          />
        ) : null}
      </button>
      {open && hasDetails ? (
        <div className="border-border/30 space-y-1.5 border-t px-2.5 py-1.5">
          {action.error ? (
            <div className="text-destructive text-[11px]">{action.error}</div>
          ) : null}
          {details}
          {argEntries.length > 0 ? <ArgList args={action.args} /> : null}
          {action.status === 'failed' ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onRetry}
                className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]"
              >
                <RotateCcw className="size-3" />
                {labels.retry}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusDot({ status }: { status: AgentActionRecord['status'] }) {
  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        status === 'completed' && 'bg-emerald-500',
        status === 'partial' && 'bg-amber-500',
        status === 'failed' && 'bg-destructive',
        status === 'rejected' && 'bg-muted-foreground',
        status === 'cancelled' && 'bg-muted-foreground',
        status === 'running' && 'animate-pulse bg-blue-500',
        status === 'pending' && 'bg-amber-500',
      )}
    />
  );
}

const COMPACT_CANDIDATE_KEYS = [
  'position',
  'sceneId',
  'clipId',
  'kind',
  'transition',
  'mode',
  'direction',
  'aspectRatio',
  'durationMs',
  'maxIterations',
  'voiceId',
  'text',
] as const;

const COMPACT_BARE_VALUE_KEYS = new Set<string>([
  'position',
  'kind',
  'mode',
  'direction',
]);

/**
 * Build a one-line summary of the most informative args so adjacent rows
 * for the same action name still look different at a glance — e.g.
 * "intro · 600ms" vs "outro · 800ms" — without burning a JSON block.
 */
function compactArgsSummary(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of COMPACT_CANDIDATE_KEYS) {
    const value = args[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'object') continue;
    const formatted =
      key === 'durationMs' && typeof value === 'number'
        ? `${value}ms`
        : String(value);
    const bare = COMPACT_BARE_VALUE_KEYS.has(key);
    parts.push(
      bare ? truncate(formatted, 40) : `${key}: ${truncate(formatted, 40)}`,
    );
    if (parts.length >= 3) break;
  }
  return parts.join(' · ');
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
