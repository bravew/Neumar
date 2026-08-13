/**
 * BackgroundTasksSection — Dashboard section showing dispatched/background tasks.
 * Rendered on the Home page when tasks are active.
 */
import { useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { Clock, Coins, Loader2, Square, X } from 'lucide-react';

import { formatCostCents } from '@/components/library/library-utils';
import { getTask } from '@/shared/db';
import {
  stopBackgroundTask,
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

function formatElapsed(startedAt: Date): string {
  const seconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function BackgroundTasksSection() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);

  useEffect(() => {
    return subscribeToBackgroundTasks(setTasks);
  }, []);

  if (tasks.length === 0) return null;

  return (
    <div className="w-full max-w-2xl">
      <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
        {t.home.backgroundTasks}
      </h3>
      <div className="flex flex-col gap-2">
        {tasks.map((task) => (
          <BackgroundTaskCard
            key={task.taskId}
            task={task}
            onNavigate={() => navigate(`/task-v2/${task.taskId}`)}
            onStop={() => stopBackgroundTask(task.taskId)}
          />
        ))}
      </div>
    </div>
  );
}

function BackgroundTaskCard({
  task,
  onNavigate,
  onStop,
}: {
  task: BackgroundTask;
  onNavigate: () => void;
  onStop: () => void;
}) {
  const { t } = useLanguage();
  const [elapsed, setElapsed] = useState(() => formatElapsed(task.startedAt));
  const [cost, setCost] = useState<number | null>(null);

  // Update elapsed time every second while running
  useEffect(() => {
    if (!task.isRunning) return;
    const timer = setInterval(
      () => setElapsed(formatElapsed(task.startedAt)),
      1000,
    );
    return () => clearInterval(timer);
  }, [task.isRunning, task.startedAt]);

  useEffect(() => {
    let cancelled = false;
    const fetchCost = async () => {
      const dbTask = await getTask(task.taskId);
      if (!cancelled && dbTask?.cost != null)
        setCost((prev) => (prev === dbTask.cost ? prev : dbTask.cost));
    };
    fetchCost();
    if (!task.isRunning) return;
    const timer = setInterval(fetchCost, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [task.taskId, task.isRunning]);

  return (
    <button
      onClick={onNavigate}
      className={cn(
        'border-border/60 bg-muted/30 hover:bg-accent/50 group flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
      )}
    >
      {task.isRunning ? (
        <Loader2 className="text-primary size-4 shrink-0 animate-spin" />
      ) : (
        <div className="size-4 shrink-0 rounded-full bg-green-500/20">
          <div className="m-1 size-2 rounded-full bg-green-500" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-sm">{task.prompt}</p>
      </div>

      {cost != null && cost > 0 && (
        <div className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
          <Coins className="size-3" />
          <span>{formatCostCents(cost)}</span>
        </div>
      )}

      <div className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
        <Clock className="size-3" />
        <span>{elapsed}</span>
      </div>

      {task.isRunning && (
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
      )}

      {!task.isRunning && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStop();
          }}
          className="text-muted-foreground hover:text-foreground opacity-0 transition-all group-hover:opacity-100"
          title={t.common.dismiss}
        >
          <X className="size-3.5" />
        </button>
      )}
    </button>
  );
}
