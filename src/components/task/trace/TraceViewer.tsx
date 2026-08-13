/**
 * TraceViewer — Top-level container for the trace/timeline view.
 *
 * When a `taskId` is provided, prefers persisted trace events from the
 * `/observability` API and falls back to message-derived data only when
 * the backend has nothing recorded (e.g. legacy/older tasks).
 */
import { useMemo, useState } from 'react';

import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';
import type { AgentMessage } from '@/shared/hooks/agent-types';
import { useTaskTraceEvents } from '@/shared/hooks/useTaskTraceEvents';
import type { TraceEntry } from '@/shared/hooks/useTraceStream';
import { useTraceStream } from '@/shared/hooks/useTraceStream';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { adaptPersistedEvents } from './persisted-adapter';
import { TraceMetricsSummary } from './TraceMetricsSummary';
import { TraceTimeline } from './TraceTimeline';

const FILTER_TYPES: TraceEntry['type'][] = [
  'llm',
  'tool',
  'thinking',
  'user',
  'error',
  'plan',
];

const FILTER_LABEL_KEYS: Record<
  TraceEntry['type'],
  | 'traceFilterLlm'
  | 'traceFilterTool'
  | 'traceFilterThinking'
  | 'traceFilterUser'
  | 'traceFilterError'
  | 'traceFilterPlan'
> = {
  llm: 'traceFilterLlm',
  tool: 'traceFilterTool',
  thinking: 'traceFilterThinking',
  user: 'traceFilterUser',
  error: 'traceFilterError',
  plan: 'traceFilterPlan',
};

const FILTER_COLORS: Record<TraceEntry['type'], string> = {
  llm: 'bg-blue-500',
  tool: 'bg-orange-500',
  thinking: 'bg-purple-500',
  user: 'bg-gray-400',
  error: 'bg-red-500',
  plan: 'bg-indigo-500',
};

interface TraceViewerProps {
  messages: (AgentMessage | AGUIMessage)[];
  isRunning: boolean;
  taskId?: string;
}

export function TraceViewer({ messages, isRunning, taskId }: TraceViewerProps) {
  const { t } = useLanguage();

  const persisted = useTaskTraceEvents(taskId, isRunning, !!taskId);
  const messageDerived = useTraceStream(messages, isRunning);

  const usePersisted = persisted.source === 'persisted';
  const { entries, summary } = useMemo(() => {
    if (usePersisted) return adaptPersistedEvents(persisted.events);
    return messageDerived;
  }, [usePersisted, persisted.events, messageDerived]);

  const [activeFilters, setActiveFilters] = useState<Set<TraceEntry['type']>>(
    new Set(FILTER_TYPES),
  );

  const toggleFilter = (type: TraceEntry['type']) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const filteredEntries = useMemo(
    () => entries.filter((e) => activeFilters.has(e.type)),
    [entries, activeFilters],
  );

  const maxDuration = useMemo(
    () => filteredEntries.reduce((max, e) => Math.max(max, e.duration ?? 0), 0),
    [filteredEntries],
  );

  const sourceLabel = usePersisted
    ? t.task.traceSourcePersisted
    : t.task.traceSourceMessages;

  return (
    <div className="flex h-full flex-col">
      <TraceMetricsSummary summary={summary} isLive={isRunning} />

      <div className="border-border/40 flex items-center gap-1 border-b px-3 py-1.5">
        <span className="text-muted-foreground mr-1 text-[10px]">
          {t.task.traceFilterByType}:
        </span>
        {FILTER_TYPES.map((type) => {
          const active = activeFilters.has(type);
          const count = summary.byType[type] ?? 0;
          return (
            <button
              key={type}
              onClick={() => toggleFilter(type)}
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all',
                active
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground/50 hover:text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'inline-block size-1.5 rounded-full',
                  active ? FILTER_COLORS[type] : 'bg-gray-300 dark:bg-gray-600',
                )}
              />
              {t.task[FILTER_LABEL_KEYS[type]]}
              {count > 0 && (
                <span className="text-muted-foreground/70">{count}</span>
              )}
            </button>
          );
        })}
        <span
          className="text-muted-foreground/60 ml-auto text-[10px]"
          title={sourceLabel}
        >
          {sourceLabel}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <TraceTimeline
          entries={filteredEntries}
          maxDuration={maxDuration}
          isLive={isRunning}
        />
      </div>
    </div>
  );
}
