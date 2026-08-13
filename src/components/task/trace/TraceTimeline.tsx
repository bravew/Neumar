/**
 * TraceTimeline — Virtualized list of trace entries with duration bars.
 * Color-coded by type: blue=LLM, orange=tool, purple=thinking, red=error, gray=user.
 */
import { useCallback, useState } from 'react';

import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Cpu,
  Lightbulb,
  User,
  Workflow,
} from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';

import type { TraceEntry } from '@/shared/hooks/useTraceStream';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface TraceTimelineProps {
  entries: TraceEntry[];
  maxDuration: number;
  isLive: boolean;
}

// ── Type styling ─────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  TraceEntry['type'],
  { color: string; bgColor: string; icon: typeof Bot }
> = {
  llm: { color: 'text-blue-500', bgColor: 'bg-blue-500', icon: Bot },
  tool: { color: 'text-orange-500', bgColor: 'bg-orange-500', icon: Cpu },
  thinking: {
    color: 'text-purple-500',
    bgColor: 'bg-purple-500',
    icon: Lightbulb,
  },
  user: { color: 'text-gray-500', bgColor: 'bg-gray-400', icon: User },
  error: {
    color: 'text-red-500',
    bgColor: 'bg-red-500',
    icon: CircleAlert,
  },
  plan: {
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-500',
    icon: Workflow,
  },
};

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '...';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function TraceTimeline({
  entries,
  maxDuration,
  isLive,
}: TraceTimelineProps) {
  const { t } = useLanguage();

  // Manage expanded row per-row to avoid re-rendering every Virtuoso item on toggle.
  // Each TraceRow owns its own expanded state independently.
  const itemContent = useCallback(
    (_index: number, entry: TraceEntry) => (
      <TraceRowWithState entry={entry} maxDuration={maxDuration} />
    ),
    [maxDuration],
  );

  if (entries.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center p-8 text-sm">
        {t.task.noTraceEntries}
      </div>
    );
  }

  return (
    <Virtuoso
      data={entries}
      computeItemKey={(_index, entry) => entry.id}
      defaultItemHeight={36}
      increaseViewportBy={400}
      followOutput={isLive ? () => 'auto' : undefined}
      itemContent={itemContent}
      className="h-full"
    />
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function TraceRowWithState({
  entry,
  maxDuration,
}: {
  entry: TraceEntry;
  maxDuration: number;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <TraceRow
      entry={entry}
      maxDuration={maxDuration}
      expanded={expanded}
      onToggle={() => setExpanded((prev) => !prev)}
    />
  );
}

function TraceRow({
  entry,
  maxDuration,
  expanded,
  onToggle,
}: {
  entry: TraceEntry;
  maxDuration: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  const config = TYPE_CONFIG[entry.type] ?? TYPE_CONFIG.llm;
  const Icon = config.icon;
  const barWidth =
    maxDuration > 0 && entry.duration
      ? Math.max(2, (entry.duration / maxDuration) * 100)
      : 0;
  const isRunning = entry.status === 'running';
  const hasContent = !!(entry.content || entry.toolInput || entry.toolOutput);

  return (
    <div className="border-border/20 border-b">
      <button
        onClick={onToggle}
        className="hover:bg-accent/50 flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        {/* Expand chevron */}
        {hasContent ? (
          expanded ? (
            <ChevronDown className="text-muted-foreground size-3 shrink-0" />
          ) : (
            <ChevronRight className="text-muted-foreground size-3 shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Type icon */}
        <Icon className={cn('size-3.5 shrink-0', config.color)} />

        {/* Name */}
        <span className="text-foreground min-w-0 flex-1 truncate text-xs">
          {entry.name}
        </span>

        {/* Duration bar */}
        <div className="relative h-3 w-24 shrink-0 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div
            className={cn(
              'absolute inset-y-0 left-0 rounded-full transition-all',
              config.bgColor,
              isRunning && 'animate-pulse',
            )}
            style={{ width: `${Math.min(barWidth, 100)}%`, opacity: 0.6 }}
          />
        </div>

        {/* Duration text */}
        <span className="text-muted-foreground w-14 shrink-0 text-right text-[10px]">
          {formatDuration(entry.duration)}
        </span>

        {/* Token badge */}
        {entry.tokens && (
          <span className="text-muted-foreground shrink-0 text-[10px]">
            {entry.tokens.input + entry.tokens.output}t
          </span>
        )}

        {/* Cost badge — entry.cost is USD */}
        {entry.cost !== undefined && entry.cost > 0 && (
          <span className="text-muted-foreground shrink-0 text-[10px]">
            ${entry.cost < 0.01 ? entry.cost.toFixed(4) : entry.cost.toFixed(3)}
          </span>
        )}

        {/* Status indicator */}
        {isRunning && (
          <span className="bg-primary inline-block size-2 shrink-0 animate-pulse rounded-full" />
        )}
        {entry.status === 'error' && (
          <span className="inline-block size-2 shrink-0 rounded-full bg-red-500" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && hasContent && (
        <div className="bg-muted/30 border-border/20 mx-3 mb-2 space-y-2 rounded border px-3 py-2">
          {entry.toolInput && (
            <div>
              <div className="text-muted-foreground/70 mb-0.5 text-[10px] font-medium uppercase">
                {t.task.traceInput}
              </div>
              <pre className="text-muted-foreground max-h-32 overflow-auto text-[11px] whitespace-pre-wrap">
                {entry.toolInput}
              </pre>
            </div>
          )}
          {entry.toolOutput && (
            <div>
              <div className="text-muted-foreground/70 mb-0.5 text-[10px] font-medium uppercase">
                {t.task.traceOutput}
              </div>
              <pre className="text-muted-foreground max-h-32 overflow-auto text-[11px] whitespace-pre-wrap">
                {entry.toolOutput}
              </pre>
            </div>
          )}
          {entry.content && !entry.toolInput && !entry.toolOutput && (
            <pre className="text-muted-foreground max-h-40 overflow-auto text-[11px] whitespace-pre-wrap">
              {entry.content}
            </pre>
          )}
          {entry.model && (
            <div className="text-muted-foreground/60 mt-1 text-[10px]">
              {t.task.traceModel}: {entry.model}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
