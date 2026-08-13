import { useEffect, useState } from 'react';

import { ChevronRight, Loader2, X } from 'lucide-react';

import { formatDuration } from '@/components/automation/utils';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export interface SubAgentState {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  totalTokens?: number;
  parentToolUseId?: string;
}

const STATUS_COLORS: Record<SubAgentState['status'], string> = {
  running: 'bg-amber-500',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-400',
};

function SubAgentRow({
  agent,
  onCancel,
}: {
  agent: SubAgentState;
  onCancel: (agentId: string) => void;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(agent.status === 'running');
  const isRunning = agent.status === 'running';
  const [frozenDurationMs, setFrozenDurationMs] = useState<number | null>(() =>
    agent.status === 'running' || agent.durationMs || agent.completedAt
      ? null
      : Date.now() - agent.startedAt,
  );
  useEffect(() => {
    if (!isRunning && !agent.durationMs && !agent.completedAt) {
      setFrozenDurationMs((prev) => prev ?? Date.now() - agent.startedAt);
    }
  }, [agent.completedAt, agent.durationMs, agent.startedAt, isRunning]);
  const duration =
    agent.durationMs ??
    (agent.completedAt
      ? agent.completedAt - agent.startedAt
      : isRunning
        ? Date.now() - agent.startedAt
        : (frozenDurationMs ?? 0));

  const statusLabel =
    agent.status === 'running'
      ? t.task.subAgentRunning
      : agent.status === 'completed'
        ? t.task.subAgentCompleted
        : agent.status === 'failed'
          ? t.task.subAgentFailed
          : t.task.subAgentCancelled;

  return (
    <div className="border-border/30 border-b last:border-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="hover:bg-muted/40 flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-xs transition-colors"
      >
        <ChevronRight
          className={cn(
            'text-muted-foreground size-3 shrink-0 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            STATUS_COLORS[agent.status],
          )}
        />
        <span className="text-foreground truncate text-left font-medium">
          {agent.name || t.task.subAgentDefault}
        </span>
        <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-2">
          {isRunning && (
            <Loader2 className="size-3 animate-spin text-amber-500" />
          )}
          <span>{statusLabel}</span>
          <span className="text-muted-foreground/60">
            {formatDuration(duration)}
          </span>
          {agent.totalTokens != null && (
            <span className="text-muted-foreground/60">
              {agent.totalTokens.toLocaleString()} {t.task.tokens}
            </span>
          )}
          {isRunning && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel(agent.id);
              }}
              className="text-muted-foreground hover:text-destructive rounded p-0.5 transition-colors hover:bg-red-50 dark:hover:bg-red-950"
              title={t.task.cancel}
              aria-label={t.task.cancel}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      </button>
      {expanded && (
        <div className="text-muted-foreground border-border/20 border-t px-3 py-2 text-xs">
          <div className="flex gap-4">
            <span>ID: {agent.id.slice(0, 8)}</span>
            {agent.totalTokens != null && (
              <span>
                {agent.totalTokens.toLocaleString()} {t.task.tokens}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SubAgentPanel({
  subAgents,
  onCancel,
}: {
  subAgents: SubAgentState[];
  onCancel: (agentId: string) => void;
}) {
  const { t } = useLanguage();

  if (subAgents.length === 0) return null;

  const running = subAgents.filter((a) => a.status === 'running').length;

  return (
    <div className="border-border/40 bg-muted/20 my-2 overflow-hidden rounded-lg border">
      <div className="border-border/30 flex items-center gap-2 border-b px-3 py-1.5 text-xs">
        <span className="text-muted-foreground font-medium">
          {t.task.subAgentsCount.replace('{count}', String(subAgents.length))}
        </span>
        {running > 0 && (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <Loader2 className="size-3 animate-spin" />
            {t.task.subAgentsRunningCount.replace('{count}', String(running))}
          </span>
        )}
      </div>
      <div>
        {subAgents.map((agent) => (
          <SubAgentRow key={agent.id} agent={agent} onCancel={onCancel} />
        ))}
      </div>
    </div>
  );
}
