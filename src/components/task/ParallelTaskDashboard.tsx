/**
 * ParallelTaskDashboard — Shows all running and queued tasks with real-time status.
 *
 * Displayed on the Home page when there are active running or queued tasks.
 * Uses the queue status API for running/queued counts and the local task DB for display info.
 */
import { useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { Clock, Layers, Loader2, Square } from 'lucide-react';

import { formatCost, formatDuration } from '@/components/library/library-utils';
import { API_BASE_URL } from '@/config';
import type { Task } from '@/shared/db';
import { getAllTasks } from '@/shared/db';
import { useGlobalQueueStats } from '@/shared/hooks/useQueueStatus';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export function ParallelTaskDashboard() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { stats } = useGlobalQueueStats();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tick, setTick] = useState(0);

  const queuedCount = stats?.totalQueued ?? 0;
  const shouldPoll = (stats?.totalRunning ?? 0) > 1 || queuedCount > 0;

  // Only poll task list when the dashboard will actually be visible
  useEffect(() => {
    if (!shouldPoll) return;
    let cancelled = false;
    const loadTasks = async () => {
      try {
        const allTasks = await getAllTasks();
        if (cancelled) return;
        setTasks(allTasks);
      } catch {
        // Silently fail — dashboard is informational
      }
    };
    loadTasks();
    const interval = setInterval(loadTasks, 5_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [shouldPoll]);

  const runningTasks = tasks.filter((t) => t.status === 'running');

  // Single timer for all cards' elapsed display
  useEffect(() => {
    if (runningTasks.length === 0) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [runningTasks.length]);

  if (runningTasks.length <= 1 && queuedCount === 0) return null;

  return (
    <div className="mb-4 w-full max-w-2xl">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
          <Layers className="size-3.5" />
          {t.dashboard.parallelTasks}
        </h3>
        <div className="text-muted-foreground flex items-center gap-3 text-xs">
          <span>
            {runningTasks.length} {t.dashboard.tasksRunning.toLowerCase()}
          </span>
          {queuedCount > 0 && (
            <span className="text-amber-500">
              {queuedCount} {t.dashboard.queued}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {runningTasks.map((task) => (
          <RunningTaskCard
            key={task.id}
            task={task}
            tick={tick}
            onNavigate={() => navigate(`/task-v2/${task.id}`)}
            onStop={() => stopTask(task.id, task.session_id)}
          />
        ))}
      </div>

      {queuedCount > 0 && (
        <div className="border-border/40 bg-muted/10 mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
          <div className="size-2 rounded-full bg-amber-500/60" />
          <span className="text-muted-foreground">
            {queuedCount} {t.dashboard.queuedTasks.toLowerCase()} ·{' '}
            {t.dashboard.waitingForSlot.toLowerCase()}
          </span>
        </div>
      )}
    </div>
  );
}

function RunningTaskCard({
  task,
  tick,
  onNavigate,
  onStop,
}: {
  task: Task;
  tick: number;
  onNavigate: () => void;
  onStop: () => void;
}) {
  const { t } = useLanguage();
  // tick triggers re-render; compute elapsed from creation time
  void tick;
  const elapsedMs = Date.now() - new Date(task.created_at).getTime();
  const elapsed = formatDuration(elapsedMs) ?? '—';
  const cost = formatCost(task.cost) ?? '—';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onNavigate();
      }}
      className={cn(
        'border-border/60 bg-muted/30 hover:bg-accent/50 group flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
      )}
    >
      <Loader2 className="text-primary size-4 shrink-0 animate-spin" />

      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-sm">
          {task.title || task.prompt}
        </p>
      </div>

      <div className="text-muted-foreground flex shrink-0 items-center gap-3 text-xs">
        {task.cost !== null && <span className="font-mono">{cost}</span>}
        <div className="flex items-center gap-1">
          <Clock className="size-3" />
          <span>{elapsed}</span>
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onStop();
        }}
        className="text-muted-foreground hover:text-destructive opacity-0 transition-all group-hover:opacity-100"
        title={t.common.stop}
      >
        <Square className="size-3.5" />
      </button>
    </div>
  );
}

async function stopTask(taskId: string, sessionId: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/agent/stop/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });
  } catch {
    // Best-effort stop
  }
}
